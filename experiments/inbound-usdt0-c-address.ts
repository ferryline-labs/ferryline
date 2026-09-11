/**
 * EXPERIMENT: send USDT0 from an EVM chain to a Stellar C-address (smart account). Determines whether
 * the Stellar OFT can deliver to a contract recipient at all, which decides whether the SDK's
 * G-only restriction for inbound USDT0 can ever be lifted.
 *
 * Spends real assets (mainnet only; USDT0 has no testnet deployment). Required:
 *   FERRYLINE_NETWORK=mainnet  FERRYLINE_I_ACCEPT_MAINNET_SPEND=yes
 *   FERRYLINE_STELLAR_SMART_ACCOUNT=C…  (a contract the operator controls and can inspect)
 *   FERRYLINE_EVM_CHAIN, FERRYLINE_EVM_RPC_URL, FERRYLINE_EVM_PRIVATE_KEY, optional FERRYLINE_USDT0_AMOUNT_LD
 */
import { contractAddressToBytes32, parseStellarAddress } from "@ferryline/core";
import { USDT0_STELLAR_MAINNET, evmUsdt0Chain } from "@ferryline/sdk";
import { Address, Contract, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

import { Report, env } from "./lib/report.js";
import { MAINNET } from "./lib/stellar.js";
import { pollScan, sendUsdt0FromEvm } from "./lib/usdt0-evm.js";

const report = new Report(
  "inbound-usdt0-c-address",
  "Can inbound USDT0 be delivered to a C-address (contract / smart account) on Stellar, and how does the OFT interpret the 32-byte `to`?",
);

report.section("Evidence collected without spending");
report.line(
  "- SendParam.to is BytesN<32>. A G account key and a C contract id are both 32 bytes, so the bytes alone cannot say which kind the recipient is. How the Stellar OFT resolves that on receive is documented nowhere in the four upstream sources (VERIFIED.md §4.1).",
);
report.line(
  "- The OFTReceived event carries `to: Address` (verified/usdt0-oft.mainnet.rs), so a successful delivery to a contract would be visible on-chain as an oft_received event with a C address.",
);
report.line(
  "- Contrast: Circle's CctpForwarder receives the recipient as a strkey string and emits MuxedAddress, so the CCTP rail has no such ambiguity.",
);

report.section("Live run");
const missing: string[] = [];
if (env("FERRYLINE_NETWORK") !== "mainnet") missing.push("FERRYLINE_NETWORK=mainnet");
if (env("FERRYLINE_I_ACCEPT_MAINNET_SPEND") !== "yes")
  missing.push("FERRYLINE_I_ACCEPT_MAINNET_SPEND=yes");
const smart = env("FERRYLINE_STELLAR_SMART_ACCOUNT");
if (!smart || parseStellarAddress(smart).kind !== "contract")
  missing.push("FERRYLINE_STELLAR_SMART_ACCOUNT=C… (contract you control)");
const chain = evmUsdt0Chain(env("FERRYLINE_EVM_CHAIN") ?? "");
if (!chain) missing.push("FERRYLINE_EVM_CHAIN");
const evmRpc = env("FERRYLINE_EVM_RPC_URL");
const evmKey = env("FERRYLINE_EVM_PRIVATE_KEY");
if (!evmRpc) missing.push("FERRYLINE_EVM_RPC_URL");
if (!evmKey) missing.push("FERRYLINE_EVM_PRIVATE_KEY");
if (missing.length > 0 || !smart || !chain || !evmRpc || !evmKey) {
  for (const m of missing) report.line(`- missing: ${m}`);
  report.line(
    "- Nothing was sent. The SDK keeps refusing C and M recipients for inbound USDT0 (UNSUPPORTED_RECIPIENT_KIND).",
  );
  report.finish(
    "BLOCKED",
    "Not run: needs a mainnet operator with USDT0 on an EVM chain and a Stellar smart account to target.",
  );
  process.exit(0);
}

const smartAccount: string = smart;
const rpc = new Server(MAINNET.rpcUrl);
const sac = new Contract(USDT0_STELLAR_MAINNET.sac);
async function sacBalance(): Promise<bigint> {
  const account = await rpc.getAccount(USDT0_STELLAR_MAINNET.issuer);
  const { TransactionBuilder, BASE_FEE } = await import("@stellar/stellar-sdk");
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: MAINNET.passphrase,
  })
    .addOperation(sac.call("balance", new Address(smartAccount).toScVal()))
    .setTimeout(60)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  return "result" in sim && sim.result ? (scValToNative(sim.result.retval) as bigint) : 0n;
}
const balanceBefore = await sacBalance();
report.line(`- smart account ${smart} USDT0 balance before: ${balanceBefore.toString()} stroops`);

const amountLd = BigInt(env("FERRYLINE_USDT0_AMOUNT_LD") ?? "1000000");
const sent = await sendUsdt0FromEvm({
  chain,
  rpcUrl: evmRpc,
  privateKey: evmKey as `0x${string}`,
  amountLD: amountLd,
  toBytes32: `0x${Buffer.from(contractAddressToBytes32(smart)).toString("hex")}`,
  dstEid: USDT0_STELLAR_MAINNET.eid,
  report,
});
report.line(`- EVM send tx: ${sent.txHash}`);
const final = await pollScan(sent.txHash, 40 * 60_000, report);
report.line(
  `- final Scan status: ${final?.status.name ?? "not indexed"} ${final?.status.message ?? ""}`,
);
const balanceAfter = await sacBalance();
report.line(
  `- smart account USDT0 balance after: ${balanceAfter.toString()} stroops (delta ${(balanceAfter - balanceBefore).toString()})`,
);
void nativeToScVal;

const credited = balanceAfter - balanceBefore === amountLd * 10n;
report.finish(
  "RAN",
  credited
    ? "The C-address received the full amount: the OFT resolves a 32-byte `to` that matches a contract id as a contract. Do NOT lift the SDK restriction on this alone; bring this file to review."
    : `The C-address was not credited (delta ${(balanceAfter - balanceBefore).toString()}; Scan ${final?.status.name ?? "?"}). The G-only restriction stays.`,
);
