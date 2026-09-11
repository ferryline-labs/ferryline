/**
 * EXPERIMENT: burn USDC from Stellar TESTNET twice, with min_finality_threshold = 1000 and then 2000,
 * and record which the contract accepts and what Circle's attestation reports for each.
 * Same prerequisites as cctp-burn-max-fee-zero.ts, with >= 2 testnet USDC.
 */
import { Report, env } from "./lib/report.js";
import {
  burn,
  feesEvidence,
  irisEvidence,
  mintRecipientFromEnv,
  testnetBurnSetup,
} from "./lib/cctp-run.js";

const report = new Report(
  "cctp-finality-threshold",
  "Which min_finality_threshold values (1000 fast, 2000 standard) does the Stellar TokenMessengerMinter accept, and what does Circle attest for each?",
);

await feesEvidence(report);
report.section("Evidence: capability table");
report.line(
  "- developers.circle.com/cctp/concepts/supported-chains-and-domains (2026-09-11), Stellar row: Standard Transfer ✅, Fast Transfer N/A, Upfront Fees ❌, Forwarding Service ❌.",
);
report.line(
  "- Circle's Stellar reference example still exposes minFinalityThreshold (1000 = fast, 2000 = standard) on the EVM burn toward Stellar. Whether 1000 is rejected, ignored, or charged is what this experiment measures for the Stellar-as-source direction.",
);

const amount = env("FERRYLINE_CCTP_AMOUNT_USDC") ?? "1";
const setup = await testnetBurnSetup(report, String(Number(amount) * 2));
if (!setup) {
  report.finish(
    "BLOCKED",
    "Not run: the testnet operator holds no USDC. No threshold behaviour is assumed; the SDK must not ship a default for min_finality_threshold.",
  );
  process.exit(0);
}
const amountStroops = BigInt(Math.round(Number(amount) * 1e7));
const maxFee = BigInt(env("FERRYLINE_CCTP_MAX_FEE_STROOPS") ?? "0");
const outcomes: string[] = [];
for (const threshold of [1000, 2000]) {
  report.section(`Burn with min_finality_threshold = ${String(threshold)}`);
  const result = await burn(
    setup,
    {
      amountStroops,
      maxFee,
      minFinalityThreshold: threshold,
      mintRecipient: mintRecipientFromEnv(),
    },
    report,
  );
  if (!result.hash) {
    outcomes.push(
      `${String(threshold)}: rejected before submission (${result.simulationError ?? "unknown"})`,
    );
    continue;
  }
  const iris = (await irisEvidence(result.hash, report)) as
    | { body?: { messages?: { status?: string; decodedMessage?: Record<string, unknown> }[] } }
    | undefined;
  const message = iris?.body?.messages?.[0];
  outcomes.push(
    `${String(threshold)}: submitted ${result.hash}; Iris status ${message?.status ?? "none"}; decodedMessage ${JSON.stringify(message?.decodedMessage ?? null)}`,
  );
}
report.finish("RAN", outcomes.join(" | "));
