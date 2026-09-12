import { FerrylineError } from "@ferryline/core";
import { BASE_FEE, Contract, Keypair, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import type { Account, Asset, Transaction } from "@stellar/stellar-sdk";
import { Api, assembleTransaction } from "@stellar/stellar-sdk/rpc";

/**
 * The slice of `rpc.Server` the adapter uses. `rpc.Server` satisfies it structurally;
 * tests substitute recorded responses.
 */
export interface StellarRpc {
  simulateTransaction(tx: Transaction): Promise<Api.SimulateTransactionResponse>;
  getTransaction(hash: string): Promise<Api.GetTransactionResponse>;
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<Api.GetLedgerEntriesResponse>;
  getLatestLedger(): Promise<Api.GetLatestLedgerResponse>;
  getAccount(address: string): Promise<Account>;
}

export interface InvokeParams {
  readonly rpc: StellarRpc;
  readonly source: Account;
  readonly networkPassphrase: string;
  readonly contractId: string;
  readonly fn: string;
  readonly args: readonly xdr.ScVal[];
  readonly timeoutSeconds?: number;
}

function upstream(message: string, cause?: unknown): FerrylineError {
  return new FerrylineError("UPSTREAM_ERROR", message, cause === undefined ? undefined : { cause });
}

function buildUnsimulated(params: InvokeParams): Transaction {
  // No memo is ever attached here. Soroban's InvokeHostFunctionOp transactions reject MEMO_TEXT
  // outright (confirmed via a real testnet RPC rejection, widget phase STEP 1) — this used to be a
  // `memoText` parameter that attached one, and the field was removed rather than left unused after
  // finding it was the shared primitive all three now-fixed call sites funneled the bug through (see
  // packages/sdk/CHANGELOG.md's "Unreleased" entry). Removing it here, not just at the call sites,
  // makes it a compile-time impossibility for any future caller to reintroduce this bug through this
  // function, rather than relying on nobody happening to pass the field.
  return new TransactionBuilder(params.source, {
    fee: BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(new Contract(params.contractId).call(params.fn, ...params.args))
    .setTimeout(params.timeoutSeconds ?? 300)
    .build();
}

/** Simulate a read-only contract call and hand back the raw return value. Never submits. */
export async function simulateView(params: InvokeParams): Promise<xdr.ScVal> {
  const tx = buildUnsimulated(params);
  const sim = await params.rpc.simulateTransaction(tx);
  if (Api.isSimulationError(sim)) {
    throw upstream(`${params.fn} simulation failed: ${sim.error}`);
  }
  if (!Api.isSimulationSuccess(sim) || sim.result === undefined) {
    throw upstream(`${params.fn} simulation returned no result`);
  }
  return sim.result.retval;
}

export interface BuiltInvocation {
  /** Base64 transaction envelope, unsigned. */
  readonly xdr: string;
  readonly minResourceFee: string;
}

/** Simulate, attach footprint and resource fee, and return the unsigned envelope. Never submits. */
export async function buildInvocation(params: InvokeParams): Promise<BuiltInvocation> {
  const tx = buildUnsimulated(params);
  const sim = await params.rpc.simulateTransaction(tx);
  if (Api.isSimulationError(sim)) {
    throw upstream(`${params.fn} simulation failed: ${sim.error}`);
  }
  if (!Api.isSimulationSuccess(sim)) {
    throw upstream(`${params.fn} simulation returned no result`);
  }
  const assembled = assembleTransaction(tx, sim).build();
  return { xdr: assembled.toXDR(), minResourceFee: sim.minResourceFee };
}

export interface TrustlineState {
  readonly balance: bigint;
  readonly limit: bigint;
  readonly authorized: boolean;
}

export function trustlineKey(accountId: string, asset: Asset): xdr.LedgerKey {
  return xdr.LedgerKey.trustline(
    new xdr.LedgerKeyTrustLine({
      accountId: Keypair.fromPublicKey(accountId).xdrAccountId(),
      asset: asset.toTrustLineXDRObject(),
    }),
  );
}

export function accountKey(accountId: string): xdr.LedgerKey {
  return xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(accountId).xdrAccountId() }),
  );
}

const AUTHORIZED_FLAG = 1;

/** Undefined when the account holds no trustline for the asset. */
export async function getTrustline(
  rpc: StellarRpc,
  accountId: string,
  asset: Asset,
): Promise<TrustlineState | undefined> {
  const response = await rpc.getLedgerEntries(trustlineKey(accountId, asset));
  const entry = response.entries[0];
  if (entry?.val.type !== "trustline") {
    return undefined;
  }
  const line = entry.val.trustLine;
  return {
    balance: line.balance,
    limit: line.limit,
    authorized: (line.flags & AUTHORIZED_FLAG) === AUTHORIZED_FLAG,
  };
}

/** Native XLM balance in stroops, or undefined when the account does not exist. */
export async function getNativeBalance(
  rpc: StellarRpc,
  accountId: string,
): Promise<bigint | undefined> {
  const response = await rpc.getLedgerEntries(accountKey(accountId));
  const entry = response.entries[0];
  return entry?.val.type === "account" ? entry.val.account.balance : undefined;
}

