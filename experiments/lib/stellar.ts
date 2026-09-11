import { execFileSync } from "node:child_process";

import {
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { Account, Asset, Transaction, xdr } from "@stellar/stellar-sdk";
import { Api, Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

import { env } from "./report.js";

export interface StellarNet {
  readonly name: "testnet" | "mainnet";
  readonly rpcUrl: string;
  readonly horizonUrl: string;
  readonly passphrase: string;
}

export const TESTNET: StellarNet = {
  name: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  passphrase: Networks.TESTNET,
};

export const MAINNET: StellarNet = {
  name: "mainnet",
  rpcUrl: "https://mainnet.sorobanrpc.com",
  horizonUrl: "https://horizon.stellar.org",
  passphrase: Networks.PUBLIC,
};

/**
 * Operator key: FERRYLINE_STELLAR_SECRET, or a stellar-cli identity named by
 * FERRYLINE_STELLAR_IDENTITY (default "ferryline-testnet-operator", created 2026-09-11 for this repo).
 */
export function operatorKeypair(): Keypair | undefined {
  const secret = env("FERRYLINE_STELLAR_SECRET");
  if (secret) {
    return Keypair.fromSecret(secret);
  }
  const identity = env("FERRYLINE_STELLAR_IDENTITY") ?? "ferryline-testnet-operator";
  try {
    // stellar-cli stores identities as seed phrases; let it derive the secret rather than re-implementing that.
    const out = execFileSync("stellar", ["keys", "secret", identity], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^S[A-Z2-7]{55}$/.test(out) ? Keypair.fromSecret(out) : undefined;
  } catch {
    return undefined;
  }
}

export interface Balances {
  readonly xlm: string;
  readonly lines: readonly { code: string; issuer: string; balance: string }[];
}

export async function balances(net: StellarNet, accountId: string): Promise<Balances | undefined> {
  const response = await fetch(`${net.horizonUrl}/accounts/${accountId}`);
  if (response.status === 404) {
    return undefined;
  }
  const account = (await response.json()) as {
    balances: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }[];
  };
  const xlm = account.balances.find((b) => b.asset_type === "native")?.balance ?? "0";
  const lines = account.balances
    .filter((b) => b.asset_type !== "native")
    .map((b) => ({ code: b.asset_code ?? "", issuer: b.asset_issuer ?? "", balance: b.balance }));
  return { xlm, lines };
}

export async function submit(
  net: StellarNet,
  tx: Transaction,
): Promise<Api.GetTransactionResponse> {
  const server = new Server(net.rpcUrl);
  const sent = await server.sendTransaction(tx);
  if (sent.status !== "PENDING") {
    throw new Error(
      `sendTransaction: ${sent.status} ${sent.errorResult ? sent.errorResult.toXDR("base64") : ""}`,
    );
  }
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    const result = await server.getTransaction(sent.hash);
    if (result.status !== Api.GetTransactionStatus.NOT_FOUND) {
      return result;
    }
  }
  throw new Error(`transaction ${sent.hash} not found after 60 s`);
}

export async function ensureTrustline(
  net: StellarNet,
  keypair: Keypair,
  asset: Asset,
): Promise<"present" | "added"> {
  const current = await balances(net, keypair.publicKey());
  if (current?.lines.some((l) => l.code === asset.getCode() && l.issuer === asset.getIssuer())) {
    return "present";
  }
  const server = new Server(net.rpcUrl);
  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: net.passphrase })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(120)
    .build();
  tx.sign(keypair);
  const result = await submit(net, tx);
  if (result.status !== Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`changeTrust failed: ${result.status}`);
  }
  return "added";
}

export interface InvokeOutcome {
  readonly simulation: "ok" | "error";
  readonly simulationError?: string;
  /** Return value of a successful simulation (view calls). */
  readonly retval?: xdr.ScVal;
  readonly diagnostics: readonly string[];
  readonly submitted?: { hash: string; status: string };
}

/** Simulate a contract call; submit it only when `send` is true and the simulation succeeded. */
export async function invoke(
  net: StellarNet,
  keypair: Keypair,
  contractId: string,
  fn: string,
  args: xdr.ScVal[],
  send: boolean,
): Promise<InvokeOutcome> {
  const server = new Server(net.rpcUrl);
  const account: Account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: net.passphrase })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(120)
    .build();
  const sim = await server.simulateTransaction(tx);
  const diagnostics = (sim.events ?? []).map((e) => e.toXDR("base64"));
  if (Api.isSimulationError(sim)) {
    return { simulation: "error", simulationError: sim.error, diagnostics };
  }
  if (!send) {
    return sim.result
      ? { simulation: "ok", diagnostics, retval: sim.result.retval }
      : { simulation: "ok", diagnostics };
  }
  const prepared = assembleTransaction(tx, sim).build();
  prepared.sign(keypair);
  const result = await submit(net, prepared);
  return {
    simulation: "ok",
    diagnostics,
    submitted: { hash: result.txHash, status: result.status },
  };
}
