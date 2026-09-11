/**
 * Records READ-ONLY mainnet responses the CCTP adapter tests replay. Nothing is signed or submitted.
 * Run: pnpm --filter @ferryline/sdk record:cctp-fixtures
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  encodeMuxedAccountToAddress,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import type { xdr } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";

import { accountKey, trustlineKey } from "../src/stellar/rpc.js";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const PASS = "Public Global Stellar Network ; September 2015";
const TMM = "CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL";
const MT = "CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV";
const USDC_SAC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
/** Real Stellar -> Base burn observed on 2026-09-11 (Iris: complete, maxFee 0, threshold 2000). */
const BURN_TX = "150b5711d44788f3179ba900b4122c6c2a21919a054400e28e419f599d705d92";
const here = dirname(fileURLToPath(import.meta.url));
const evidence = join(here, "..", "..", "core", "verified", "experiments", "evidence");

const rpc = new Server(RPC_URL);
const burn = await rpc.getTransaction(BURN_TX);
if (burn.status !== Api.GetTransactionStatus.SUCCESS) {
  throw new Error(`burn tx ${BURN_TX} not retrievable: ${burn.status}`);
}
const envelope = burn.envelopeXdr;
if (envelope.type !== "envelopeTypeTx") {
  throw new Error(`unexpected envelope type ${envelope.type}`);
}
const tx = envelope.v1.tx;
const sender = encodeMuxedAccountToAddress(tx.sourceAccount);
const op = tx.operations[0]?.body;
if (
  op?.type !== "invokeHostFunction" ||
  op.invokeHostFunctionOp.hostFunction.type !== "hostFunctionTypeInvokeContract"
) {
  throw new Error("unexpected burn tx shape");
}
const invoke = op.invokeHostFunctionOp.hostFunction.invokeContract;
const account = await rpc.getAccount(sender);

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
  const t = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(300)
    .build();
  const sim = await rpc.simulateTransaction(t);
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
const latest = await rpc.getLatestLedger();
const iris = JSON.parse(
  readFileSync(join(evidence, "iris.mainnet.stellar-source-burn.150b5711.json"), "utf8"),
) as {
  messages: { eventNonce: string; message: string; attestation: string; status: string }[];
};
const nonce = Buffer.from(iris.messages[0]!.eventNonce.slice(2), "hex");
const sims: Recorded[] = [];
sims.push(
  await simulate(USDC_SAC, "allowance", [
    new Address(sender).toScVal(),
    new Address(TMM).toScVal(),
  ]),
);
sims.push(
  await simulate(USDC_SAC, "approve", [
    new Address(sender).toScVal(),
    new Address(TMM).toScVal(),
    nativeToScVal(10_000_000n, { type: "i128" }),
    nativeToScVal(latest.sequence + 1000, { type: "u32" }),
  ]),
);
sims.push(await simulate(USDC_SAC, "balance", [new Address(sender).toScVal()]));
sims.push(await simulate(MT, "is_nonce_used", [nativeToScVal(nonce, { type: "bytes" })]));
sims.push(
  await simulate(MT, "is_nonce_used", [nativeToScVal(Buffer.alloc(32), { type: "bytes" })]),
);
sims.push(await simulate(MT, "paused", []));
sims.push(await simulate(MT, "get_local_domain", []));
sims.push(await simulate(TMM, "paused", []));
sims.push(await simulate(TMM, "get_min_fee", [new Address(USDC_SAC).toScVal()]));
sims.push(
  await simulate(TMM, "get_min_fee_amount", [
    new Address(USDC_SAC).toScVal(),
    nativeToScVal(10_000_000n, { type: "i128" }),
  ]),
);

const ledger = await rpc.getLedgerEntries(
  trustlineKey(sender, new Asset("USDC", USDC_ISSUER)),
  accountKey(sender),
);
const sorobanData = (tx.ext as { sorobanData?: xdr.SorobanTransactionData }).sorobanData;
if (!sorobanData) {
  throw new Error(
    `burn tx has no soroban data (ext type ${String((tx.ext as { type?: string }).type)})`,
  );
}
const out = {
  recordedAt: new Date().toISOString(),
  rpcUrl: RPC_URL,
  network: "mainnet",
  sender,
  latestLedger: latest.sequence,
  simulations: sims,
  burnTransaction: {
    hash: BURN_TX,
    ledger: burn.ledger,
    fn: invoke.functionName.toString(),
    contractId: Address.fromScAddress(invoke.contractAddress).toString(),
    args: invoke.args.map((a) => a.toXDR("base64")),
    sorobanDataXdr: sorobanData.toXDR("base64"),
    resourceFee: sorobanData.resourceFee.toString(),
    fee: tx.fee.toString(),
    authXdr: op.invokeHostFunctionOp.auth.map((a) => a.toXDR("base64")),
    memo: tx.memo.type,
  },
  ledgerEntries: ledger.entries.map((e) => ({
    keyXdr: e.key.toXDR("base64"),
    valXdr: e.val.toXDR("base64"),
    lastModifiedLedgerSeq: e.lastModifiedLedgerSeq,
  })),
  iris: iris,
};
const file = join(
  here,
  "..",
  "src",
  "rails",
  "usdc-cctp",
  "__fixtures__",
  "mainnet-2026-09-11.json",
);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.error("wrote", file);
console.error(
  "sender",
  sender,
  "| burn fn",
  out.burnTransaction.fn,
  "| resourceFee",
  out.burnTransaction.resourceFee,
  "| memo",
  out.burnTransaction.memo,
);
for (const s of sims)
  console.error(`  ${s.fn}@${s.contractId.slice(0, 4)} retval=${s.retvalXdr.slice(0, 24)}…`);
