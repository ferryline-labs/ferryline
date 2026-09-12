/**
 * WIDGET PHASE — STEP 1, outbound seam. Real, end-to-end, no mocking:
 *
 *   wallet (Stellar Wallets Kit) -> SDK's UsdcCctpAdapter.quote()/build() -> sign -> broadcast
 *   to Stellar testnet -> independently confirmed on-chain.
 *
 * This is the OUTBOUND half of the widget's real integration surface (Stellar -> EVM). Per the
 * roadmap's own architecture diagram, an outbound CCTP send never touches the relayer at all — it
 * goes straight from the SDK to the CCTP contracts on Stellar and is delivered by Circle's Iris
 * attestation + destination-chain completion. The relayer is INBOUND-only (EVM -> Stellar); see
 * `widget-seam-inbound-relayer.ts` for that seam, proved separately because the two are genuinely
 * disconnected in this architecture (confirmed directly: `POST /transfers`'s own schema types
 * `sourceTxHash` as an EVM tx hash — packages/relayer/src/http/schemas.ts — and `FerrylineConfig`'s
 * `relayerUrl` field is declared but never read anywhere in packages/sdk/src).
 *
 * WALLET CONNECTION METHOD, stated precisely (per this project's discipline: don't silently
 * substitute something weaker without flagging it): Stellar Wallets Kit has NO shipped headless
 * testing module (confirmed by an exhaustive scan of its own published `exports` map and full repo
 * file tree — every entry is a real browser-extension/hardware/WalletConnect module). This script
 * uses `experiments/lib/keypair-wallet-module.ts`, a real `ModuleInterface` implementation backed
 * by a plain testnet `Keypair` — the SAME interface contract every real wallet module (Freighter,
 * xBull, Lobstr, etc.) implements, confirmed DOM-free by reading the kit's own real `.d.ts` source.
 * `StellarWalletsKit.signTransaction()` below is the kit's own real, unmodified orchestration
 * code — only the wallet backing the interface is substituted, not the signing code path. This
 * does NOT prove a real browser extension's UI/permission flow works; see this experiment's own
 * report for that gap.
 *
 * Needs: demo-payer (stellar-cli identity) holding real testnet USDC — confirmed already funded
 * from the router phase (98.305 USDC as of 2026-09-12). Requires network access to
 * soroban-testnet.stellar.org and Circle's sandbox Iris API.
 */
import { execFileSync } from "node:child_process";

import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { InMemoryTransferStore } from "@ferryline/core";
import { Ferryline, UsdcCctpAdapter } from "@ferryline/sdk";
import type { TransferStep } from "@ferryline/core";

import { KeypairWalletModule } from "./lib/keypair-wallet-module.js";
import { Report, env } from "./lib/report.js";

const report = new Report(
  "widget-seam-outbound-cctp",
  "Does a real wallet-signed CCTP outbound send, built by the SDK's own adapter, actually work end to end on testnet?",
);

const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";

function stellarSecret(identity: string): string {
  return execFileSync("stellar", ["keys", "secret", identity], { encoding: "utf8" }).trim();
}

async function waitForTransaction(server: Server, hash: string, maxAttempts = 40): Promise<string> {
  for (let i = 0; i < maxAttempts; i += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    const result = await server.getTransaction(hash);
    if (result.status !== Api.GetTransactionStatus.NOT_FOUND) {
      return result.status;
    }
  }
  throw new Error(`transaction ${hash} not found after ${String(maxAttempts * 1.5)}s`);
}

/** Signs an unsigned XDR step via the REAL kit's own orchestration, broadcasts it, and waits for real confirmation. */
async function signAndSubmit(step: TransferStep, server: Server): Promise<string> {
  if (step.chain !== "stellar" || step.kind !== "stellar-transaction") {
    throw new Error(`expected a signable stellar-transaction step, got ${step.kind}`);
  }
  report.line(`  step: ${step.description}`);
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(step.xdr, {
    networkPassphrase: Networks.TESTNET,
  });
  const tx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
  const sent = await server.sendTransaction(tx);
  if (sent.status !== "PENDING") {
    throw new Error(
      `sendTransaction: ${sent.status} ${"errorResult" in sent && sent.errorResult ? sent.errorResult.toXDR("base64") : ""}`,
    );
  }
  report.line(`  submitted: ${sent.hash}`);
  const status = await waitForTransaction(server, sent.hash);
  report.line(`  result: ${status}`);
  if (status !== "SUCCESS") {
    throw new Error(`transaction ${sent.hash} did not succeed: ${status}`);
  }
  return sent.hash;
}

report.section("Setup");
const secret = stellarSecret(env("FERRYLINE_STELLAR_IDENTITY") ?? "demo-payer");
const keypair = Keypair.fromSecret(secret);
report.line(`- sender: ${keypair.publicKey()}`);

const server = new Server(RPC_URL);

const module_ = new KeypairWalletModule(secret, Networks.TESTNET);
StellarWalletsKit.init({
  modules: [module_],
  network: Networks.TESTNET,
  selectedWalletId: module_.productId,
});
const { address: walletAddress } = await StellarWalletsKit.fetchAddress();
report.line(`- wallet-kit reports connected address: ${walletAddress}`);
if (walletAddress !== keypair.publicKey()) {
  throw new Error("wallet-kit address does not match the expected keypair — aborting");
}

const balanceResponse = await fetch(`${HORIZON_URL}/accounts/${keypair.publicKey()}`);
const account = (await balanceResponse.json()) as {
  balances: { asset_type: string; asset_code?: string; balance: string }[];
};
const usdcBefore =
  account.balances.find((b) => b.asset_type !== "native" && b.asset_code === "USDC")?.balance ??
  "0";
const xlmBefore = account.balances.find((b) => b.asset_type === "native")?.balance ?? "0";
report.line(`- balances before: ${usdcBefore} USDC, ${xlmBefore} XLM`);
if (Number(usdcBefore) < 0.5) {
  report.finish(
    "BLOCKED",
    `Not run: ${keypair.publicKey()} holds only ${usdcBefore} testnet USDC, need at least 0.5.`,
  );
  process.exit(0);
}

report.section("SDK: quote()");
const ferryline = new Ferryline({
  network: "testnet",
  rpcUrl: RPC_URL,
  store: new InMemoryTransferStore(),
});
ferryline.registerAdapter(
  new UsdcCctpAdapter({
    network: "testnet",
    stellarRpc: server,
    store: ferryline.store,
  }),
);

const AMOUNT_USDC = env("FERRYLINE_SEAM_AMOUNT_USDC") ?? "0.5";
// A real Sepolia address to mint toward: the router phase's own verified real Sepolia USDC
// contract address stood in as a real-shaped recipient there; here we mint toward the fresh EVM
// testnet account this same phase generated and funded for the inbound seam, so both scripts'
// real evidence is cross-referenceable to the same address.
const MINT_RECIPIENT = env("FERRYLINE_EVM_ADDRESS") ?? "0x78253429b7483FBcCEf90e943526BB990a4D5b50";

const quote = await ferryline.quote({
  asset: "USDC",
  from: { chain: "stellar", address: keypair.publicKey() },
  to: { chain: "ethereum-sepolia", address: MINT_RECIPIENT },
  amount: AMOUNT_USDC,
  parameters: { maxFee: "0", minFinalityThreshold: 2000 },
});
report.line(
  `- debit ${quote.debit.value.toString()} (${quote.debit.decimals}dp), credit ${quote.credit.value.toString()} (${quote.credit.decimals}dp), dust ${quote.dust.value.toString()}`,
);
report.line(
  `- fees: ${quote.fees.map((f) => `${f.label}: ${f.amount.value.toString()}`).join("; ") || "none"}`,
);
report.line(
  `- checks: ${quote.checks.map((c) => `${c.id}=${c.ok ? "ok" : "FAIL"}(${c.message})`).join(" | ")}`,
);
const failedChecks = quote.checks.filter((c) => !c.ok);
if (failedChecks.length > 0) {
  report.finish(
    "FAILED",
    `Quote had failing preflight checks: ${failedChecks.map((c) => c.id).join(", ")}. Cannot proceed to build().`,
  );
  process.exit(0);
}

report.section("SDK: build()");
const built = await ferryline.build(quote);
report.line(`- transferId: ${built.transferId}`);
report.line(`- steps: ${built.steps.map((s) => s.kind).join(" -> ")}`);

const firstStep = built.steps[0];
if (!firstStep) {
  throw new Error("build() returned zero steps — nothing to sign");
}

report.section(
  built.steps.length > 1
    ? "Wallet signs + broadcasts step 0 (approve)"
    : "Wallet signs + broadcasts the burn (no approve needed — a standing allowance already covers it)",
);
const hashes: string[] = [];
hashes.push(await signAndSubmit(firstStep, server));

let burnStep: TransferStep | undefined;
if (built.steps[1]?.kind === "stellar-transaction-deferred") {
  report.section("SDK: prepareStep() for the deferred burn (now that approve is confirmed)");
  burnStep = await ferryline.prepareStep(built.transferId, 1);
  report.line(
    `  assembled: ${burnStep.kind === "stellar-transaction" ? burnStep.description : "?"}`,
  );
} else if (firstStep.kind === "stellar-transaction" && built.steps.length === 1) {
  // needsApprove was false (a prior approve already covers this amount) — the burn WAS step 0,
  // already signed and submitted above; nothing further to do.
  burnStep = undefined;
} else {
  throw new Error(`unexpected step shape: ${JSON.stringify(built.steps)}`);
}

if (burnStep) {
  report.section("Wallet signs + broadcasts the burn");
  hashes.push(await signAndSubmit(burnStep, server));
}

report.section("Independent on-chain confirmation (direct Horizon query, not the SDK's own view)");
const afterResponse = await fetch(`${HORIZON_URL}/accounts/${keypair.publicKey()}`);
const afterAccount = (await afterResponse.json()) as {
  balances: { asset_type: string; asset_code?: string; balance: string }[];
};
const usdcAfter =
  afterAccount.balances.find((b) => b.asset_type !== "native" && b.asset_code === "USDC")
    ?.balance ?? "0";
report.line(`- USDC balance before: ${usdcBefore}, after: ${usdcAfter}`);
const burnTxResponse = await fetch(`${HORIZON_URL}/transactions/${hashes[hashes.length - 1]}`);
const burnTx = (await burnTxResponse.json()) as { successful?: boolean; fee_charged?: string };
report.line(
  `- burn transaction ${hashes[hashes.length - 1]}: successful=${String(burnTx.successful)}, fee_charged=${String(burnTx.fee_charged)} stroops`,
);

report.section(
  "Iris: does Circle see and attest the real burn? (best-effort, does not block the verdict)",
);
const irisUrl = `https://iris-api-sandbox.circle.com/v2/messages/27?transactionHash=${hashes[hashes.length - 1]}`;
try {
  const irisResponse = await fetch(irisUrl);
  const irisBody: unknown = await irisResponse.json().catch(() => undefined);
  report.code(
    `Iris ${irisUrl}`,
    JSON.stringify({ httpStatus: irisResponse.status, body: irisBody }, null, 1),
    "json",
  );
} catch (error) {
  report.line(`- Iris check failed (non-blocking): ${String(error)}`);
}

const moved = Number(usdcBefore) - Number(usdcAfter) > 0;
report.finish(
  moved && burnTx.successful === true ? "RAN" : "FAILED",
  moved && burnTx.successful === true
    ? `Real wallet-signed CCTP outbound send completed: ${hashes.join(", ")}. USDC balance dropped from ${usdcBefore} to ${usdcAfter}, confirmed independently via Horizon.`
    : `Something did not check out: moved=${String(moved)}, burnTx.successful=${String(burnTx.successful)}. See hashes: ${hashes.join(", ")}.`,
);
