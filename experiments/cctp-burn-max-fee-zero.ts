/**
 * EXPERIMENT: burn USDC from Stellar TESTNET with max_fee = 0 to confirm or refute "no upfront fees"
 * for Stellar-as-source. Read-only evidence first (fee API, get_min_fee); then a real burn if the
 * operator account holds testnet USDC. Never assumes the result.
 *
 * Live phase needs: the stellar-cli identity `ferryline-testnet-operator` (or FERRYLINE_STELLAR_SECRET)
 * holding >= 1 testnet USDC. Optional FERRYLINE_EVM_ADDRESS (mint recipient on Ethereum Sepolia,
 * defaults to the dEaD address since this is testnet USDC).
 */
import { Report, env } from "./lib/report.js";
import {
  burn,
  feesEvidence,
  irisEvidence,
  minFeeEvidence,
  mintRecipientFromEnv,
  testnetBurnSetup,
} from "./lib/cctp-run.js";

const report = new Report(
  "cctp-burn-max-fee-zero",
  "Does a Stellar-source CCTP burn with max_fee = 0 get accepted on-chain and attested by Circle?",
);

await feesEvidence(report);
await minFeeEvidence(report);
report.section("Evidence: allowance model");
report.line(
  '- Read-only mainnet and testnet simulations on 2026-09-11 showed deposit_for_burn calling USDC.transfer_from(TokenMessengerMinter, caller, TokenMessengerMinter, amount) and failing with "not enough allowance to spend" when no approve preceded it. A Stellar-source burn is therefore two transactions: approve, then deposit_for_burn. Those simulations stopped at the allowance check, so they say nothing about max_fee; that is what the live burn is for.',
);

const amount = env("FERRYLINE_CCTP_AMOUNT_USDC") ?? "1";
const setup = await testnetBurnSetup(report, amount);
if (!setup) {
  report.finish(
    "BLOCKED",
    "Not run: the testnet operator holds no USDC. Evidence above is read-only (fee API + on-chain min fee = 0) and is NOT a substitute for the burn.",
  );
  process.exit(0);
}
const amountStroops = BigInt(Math.round(Number(amount) * 1e7));
const result = await burn(
  setup,
  { amountStroops, maxFee: 0n, minFinalityThreshold: 2000, mintRecipient: mintRecipientFromEnv() },
  report,
);
if (!result.hash) {
  report.finish(
    "FAILED",
    `The burn was rejected before submission: ${result.simulationError ?? "unknown"}. max_fee = 0 is NOT confirmed.`,
  );
  process.exit(0);
}
const iris = (await irisEvidence(result.hash, report)) as
  { body?: { messages?: { status?: string }[] } } | undefined;
const attested = iris?.body?.messages?.[0]?.status === "complete";
report.finish(
  "RAN",
  attested
    ? `Burn ${result.hash} with max_fee = 0 was accepted on-chain and Circle attested it: no upfront fee is required for Stellar as source (testnet).`
    : `Burn ${result.hash} submitted with max_fee = 0; Circle's attestation did not reach status "complete" within the polling window. Inspect the Iris response above before concluding anything.`,
);
