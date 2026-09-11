/* Test double that replays recorded mainnet simulations. Not shipped: not reachable from src/index.ts. */
import { Account, Address, SorobanDataBuilder, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";

import type { StellarRpc } from "./rpc.js";

export interface RecordedSimulation {
  fn: string;
  contractId: string;
  args: string[];
  retvalXdr: string;
  transactionDataXdr: string;
  minResourceFee: string;
  authXdr: string[];
  latestLedger: number;
}

export interface RecordedLedgerEntry {
  keyXdr: string;
  valXdr: string;
  lastModifiedLedgerSeq: number;
}

export interface RecordedTransaction {
  ledger?: number;
  returnValueXdr?: string;
}

export interface FakeRpcOptions {
  /** Drop trustline entries to simulate an account without one. */
  withoutTrustline?: boolean;
  /** Force getTransaction's answer for every hash. */
  txStatus?: "SUCCESS" | "NOT_FOUND" | "FAILED";
  /** Replace the recorded return value of a function; receives the call's decoded arguments. */
  overrides?: Record<string, (args: unknown[]) => xdr.ScVal>;
  /** Functions whose recording may be matched by name alone when the arguments differ. */
  looseMatch?: readonly string[];
}

export class FakeStellarRpc implements StellarRpc {
  readonly calls: string[] = [];
  readonly options: FakeRpcOptions;

  constructor(
    private readonly recordings: readonly RecordedSimulation[],
    private readonly ledgerEntries: readonly RecordedLedgerEntry[],
    private readonly transactions: Readonly<Record<string, RecordedTransaction>>,
    options: FakeRpcOptions = {},
    private readonly latestLedger = 1,
  ) {
    this.options = options;
  }

  simulateTransaction(tx: Transaction): Promise<Api.SimulateTransactionResponse> {
    const op = tx.operations[0];
    if (op?.type !== "invokeHostFunction" || op.func.type !== "hostFunctionTypeInvokeContract") {
      throw new Error("fake rpc: expected an invokeHostFunction operation");
    }
    const invoke = op.func.invokeContract;
    const fn = invoke.functionName.toString();
    const contractId = Address.fromScAddress(invoke.contractAddress).toString();
    const args = invoke.args.map((a) => a.toXDR("base64"));
    this.calls.push(`${fn}@${contractId.slice(0, 4)}`);
    const candidates = this.recordings.filter((s) => s.fn === fn && s.contractId === contractId);
    const exact = candidates.find(
      (s) => s.args.length === args.length && s.args.every((a, i) => a === args[i]),
    );
    const recorded = exact ?? (this.options.looseMatch?.includes(fn) ? candidates[0] : undefined);
    if (!recorded) {
      throw new Error(`fake rpc: no recording for ${fn} on ${contractId} with these args`);
    }
    const override = this.options.overrides?.[fn];
    const retval = override
      ? override(invoke.args.map((a) => scValToNative(a) as unknown))
      : xdr.ScVal.fromXDR(recorded.retvalXdr, "base64");
    const response: Api.SimulateTransactionSuccessResponse = {
      _parsed: true,
      id: "fake",
      latestLedger: recorded.latestLedger,
      events: [],
      minResourceFee: recorded.minResourceFee,
      transactionData: new SorobanDataBuilder(recorded.transactionDataXdr),
      result: {
        auth: recorded.authXdr.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64")),
        retval,
      },
    };
    return Promise.resolve(response);
  }

  getTransaction(hash: string): Promise<Api.GetTransactionResponse> {
    this.calls.push(`getTransaction:${hash.slice(0, 8)}`);
    const recorded = this.transactions[hash];
    const status = this.options.txStatus ?? (recorded ? "SUCCESS" : "NOT_FOUND");
    if (status === "NOT_FOUND") {
      return Promise.resolve({
        status: Api.GetTransactionStatus.NOT_FOUND,
        txHash: hash,
      } as unknown as Api.GetTransactionResponse);
    }
    if (status === "FAILED") {
      return Promise.resolve({
        status: Api.GetTransactionStatus.FAILED,
        txHash: hash,
      } as unknown as Api.GetTransactionResponse);
    }
    return Promise.resolve({
      status: Api.GetTransactionStatus.SUCCESS,
      txHash: hash,
      ledger: recorded?.ledger,
      returnValue: recorded?.returnValueXdr
        ? xdr.ScVal.fromXDR(recorded.returnValueXdr, "base64")
        : undefined,
    } as unknown as Api.GetTransactionResponse);
  }

  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<Api.GetLedgerEntriesResponse> {
    const wanted = new Set(keys.map((k) => k.toXDR("base64")));
    const entries = this.ledgerEntries
      .filter((e) => wanted.has(e.keyXdr))
      .filter(
        (e) =>
          !(
            this.options.withoutTrustline &&
            xdr.LedgerKey.fromXDR(e.keyXdr, "base64").type === "trustline"
          ),
      )
      .map((e) => ({
        key: xdr.LedgerKey.fromXDR(e.keyXdr, "base64"),
        val: xdr.LedgerEntryData.fromXDR(e.valXdr, "base64"),
        lastModifiedLedgerSeq: e.lastModifiedLedgerSeq,
      }));
    return Promise.resolve({ entries, latestLedger: this.latestLedger });
  }

  getLatestLedger(): Promise<Api.GetLatestLedgerResponse> {
    return Promise.resolve({
      id: "fake",
      sequence: this.latestLedger,
      protocolVersion: "25",
    } as unknown as Api.GetLatestLedgerResponse);
  }

  getAccount(address: string): Promise<Account> {
    return Promise.resolve(new Account(address, "100"));
  }
}
