/**
 * Records READ-ONLY mainnet responses the USDT0 adapter tests replay. Nothing is signed or submitted.
 * Run: pnpm --filter @ferryline/sdk record:usdt0-fixtures
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Address, Asset, BASE_FEE, Contract, TransactionBuilder } from "@stellar/stellar-sdk";
import type { xdr } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";

import { Client as OftClient } from "../src/rails/usdt0-layerzero/generated/oft.js";
import { USDT0_STELLAR_MAINNET as M } from "../src/rails/usdt0-layerzero/chains.js";
import { accountKey, trustlineKey } from "../src/rails/usdt0-layerzero/stellar.js";

const RPC_URL = "https://mainnet.sorobanrpc.com";
/** Sender of mainnet tx 9d130f64… (1 USDT0 to Polygon on 2026-09-04). Public data only. */
const SENDER = "GBBFBZR6OSK5RPZMOMRIODZH6TKOKEIENFBD54DB66G2UWAJOTSAZS3Z";
const SENT_TX = "9d130f64b3a4a9316222f8d7e246fe6992225e9438d45ca573e61540f8495f8a";
const POLYGON_EID = 30109;
const TO_POLYGON = Buffer.from(
  "000000000000000000000000e4b5fcce3cfbc86fdbb9fae472b14eea68fb301f",
  "hex",
);

const rpc = new Server(RPC_URL);
const spec = new OftClient({
  contractId: M.oft,
  networkPassphrase: M.networkPassphrase,
  rpcUrl: RPC_URL,
}).spec;
const account = await rpc.getAccount(SENDER);

interface Recorded {
  fn: string;
  contractId: string;
  args: string[];
  retvalXdr: string;
  transactionDataXdr: string;
  minResourceFee: string;
  authXdr: string[];
  latestLedger: number;
}

async function simulate(contractId: string, fn: string, args: xdr.ScVal[]): Promise<Recorded> {
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: M.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(300)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  if (!Api.isSimulationSuccess(sim) || sim.result === undefined) {
    throw new Error(`${fn}: ${Api.isSimulationError(sim) ? sim.error : "no result"}`);
  }
  return {
    fn,
    contractId,
    args: args.map((a) => a.toXDR("base64")),
    retvalXdr: sim.result.retval.toXDR("base64"),
    transactionDataXdr: sim.transactionData.build().toXDR("base64"),
    minResourceFee: sim.minResourceFee,
    authXdr: sim.result.auth.map((a) => a.toXDR("base64")),
    latestLedger: sim.latestLedger,
  };
}

const sendParamQuote = {
  amount_ld: 12345670n,
  compose_msg: Buffer.alloc(0),
  dst_eid: POLYGON_EID,
  extra_options: Buffer.alloc(0),
  min_amount_ld: 0n,
  oft_cmd: Buffer.alloc(0),
  to: TO_POLYGON,
};

const recorded: Recorded[] = [];
recorded.push(await simulate(M.oft, "is_paused", spec.funcArgsToScVals("is_paused", {})));
recorded.push(
  await simulate(M.oft, "approval_required", spec.funcArgsToScVals("approval_required", {})),
);
recorded.push(
  await simulate(M.oft, "shared_decimals", spec.funcArgsToScVals("shared_decimals", {})),
);
recorded.push(
  await simulate(
    M.oft,
    "decimal_conversion_rate",
    spec.funcArgsToScVals("decimal_conversion_rate", {}),
  ),
);
recorded.push(await simulate(M.oft, "peer", spec.funcArgsToScVals("peer", { eid: POLYGON_EID })));
recorded.push(await simulate(M.oft, "peer", spec.funcArgsToScVals("peer", { eid: 4242 })));
recorded.push(
  await simulate(
    M.oft,
    "has_oft_fee",
    spec.funcArgsToScVals("has_oft_fee", { dst_eid: POLYGON_EID }),
  ),
);
recorded.push(
  await simulate(
    M.oft,
    "quote_oft",
    spec.funcArgsToScVals("quote_oft", { from: SENDER, send_param: sendParamQuote }),
  ),
);
const quoteOft = spec.funcResToNative("quote_oft", recorded[recorded.length - 1]!.retvalXdr) as [
  { min_amount_ld: bigint; max_amount_ld: bigint },
  unknown[],
  { amount_sent_ld: bigint; amount_received_ld: bigint },
];
const sendParam = { ...sendParamQuote, min_amount_ld: quoteOft[2].amount_received_ld };
recorded.push(
  await simulate(
    M.oft,
    "quote_send",
    spec.funcArgsToScVals("quote_send", { from: SENDER, send_param: sendParam, pay_in_zro: false }),
  ),
);
const fee = spec.funcResToNative("quote_send", recorded[recorded.length - 1]!.retvalXdr) as {
  native_fee: bigint;
  zro_fee: bigint;
};
recorded.push(await simulate(M.sac, "balance", [new Address(SENDER).toScVal()]));
let sendSim: Recorded | { fn: string; error: string };
try {
  sendSim = await simulate(
    M.oft,
    "send",
    spec.funcArgsToScVals("send", {
      from: SENDER,
      send_param: sendParam,
      fee,
      refund_address: SENDER,
    }),
  );
} catch (error) {
  sendSim = { fn: "send", error: String(error) };
}

const ledger = await rpc.getLedgerEntries(
  trustlineKey(SENDER, new Asset(M.assetCode, M.issuer)),
  accountKey(SENDER),
);
const tx = await rpc.getTransaction(SENT_TX);
const latest = await rpc.getLatestLedger();

const out = {
  recordedAt: new Date().toISOString(),
  rpcUrl: RPC_URL,
  network: "mainnet",
  sender: SENDER,
  latestLedger: latest.sequence,
  simulations: recorded,
  sendSimulation: sendSim,
  ledgerEntries: ledger.entries.map((e) => ({
    keyXdr: e.key.toXDR("base64"),
    valXdr: e.val.toXDR("base64"),
    lastModifiedLedgerSeq: e.lastModifiedLedgerSeq,
  })),
  sentTransaction: {
    hash: SENT_TX,
    status: tx.status,
    ledger: tx.status === Api.GetTransactionStatus.SUCCESS ? tx.ledger : undefined,
    returnValueXdr:
      tx.status === Api.GetTransactionStatus.SUCCESS && tx.returnValue
        ? tx.returnValue.toXDR("base64")
        : undefined,
    envelopeXdr:
      tx.status === Api.GetTransactionStatus.SUCCESS ? tx.envelopeXdr.toXDR("base64") : undefined,
  },
  decoded: {
    quoteOft: {
      limit: {
        min: quoteOft[0].min_amount_ld.toString(),
        max: quoteOft[0].max_amount_ld.toString(),
      },
      received: quoteOft[2].amount_received_ld.toString(),
      sent: quoteOft[2].amount_sent_ld.toString(),
      feeDetails: quoteOft[1].length,
    },
    quoteSend: { nativeFee: fee.native_fee.toString(), zroFee: fee.zro_fee.toString() },
  },
};
const here = dirname(fileURLToPath(import.meta.url));
const file = join(
  here,
  "..",
  "src",
  "rails",
  "usdt0-layerzero",
  "__fixtures__",
  "mainnet-2026-09-11.json",
);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.error("wrote", file);
console.error(JSON.stringify(out.decoded, null, 1));
console.error(
  "send simulation:",
  "error" in sendSim
    ? sendSim.error
    : `ok, minResourceFee=${sendSim.minResourceFee}, auth entries=${String(sendSim.authXdr.length)}`,
);
