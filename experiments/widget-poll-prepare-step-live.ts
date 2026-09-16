/**
 * WIDGET PHASE — live validation of `pollPrepareStep` (packages/widget/src/client.ts), the fix
 * that replaced `POST_APPROVE_BUILD_DELAY_MS`'s fixed-timer wait after an external, independent
 * integration test caught it failing `tx_bad_seq` 100% of the time on a genuinely fresh testnet
 * account, using the widget's shipped default. Root-caused: the fixed timer had never been
 * live-validated against a real, two-step testnet transfer before shipping — its own introducing
 * commit said so outright. This script closes that exact gap for its replacement, deliberately,
 * before publishing.
 *
 * WHAT THIS PROVES, PRECISELY: this calls the widget's own real, exported `pollPrepareStep` and
 * `isAllowanceInsufficient` (imported directly from `packages/widget/src/client.ts` — not
 * reimplemented, not a copy) wired the same way `afterStepSubmitted` wires them (see index.ts),
 * against a real Ferryline SDK instance, real testnet RPC, and a real wallet-signing interface
 * (Stellar Wallets Kit's own orchestration, backed by `KeypairWalletModule` — see that module's own
 * doc comment for why this is the closest real equivalent to a browser wallet a script can drive;
 * the kit has no shipped headless module). This is NOT a run of the `<ferryline-widget>` custom
 * element itself — proving the actual UI wires this correctly still needs a real, human-driven
 * browser + Freighter session (see packages/widget/e2e/README.md), tracked as a separate,
 * deliberately NOT-covered gap here, not silently claimed as covered.
 *
 * WHY THIS ACCOUNT MUST BE FRESH: `demo-payer` (used by the earlier widget-seam-outbound-cctp
 * experiments) already granted a standing TokenMessengerMinter allowance in those prior runs, so a
 * repeat run against it would never exercise the deferred, two-step approve -> burn path at all —
 * the exact same reason the external bug report insisted on "a genuinely fresh testnet account."
 * This script generates a brand-new Keypair, funds it with real XLM via Friendbot, establishes a
 * real USDC trustline, and funds it with a real USDC payment from `demo-payer` — so this run
 * genuinely starts with zero prior allowance, the real condition that makes `prepareStep` actually
 * throw ALLOWANCE_INSUFFICIENT and need the poll at all, not trivially succeed on the first call.
 *
 * Needs: `demo-payer` (stellar-cli identity) holding real testnet USDC to fund the fresh account
 * with (confirmed: 95.805 USDC as of 2026-09-16). Network access to soroban-testnet.stellar.org,
 * horizon-testnet.stellar.org, friendbot.stellar.org.
 */
import { execFileSync } from "node:child_process";

import {
  Asset,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { InMemoryTransferStore } from "@ferryline/core";
import { Ferryline, UsdcCctpAdapter } from "@ferryline/sdk";
import type { TransferStep } from "@ferryline/core";

// Relative source import, deliberately not a package import: pollPrepareStep/isAllowanceInsufficient
// are internal to the widget (not re-exported from packages/widget/src/index.ts, its real public
// entry point) — correctly so, this is implementation detail, not consumer-facing API. This script
// exists specifically to validate that internal mechanism directly and precisely, the same one
// afterStepSubmitted (index.ts) wires, so it imports the real source file rather than going through
// @ferryline/widget's own package exports, which don't surface it at all.
import { isAllowanceInsufficient, pollPrepareStep } from "../packages/widget/src/client.js";
import { KeypairWalletModule } from "./lib/keypair-wallet-module.js";
import { Report, env } from "./lib/report.js";
import { TESTNET, balances, submit, ensureTrustline } from "./lib/stellar.js";

const report = new Report(
  "widget-poll-prepare-step-live",
  "Does the widget's real pollPrepareStep (client.ts), the replacement for the old fixed-timer POST_APPROVE_BUILD_DELAY_MS wait, actually work end to end against a real, fresh testnet account's two-step CCTP approve -> burn sequence?",
);

const USDC_TESTNET = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");

function stellarSecret(identity: string): string {
  return execFileSync("stellar", ["keys", "secret", identity], { encoding: "utf8" }).trim();
}

/**
 * Real, load-bearing wait, the same real bug class this project has already found and fixed once
 * before (see `waitForTransaction` in `widget-seam-outbound-cctp.ts`, and `waitForStellarConfirmation`
 * in the widget's own `client.ts`): `sendTransaction` returns as soon as the network accepts the
 * envelope into its mempool, well before ledger inclusion. Checking Horizon immediately after,
 * without waiting for real confirmation, races the ledger and produces a false "successful:
 * undefined" read — not a real failure. Uses `stellar.ts`'s own already-proven `submit` helper
 * (real ~60s polling budget) rather than a bespoke, shorter wait.
 */
async function signAndSubmit(step: TransferStep): Promise<string> {
  if (step.chain !== "stellar" || step.kind !== "stellar-transaction") {
    throw new Error(`expected a signable stellar-transaction step, got ${step.kind}`);
  }
  report.line(`  step: ${step.description}`);
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(step.xdr, {
    networkPassphrase: Networks.TESTNET,
  });
  const tx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
  if (tx instanceof FeeBumpTransaction) {
    throw new Error("signAndSubmit: expected a plain (non-fee-bump) transaction envelope");
  }
  const result = await submit(TESTNET, tx);
  report.line(`  submitted and confirmed: ${result.txHash} (${result.status})`);
  if (result.status !== Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`transaction ${result.txHash} did not succeed: ${result.status}`);
  }
  return result.txHash;
}

report.section("Setup: generate and fund a genuinely fresh testnet account");
const fresh = Keypair.random();
report.line(`- fresh sender: ${fresh.publicKey()} (secret not recorded in this report by design)`);

const friendbotResponse = await fetch(`https://friendbot.stellar.org/?addr=${fresh.publicKey()}`);
if (!friendbotResponse.ok) {
  report.finish(
    "BLOCKED",
    `Friendbot funding failed for ${fresh.publicKey()}: HTTP ${String(friendbotResponse.status)}.`,
  );
  process.exit(0);
}
report.line(`- Friendbot funded ${fresh.publicKey()} with real testnet XLM`);

const trustlineResult = await ensureTrustline(TESTNET, fresh, USDC_TESTNET);
report.line(`- USDC trustline: ${trustlineResult}`);

const payerSecret = stellarSecret(env("FERRYLINE_STELLAR_IDENTITY") ?? "demo-payer");
const payer = Keypair.fromSecret(payerSecret);
const payerBalances = await balances(TESTNET, payer.publicKey());
const payerUsdc = payerBalances?.lines.find((l) => l.code === "USDC")?.balance ?? "0";
report.line(`- funding payer: ${payer.publicKey()} (${payerUsdc} USDC available)`);

const FUND_AMOUNT_USDC = "2";
if (Number(payerUsdc) < Number(FUND_AMOUNT_USDC)) {
  report.finish(
    "BLOCKED",
    `Funding payer ${payer.publicKey()} holds only ${payerUsdc} USDC, need at least ${FUND_AMOUNT_USDC}.`,
  );
  process.exit(0);
}

const server = new Server(TESTNET.rpcUrl);
const payerAccount = await server.getAccount(payer.publicKey());
const paymentTx = new TransactionBuilder(payerAccount, {
  fee: BASE_FEE,
  networkPassphrase: TESTNET.passphrase,
})
  .addOperation(
    Operation.payment({
      destination: fresh.publicKey(),
      asset: USDC_TESTNET,
      amount: FUND_AMOUNT_USDC,
    }),
  )
  .setTimeout(120)
  .build();
paymentTx.sign(payer);
const paymentResult = await submit(TESTNET, paymentTx);
report.line(
  `- funded ${fresh.publicKey()} with ${FUND_AMOUNT_USDC} USDC from ${payer.publicKey()}: ${paymentResult.status} (${paymentResult.txHash})`,
);

const freshBalances = await balances(TESTNET, fresh.publicKey());
const usdcBefore = freshBalances?.lines.find((l) => l.code === "USDC")?.balance ?? "0";
const xlmBefore = freshBalances?.xlm ?? "0";
report.line(`- fresh account balances before transfer: ${usdcBefore} USDC, ${xlmBefore} XLM`);
report.line(
  "- this account has NEVER submitted a transaction to the TokenMessengerMinter contract before " +
    "this point — no prior approve, no standing allowance, the same real starting condition the " +
    "external bug report's own reproduction used.",
);

const module_ = new KeypairWalletModule(fresh.secret(), Networks.TESTNET);
StellarWalletsKit.init({
  modules: [module_],
  network: Networks.TESTNET,
  selectedWalletId: module_.productId,
});
const { address: walletAddress } = await StellarWalletsKit.fetchAddress();
if (walletAddress !== fresh.publicKey()) {
  throw new Error("wallet-kit address does not match the expected fresh keypair — aborting");
}

report.section(
  "SDK: quote() and build() — real Ferryline instance, same construction the widget's client.ts uses",
);
const ferryline = new Ferryline({
  network: "testnet",
  rpcUrl: TESTNET.rpcUrl,
  store: new InMemoryTransferStore(),
});
ferryline.registerAdapter(
  new UsdcCctpAdapter({ network: "testnet", stellarRpc: server, store: ferryline.store }),
);

const MINT_RECIPIENT = env("FERRYLINE_EVM_ADDRESS") ?? "0x78253429b7483FBcCEf90e943526BB990a4D5b50";
const AMOUNT_USDC = "1";

const quote = await ferryline.quote({
  asset: "USDC",
  from: { chain: "stellar", address: fresh.publicKey() },
  to: { chain: "ethereum-sepolia", address: MINT_RECIPIENT },
  amount: AMOUNT_USDC,
  parameters: { maxFee: "0", minFinalityThreshold: 2000 },
});
const failedChecks = quote.checks.filter((c) => !c.ok);
if (failedChecks.length > 0) {
  report.finish(
    "FAILED",
    `Quote had failing preflight checks: ${failedChecks.map((c) => c.id).join(", ")}.`,
  );
  process.exit(0);
}

const built = await ferryline.build(quote);
report.line(`- transferId: ${built.transferId}`);
report.line(`- steps: ${built.steps.map((s) => s.kind).join(" -> ")}`);
if (built.steps.length !== 2 || built.steps[1]?.kind !== "stellar-transaction-deferred") {
  report.finish(
    "FAILED",
    `Expected a genuine two-step (approve -> deferred burn) transfer for this fresh account, got: ${built.steps.map((s) => s.kind).join(", ")}. This run cannot validate the poll without a real two-step shape.`,
  );
  process.exit(0);
}

const approveStep = built.steps[0]!;
report.section(
  "Wallet signs + broadcasts step 0 (approve) — the real KeypairWalletModule, not a mock",
);
const approveHash = await signAndSubmit(approveStep);

report.section(
  "The real fix under test: pollPrepareStep(prepareStep, isAllowanceInsufficient, ...) — imported directly from packages/widget/src/client.ts, not reimplemented",
);
const pollStart = Date.now();
let retryCount = 0;
const nextStep = await pollPrepareStep(
  () => ferryline.prepareStep(built.transferId, 1),
  (error) => {
    const retriable = isAllowanceInsufficient(error);
    if (retriable) {
      retryCount += 1;
      report.line(
        `  retry ${String(retryCount)}: prepareStep threw ALLOWANCE_INSUFFICIENT (real, expected for a fresh account whose approve has just been submitted but may not yet be visible to this RPC node) — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return retriable;
  },
  20,
  1500,
);
const pollElapsedMs = Date.now() - pollStart;
report.line(
  `- pollPrepareStep succeeded: ${String(retryCount)} real retr${retryCount === 1 ? "y" : "ies"} on ALLOWANCE_INSUFFICIENT, ${String(pollElapsedMs)}ms real elapsed time before prepareStep returned the assembled burn step.`,
);
report.line(`  assembled: ${nextStep.kind === "stellar-transaction" ? nextStep.description : "?"}`);

report.section("Wallet signs + broadcasts the burn");
const burnHash = await signAndSubmit(nextStep);

report.section("Independent on-chain confirmation (direct Horizon query, not the SDK's own view)");
const afterBalances = await balances(TESTNET, fresh.publicKey());
const usdcAfter = afterBalances?.lines.find((l) => l.code === "USDC")?.balance ?? "0";
report.line(`- USDC balance before: ${usdcBefore}, after: ${usdcAfter}`);

const approveTxResponse = await fetch(`${TESTNET.horizonUrl}/transactions/${approveHash}`);
const approveTx = (await approveTxResponse.json()) as {
  successful?: boolean;
  created_at?: string;
};
report.line(
  `- approve transaction ${approveHash}: successful=${String(approveTx.successful)}, created_at=${String(approveTx.created_at)}`,
);

const burnTxResponse = await fetch(`${TESTNET.horizonUrl}/transactions/${burnHash}`);
const burnTx = (await burnTxResponse.json()) as {
  successful?: boolean;
  fee_charged?: string;
  created_at?: string;
};
report.line(
  `- burn transaction ${burnHash}: successful=${String(burnTx.successful)}, created_at=${String(burnTx.created_at)}, fee_charged=${String(burnTx.fee_charged)} stroops`,
);

if (approveTx.created_at && burnTx.created_at) {
  const wallClockGapSeconds =
    (new Date(burnTx.created_at).getTime() - new Date(approveTx.created_at).getTime()) / 1000;
  report.line(
    `- real, independently-verified wall-clock gap between the approve's on-chain created_at and the burn's on-chain created_at: ${String(wallClockGapSeconds)}s (this includes the poll's own real elapsed time above, plus real wallet-signing and RPC round-trip time for both transactions).`,
  );
}

const moved = Number(usdcBefore) - Number(usdcAfter) > 0;
const succeeded = moved && approveTx.successful === true && burnTx.successful === true;
report.finish(
  succeeded ? "RAN" : "FAILED",
  succeeded
    ? `Real, live validation of pollPrepareStep succeeded end to end on a genuinely fresh testnet account: approve ${approveHash}, burn ${burnHash}. ${String(retryCount)} real ALLOWANCE_INSUFFICIENT retr${retryCount === 1 ? "y" : "ies"} over ${String(pollElapsedMs)}ms before prepareStep succeeded. USDC balance dropped from ${usdcBefore} to ${usdcAfter}, confirmed independently via Horizon.`
    : `Something did not check out: moved=${String(moved)}, approveTx.successful=${String(approveTx.successful)}, burnTx.successful=${String(burnTx.successful)}. See hashes: approve ${approveHash}, burn ${burnHash}.`,
);
