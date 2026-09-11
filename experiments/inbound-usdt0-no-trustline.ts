/**
 * EXPERIMENT: send USDT0 into a Stellar account that has NO trustline; record the failure; add the
 * trustline; find out whether LayerZero delivers it afterwards or the message is permanently failed.
 *
 * Spends real assets: USDT0 has no Stellar testnet deployment, so this can only run on mainnet.
 * Required to run the live phase:
 *   FERRYLINE_NETWORK=mainnet  FERRYLINE_I_ACCEPT_MAINNET_SPEND=yes
 *   FERRYLINE_STELLAR_SECRET=S…        (funds a throwaway recipient account with ~2 XLM)
 *   FERRYLINE_EVM_CHAIN=polygon        (any chain in USDT0_EVM_CHAINS)
 *   FERRYLINE_EVM_RPC_URL=https://…    FERRYLINE_EVM_PRIVATE_KEY=0x…  (holds USDT0 + gas)
 *   FERRYLINE_USDT0_AMOUNT_LD=1000000  (optional; 6-decimal units, default 1 USDT0)
 * Without them the script records the read-only evidence and exits BLOCKED.
 */
import { accountAddressToBytes32 } from "@ferryline/core";
import { USDT0_STELLAR_MAINNET, evmUsdt0Chain } from "@ferryline/sdk";
import { Asset, BASE_FEE, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

import { Report, env } from "./lib/report.js";
import { MAINNET, balances, ensureTrustline, operatorKeypair, submit } from "./lib/stellar.js";
import { stellarTestnetHasUsdt0 } from "./lib/usdt0.js";
import { pollScan, sendUsdt0FromEvm } from "./lib/usdt0-evm.js";

const report = new Report(
  "inbound-usdt0-no-trustline",
  "When USDT0 is sent to a Stellar account with no trustline, what exactly fails, and is delivery retried once the trustline exists?",
);

report.section("Evidence collected without spending");
const testnet = await stellarTestnetHasUsdt0();
report.line(
  `- LayerZero's OFT list has USDT0 on stellar-testnet: ${String(testnet.layerZeroList)}.`,
);
report.line(
  `- Horizon testnet lists ${String(testnet.horizonIssuers.length)} unrelated issuers of an asset coded "USDT0"; none is Tether's. So there is no testnet path for this experiment.`,
);
report.line(
  '- developers.stellar.org/launch/usdt0 (2026-09-11): "Sending USDT0 to an account that has no USDT0 trustline fails with op_no_trust."',
);
report.line(
  "- LayerZero Scan indexes Stellar sends (two real mainnet messages recorded under verified/experiments/evidence/). Scan's status name is the observation channel for the retry question; PAYLOAD_STORED is LayerZero's name for a verified-but-undeliverable message.",
);

report.section("Live run");
const missing: string[] = [];
if (env("FERRYLINE_NETWORK") !== "mainnet") missing.push("FERRYLINE_NETWORK=mainnet");
if (env("FERRYLINE_I_ACCEPT_MAINNET_SPEND") !== "yes")
  missing.push("FERRYLINE_I_ACCEPT_MAINNET_SPEND=yes");
const funder = env("FERRYLINE_STELLAR_SECRET") ? operatorKeypair() : undefined;
if (!funder) missing.push("FERRYLINE_STELLAR_SECRET (mainnet account with a few XLM)");
const chain = evmUsdt0Chain(env("FERRYLINE_EVM_CHAIN") ?? "");
if (!chain) missing.push("FERRYLINE_EVM_CHAIN (one of the USDT0 EVM chains)");
const evmRpc = env("FERRYLINE_EVM_RPC_URL");
const evmKey = env("FERRYLINE_EVM_PRIVATE_KEY");
if (!evmRpc) missing.push("FERRYLINE_EVM_RPC_URL");
if (!evmKey) missing.push("FERRYLINE_EVM_PRIVATE_KEY (holds USDT0 and gas)");
if (missing.length > 0 || !funder || !chain || !evmRpc || !evmKey) {
  for (const m of missing) report.line(`- missing: ${m}`);
  report.line("- Nothing was sent. No assumption about the retry behaviour is recorded.");
  report.finish(
    "BLOCKED",
    "Not run: needs a mainnet operator with USDT0 on an EVM chain plus XLM; see the required environment above.",
  );
  process.exit(0);
}

const amountLd = BigInt(env("FERRYLINE_USDT0_AMOUNT_LD") ?? "1000000");
const recipient = Keypair.random();
report.line(`- fresh recipient (no trustline): ${recipient.publicKey()}`);
const rpc = new Server(MAINNET.rpcUrl);
const funderAccount = await rpc.getAccount(funder.publicKey());
const create = new TransactionBuilder(funderAccount, {
  fee: BASE_FEE,
  networkPassphrase: MAINNET.passphrase,
})
  .addOperation(
    Operation.createAccount({ destination: recipient.publicKey(), startingBalance: "2" }),
  )
  .setTimeout(120)
  .build();
create.sign(funder);
const created = await submit(MAINNET, create);
report.line(`- createAccount: ${created.status} (${created.txHash})`);

const sent = await sendUsdt0FromEvm({
  chain,
  rpcUrl: evmRpc,
  privateKey: evmKey as `0x${string}`,
  amountLD: amountLd,
  toBytes32: `0x${Buffer.from(accountAddressToBytes32(recipient.publicKey())).toString("hex")}`,
  dstEid: USDT0_STELLAR_MAINNET.eid,
  report,
});
report.line(`- EVM send tx: ${sent.txHash} (fee quoted ${sent.nativeFee.toString()} wei)`);

report.section("Phase 1: without trustline");
const before = await pollScan(sent.txHash, 40 * 60_000, report);
report.line(
  `- final Scan status before trustline: ${before?.status.name ?? "not indexed"} ${before?.status.message ?? ""}`,
);
report.line(
  `- recipient balances: ${JSON.stringify(await balances(MAINNET, recipient.publicKey()))}`,
);

report.section("Phase 2: after adding the trustline");
const added = await ensureTrustline(
  MAINNET,
  recipient,
  new Asset(USDT0_STELLAR_MAINNET.assetCode, USDT0_STELLAR_MAINNET.issuer),
);
report.line(`- trustline: ${added}`);
const after = await pollScan(sent.txHash, 40 * 60_000, report, before?.status.name);
report.line(
  `- final Scan status after trustline: ${after?.status.name ?? "not indexed"} ${after?.status.message ?? ""}`,
);
report.line(
  `- recipient balances: ${JSON.stringify(await balances(MAINNET, recipient.publicKey()))}`,
);
report.line(
  `- recipient secret kept in experiments/logs (gitignored) so funds can be recovered: ${recipient.secret()}`,
);

const delivered = after?.status.name === "DELIVERED";
report.finish(
  "RAN",
  delivered
    ? `Delivery completed after the trustline was added (Scan went ${before?.status.name ?? "?"} -> DELIVERED without manual retry).`
    : `Delivery did NOT complete within the polling window after adding the trustline (Scan: ${after?.status.name ?? "?"}). Manual re-execution may be required; this is the definitive answer for the SDK's inbound preflight.`,
);
