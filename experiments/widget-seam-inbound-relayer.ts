/**
 * WIDGET PHASE — STEP 1, inbound seam. Real, end-to-end, no mocking:
 *
 *   real EVM (Sepolia) CCTP burn -> POST /transfers on a REAL docker-composed relayer instance
 *   -> poll GET /transfers/:id through the relayer's own real state machine (pending -> attested
 *   -> submitting -> delivered) -> independently confirmed on-chain (both the EVM burn and the
 *   Stellar mint_and_forward).
 *
 * This is the INBOUND half of the widget's real integration surface (EVM -> Stellar), proved
 * SEPARATELY from the outbound seam (see `widget-seam-outbound-cctp.ts`) because, AT THE TIME THIS
 * SCRIPT WAS WRITTEN, the relayer was architecturally inbound-only — confirmed directly:
 * `POST /transfers`'s own schema types `sourceTxHash` as an EVM tx hash
 * (packages/relayer/src/http/schemas.ts), the relayer's own README said "Completes CCTP-to-Stellar
 * transfers", and the roadmap's architecture diagram routed outbound sends straight from the SDK
 * to Stellar's CCTP contracts with no relayer in that path. A later phase added a real outbound
 * relayer direction to this same package (`POST /outbound-transfers`) and SDK/widget wiring to
 * register with it automatically — see `packages/relayer/README.md` and
 * `packages/sdk/src/index.ts`'s `registerOutboundTransfer` for the current, real state; this
 * script's own historical framing above is left as written for the moment it describes.
 *
 * Needs, all real, all already arranged before this script runs:
 * - A funded Sepolia EVM account (0.001 ETH gas + 20 USDC, both from real testnet faucets — no
 *   private-key extraction, no mainnet-history-gated faucet since the fresh address has none).
 * - A REAL, running, docker-composed relayer instance (packages/relayer/docker-compose.yml),
 *   pointed at Stellar testnet, sponsored by the funded `ferryline-testnet-operator` account.
 * - FERRYLINE_EVM_PRIVATE_KEY set to the funded EVM account's real private key (env var, never
 *   committed — see this repo's .gitignore for .env).
 */
import { execFileSync } from "node:child_process";

import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  buildForwarderHookData,
  encodeDepositForBurnWithHookToStellar,
  cctpEvmChain,
  CCTP_STELLAR,
} from "@ferryline/sdk";
import { contractAddressToBytes32, newTransferId } from "@ferryline/core";

// Not exported from @ferryline/sdk's public surface (a real, minor gap: the SDK's own
// packages/sdk/src/evm/reader.ts defines ERC20_ABI but nothing re-exports it) — defined locally
// here rather than reaching into the package's internals. Same real ABI, real selector.
const ERC20_APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

import { Report, env } from "./lib/report.js";

const report = new Report(
  "widget-seam-inbound-relayer",
  "Does a real EVM CCTP burn, registered with a real docker-composed relayer, actually get completed on Stellar testnet through the relayer's own real state machine?",
);

const RELAYER_URL = env("FERRYLINE_RELAYER_URL") ?? "http://localhost:8080";
const RELAYER_API_KEY = env("FERRYLINE_RELAYER_API_KEY");
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const STELLAR_RECIPIENT = env("FERRYLINE_STELLAR_IDENTITY") ?? "demo-payer";

const evmPrivateKey = env("FERRYLINE_EVM_PRIVATE_KEY") as `0x${string}` | undefined;
if (!evmPrivateKey) {
  report.finish(
    "BLOCKED",
    "Not run: FERRYLINE_EVM_PRIVATE_KEY is not set. This must be the real, funded Sepolia account's private key.",
  );
  process.exit(0);
}

const account = privateKeyToAccount(evmPrivateKey);
const publicClient = createPublicClient({ chain: sepolia, transport: http() });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http() });

report.section("Setup");
report.line(`- EVM sender: ${account.address}`);

const sourceChain = cctpEvmChain("testnet", "ethereum-sepolia");
if (!sourceChain) {
  throw new Error("ethereum-sepolia not found in the SDK's own testnet CCTP chain table");
}
report.line(`- source chain: ethereum-sepolia (domain ${String(sourceChain.domain)})`);

const ethBalance = await publicClient.getBalance({ address: account.address });
const usdcBalance = await publicClient.readContract({
  address: sourceChain.usdc,
  abi: ERC20_APPROVE_ABI,
  functionName: "balanceOf",
  args: [account.address],
});
report.line(
  `- ETH balance: ${ethBalance.toString()} wei, USDC balance: ${usdcBalance.toString()} (6dp)`,
);

const AMOUNT_USDC6 = BigInt(env("FERRYLINE_SEAM_INBOUND_AMOUNT_MICRO_USDC") ?? "1000000"); // 1 USDC
if (usdcBalance < AMOUNT_USDC6) {
  report.finish(
    "BLOCKED",
    `Not run: ${account.address} holds only ${usdcBalance.toString()} micro-USDC, need at least ${AMOUNT_USDC6.toString()}.`,
  );
  process.exit(0);
}
if (ethBalance === 0n) {
  report.finish("BLOCKED", `Not run: ${account.address} holds no Sepolia ETH for gas.`);
  process.exit(0);
}

// Real testnet CCTP TokenMessengerMinter address: read from sourceChain.tokenMessengerV2 (already
// fetched above via cctpEvmChain) rather than retyped as a separate constant — a hand-transcribed
// copy of this address is exactly what produced a real, checksum-caught typo the first time this
// script ran (viem's own address validation refused it before any transaction was sent). Same
// reasoning for the Stellar forwarder address below: read from CCTP_STELLAR.testnet directly.
const CCTP_FORWARDER_STELLAR = CCTP_STELLAR.testnet.cctpForwarder;

report.section("EVM: approve + depositForBurnWithHook (real Sepolia transactions)");
const forwarderBytes32 = contractAddressToBytes32(CCTP_FORWARDER_STELLAR);
const hookData = buildForwarderHookData(
  execFileSync("stellar", ["keys", "address", STELLAR_RECIPIENT], { encoding: "utf8" }).trim(),
);
report.line(`- forwardRecipient (Stellar): ${STELLAR_RECIPIENT}`);
report.line(`- hookData length: ${hookData.length.toString()} bytes`);

const approveData = encodeFunctionData({
  abi: ERC20_APPROVE_ABI,
  functionName: "approve",
  args: [sourceChain.tokenMessengerV2, AMOUNT_USDC6],
});
const approveHash = await walletClient.sendTransaction({
  to: sourceChain.usdc,
  data: approveData,
});
report.line(`- approve tx: ${approveHash}`);
const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
report.line(`  status: ${approveReceipt.status}`);
if (approveReceipt.status !== "success") {
  report.finish("FAILED", `approve transaction ${approveHash} did not succeed.`);
  process.exit(0);
}

const burnData = encodeDepositForBurnWithHookToStellar(
  {
    amount: AMOUNT_USDC6,
    destinationDomain: 27, // Stellar's CCTP domain
    mintRecipient: forwarderBytes32,
    burnToken: sourceChain.usdc,
    destinationCaller: forwarderBytes32,
    maxFee: 0n,
    minFinalityThreshold: 2000,
    hookData,
  },
  CCTP_FORWARDER_STELLAR,
);
const burnHash = await walletClient.sendTransaction({
  to: sourceChain.tokenMessengerV2,
  data: burnData,
});
report.line(`- depositForBurnWithHook tx: ${burnHash}`);
const burnReceipt = await publicClient.waitForTransactionReceipt({ hash: burnHash });
report.line(`  status: ${burnReceipt.status}`);
if (burnReceipt.status !== "success") {
  report.finish("FAILED", `burn transaction ${burnHash} did not succeed.`);
  process.exit(0);
}

report.section("Relayer: POST /transfers (real, running, docker-composed instance)");
const transferId = newTransferId();
const registerHeaders: Record<string, string> = { "Content-Type": "application/json" };
if (RELAYER_API_KEY) {
  registerHeaders["Authorization"] = `Bearer ${RELAYER_API_KEY}`;
}
const registerResponse = await fetch(`${RELAYER_URL}/transfers`, {
  method: "POST",
  headers: registerHeaders,
  body: JSON.stringify({
    transferId,
    sourceChain: "ethereum-sepolia",
    sourceTxHash: burnHash,
    rail: "usdc-cctp",
  }),
});
const registerBody: unknown = await registerResponse.json();
report.line(
  `- POST /transfers -> ${String(registerResponse.status)}: ${JSON.stringify(registerBody)}`,
);
if (registerResponse.status !== 201) {
  report.finish(
    "FAILED",
    `Registration failed with ${String(registerResponse.status)}: ${JSON.stringify(registerBody)}. Real burn tx: ${burnHash}.`,
  );
  process.exit(0);
}

report.section("Relayer: GET /transfers/:id — polling the real state machine to a terminal state");
const deadline = Date.now() + 20 * 60_000; // Circle attestation can genuinely take several minutes.
let lastStatus = "";
let finalBody: { status?: string; errorCode?: string; destinationTxHash?: string } = {};
while (Date.now() < deadline) {
  // A real transient connection failure (e.g. the relayer container restarting mid-poll, which
  // genuinely happened during this script's own development) must not crash the whole run — only
  // a real terminal state or the deadline should end this loop.
  let statusResponse: Response;
  try {
    statusResponse = await fetch(`${RELAYER_URL}/transfers/${transferId}`, {
      headers: RELAYER_API_KEY ? { Authorization: `Bearer ${RELAYER_API_KEY}` } : {},
    });
  } catch (error) {
    report.line(`- poll attempt failed (will retry): ${String(error)}`);
    await new Promise((r) => setTimeout(r, 10_000));
    continue;
  }
  finalBody = (await statusResponse.json()) as typeof finalBody;
  const line = JSON.stringify(finalBody);
  if (line !== lastStatus) {
    lastStatus = line;
    report.line(`- ${new Date().toISOString()}: ${line}`);
  }
  if (finalBody.status === "delivered" || finalBody.status === "failed") {
    break;
  }
  await new Promise((r) => setTimeout(r, 10_000));
}

report.section(
  "Independent on-chain confirmation (direct Horizon query, not the relayer's own view)",
);
if (finalBody.destinationTxHash) {
  const destTxResponse = await fetch(`${HORIZON_URL}/transactions/${finalBody.destinationTxHash}`);
  const destTx = (await destTxResponse.json()) as { successful?: boolean };
  report.line(
    `- destination tx ${finalBody.destinationTxHash}: successful=${String(destTx.successful)} (confirmed via Horizon, not the relayer's own report)`,
  );
} else {
  report.line("- no destinationTxHash reported; cannot independently confirm delivery.");
}

report.finish(
  finalBody.status === "delivered" ? "RAN" : "FAILED",
  finalBody.status === "delivered"
    ? `Real inbound transfer completed through the relayer's real state machine. EVM burn: ${burnHash}. Stellar delivery: ${String(finalBody.destinationTxHash)}. transferId: ${transferId}.`
    : `Transfer did not reach "delivered" within the polling window. Last known state: ${JSON.stringify(finalBody)}. EVM burn: ${burnHash} (real and confirmed on Sepolia regardless of the relayer's outcome).`,
);
