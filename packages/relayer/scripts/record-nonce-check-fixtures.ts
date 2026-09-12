/**
 * Records READ-ONLY mainnet is_nonce_used simulations for the crash-recovery test: one nonce that a
 * real inbound message actually delivered (must read true), and one nonce no real message has ever
 * used (must read false). Nothing is signed or submitted.
 *
 * Run: pnpm --filter ferryline-relayer record:nonce-fixtures
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nativeToScVal } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { BASE_FEE, Contract, TransactionBuilder } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const PASSPHRASE = "Public Global Stellar Network ; September 2015";
const MESSAGE_TRANSMITTER = "CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV";
const SIMULATION_SOURCE = "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q";

/** Real nonce from a real inbound (EVM -> Stellar) CCTP message this repo observed being delivered
 *  in Phase 2 (packages/core/verified/experiments/evidence/iris.mainnet.inbound-to-stellar.observed.json,
 *  mainnet tx 477d4be2b515be2d4d401c017b2d4939f6b5466fdd32eb86c12c53d762438e6f). */
const DELIVERED_NONCE_HEX = "ca5198d4a648c9d8f60176a689c9bf5218dec36623fcab7871b6a619dfa8ee9b";
/** All-ones: not a value any real CCTP message nonce (an HMAC-derived 32-byte value) would produce. */
const UNUSED_NONCE_HEX = "f".repeat(64); // 32 bytes, not a value any real CCTP nonce would take

interface Recorded {
  nonceHex: string;
  expected: boolean;
  retvalXdr: string;
  transactionDataXdr: string;
  minResourceFee: string;
  authXdr: string[];
  latestLedger: number;
}

const rpc = new Server(RPC_URL);
const account = await rpc.getAccount(SIMULATION_SOURCE);

async function record(nonceHex: string, expected: boolean): Promise<Recorded> {
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(
      new Contract(MESSAGE_TRANSMITTER).call(
        "is_nonce_used",
        nativeToScVal(Buffer.from(nonceHex, "hex"), { type: "bytes" }),
      ),
    )
    .setTimeout(300)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  if (!Api.isSimulationSuccess(sim) || sim.result === undefined) {
    throw new Error(
      `is_nonce_used(${nonceHex}): ${Api.isSimulationError(sim) ? sim.error : "no result"}`,
    );
  }
  return {
    nonceHex,
    expected,
    retvalXdr: sim.result.retval.toXDR("base64"),
    transactionDataXdr: sim.transactionData.build().toXDR("base64"),
    minResourceFee: sim.minResourceFee,
    authXdr: sim.result.auth.map((a) => a.toXDR("base64")),
    latestLedger: sim.latestLedger,
  };
}

const delivered = await record(DELIVERED_NONCE_HEX, true);
const unused = await record(UNUSED_NONCE_HEX, false);

const out = {
  recordedAt: new Date().toISOString(),
  rpcUrl: RPC_URL,
  network: "mainnet",
  messageTransmitterContractId: MESSAGE_TRANSMITTER,
  simulationSourceAccount: SIMULATION_SOURCE,
  fixtures: [delivered, unused],
};

const here = dirname(fileURLToPath(import.meta.url));
const file = join(
  here,
  "..",
  "src",
  "chain",
  "__fixtures__",
  "is-nonce-used-mainnet-2026-09-11.json",
);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.error("wrote", file);
console.error("delivered nonce ->", delivered.expected);
console.error("unused nonce    ->", unused.expected);
