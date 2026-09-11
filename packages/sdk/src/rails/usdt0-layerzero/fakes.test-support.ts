/* Test doubles that replay the recorded mainnet fixtures. Not shipped: excluded via tsup entry. */
import type { TransferStage } from "@ferryline/core";
import { Account, xdr } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import { SorobanDataBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Address as StellarAddress } from "@stellar/stellar-sdk";

import type { EvmReader } from "./evm.js";
import type { ScanClient, ScanMessage } from "./scan.js";
import type { StellarRpc } from "./stellar.js";

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

export interface Fixture {
  sender: string;
  latestLedger: number;
  simulations: RecordedSimulation[];
  sendSimulation: RecordedSimulation | { fn: string; error: string };
  ledgerEntries: { keyXdr: string; valXdr: string; lastModifiedLedgerSeq: number }[];
  sentTransaction: {
    hash: string;
    status: string;
    ledger?: number;
    returnValueXdr?: string;
    envelopeXdr?: string;
  };
}

export interface FakeRpcOptions {
  /** Drop the sender's trustline entry to simulate an account without one. */
  withoutTrustline?: boolean;
  /** Status reported by getTransaction for the recorded hash. */
  txStatus?: "SUCCESS" | "NOT_FOUND" | "FAILED";
}

export class FakeStellarRpc implements StellarRpc {
  readonly calls: string[] = [];
  constructor(
    private readonly fixture: Fixture,
    private readonly options: FakeRpcOptions = {},
  ) {}

  simulateTransaction(tx: Transaction): Promise<Api.SimulateTransactionResponse> {
    const op = tx.operations[0];
    if (op?.type !== "invokeHostFunction" || op.func.type !== "hostFunctionTypeInvokeContract") {
      throw new Error("fake rpc: expected an invokeHostFunction operation");
    }
    const invoke = op.func.invokeContract;
    const fn = invoke.functionName.toString();
    const contractId = StellarAddress.fromScAddress(invoke.contractAddress).toString();
    const args = invoke.args.map((a) => a.toXDR("base64"));
    this.calls.push(`${fn}@${contractId.slice(0, 4)}`);
    const sendRecording =
      "retvalXdr" in this.fixture.sendSimulation ? [this.fixture.sendSimulation] : [];
    const candidates = [...this.fixture.simulations, ...sendRecording].filter(
      (s) => s.fn === fn && s.contractId === contractId,
    );
    const exact = candidates.find(
      (s) => s.args.length === args.length && s.args.every((a, i) => a === args[i]),
    );
    const recorded =
      exact ??
      (fn === "quote_oft" || fn === "quote_send" || fn === "send" || fn === "balance"
        ? candidates[0]
        : undefined);
    if (!recorded) {
      throw new Error(`fake rpc: no recording for ${fn} on ${contractId} with these args`);
    }
    const response: Api.SimulateTransactionSuccessResponse = {
      _parsed: true,
      id: "fake",
      latestLedger: recorded.latestLedger,
      events: [],
      minResourceFee: recorded.minResourceFee,
      transactionData: new SorobanDataBuilder(recorded.transactionDataXdr),
      result: {
        auth: recorded.authXdr.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64")),
        retval: xdr.ScVal.fromXDR(recorded.retvalXdr, "base64"),
      },
    };
    return Promise.resolve(response);
  }

  getTransaction(hash: string): Promise<Api.GetTransactionResponse> {
    this.calls.push(`getTransaction:${hash.slice(0, 8)}`);
    const status = this.options.txStatus ?? "SUCCESS";
    const sent = this.fixture.sentTransaction;
    if (hash !== sent.hash || status === "NOT_FOUND") {
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
      ledger: sent.ledger,
      returnValue: sent.returnValueXdr
        ? xdr.ScVal.fromXDR(sent.returnValueXdr, "base64")
        : undefined,
    } as unknown as Api.GetTransactionResponse);
  }

  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<Api.GetLedgerEntriesResponse> {
    const wanted = new Set(keys.map((k) => k.toXDR("base64")));
    const entries = this.fixture.ledgerEntries
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
    return Promise.resolve({ entries, latestLedger: this.fixture.latestLedger });
  }

  getLatestLedger(): Promise<Api.GetLatestLedgerResponse> {
    return Promise.resolve({
      id: "fake",
      sequence: this.fixture.latestLedger,
      protocolVersion: "25",
    } as unknown as Api.GetLatestLedgerResponse);
  }

  getAccount(address: string): Promise<Account> {
    return Promise.resolve(new Account(address, "100"));
  }
}

export class FakeScan implements ScanClient {
  private index = 0;
  constructor(private readonly responses: readonly (readonly ScanMessage[])[]) {}
  messagesByTx(): Promise<readonly ScanMessage[]> {
    const response = this.responses[Math.min(this.index, this.responses.length - 1)] ?? [];
    this.index += 1;
    return Promise.resolve(response);
  }
}

export function scanMessage(
  guid: string,
  statusName: string,
  destinationTxHash?: string,
): ScanMessage {
  return {
    guid,
    status: { name: statusName },
    pathway: { srcEid: 30600, dstEid: 30109 },
    ...(destinationTxHash === undefined
      ? {}
      : { destination: { status: "SUCCEEDED", tx: { txHash: destinationTxHash } } }),
  };
}

export interface FakeEvmOptions {
  nativeFee?: bigint;
  minAmountLD?: bigint;
  maxAmountLD?: bigint;
  amountReceivedLD?: (sent: bigint) => bigint;
  balance?: bigint;
  nativeBalance?: bigint;
}

export class FakeEvmReader implements EvmReader {
  readonly calls: string[] = [];
  constructor(private readonly options: FakeEvmOptions = {}) {}
  readContract(args: { functionName: string; args?: readonly unknown[] }): Promise<unknown> {
    this.calls.push(args.functionName);
    const sendParam = args.args?.[0] as { amountLD: bigint } | undefined;
    switch (args.functionName) {
      case "quoteSend":
        return Promise.resolve({
          nativeFee: this.options.nativeFee ?? 1_000_000_000_000_000n,
          lzTokenFee: 0n,
        });
      case "quoteOFT":
        return Promise.resolve([
          {
            minAmountLD: this.options.minAmountLD ?? 0n,
            maxAmountLD: this.options.maxAmountLD ?? 1n << 64n,
          },
          [],
          {
            amountSentLD: sendParam?.amountLD ?? 0n,
            amountReceivedLD: (this.options.amountReceivedLD ?? ((x) => x))(
              sendParam?.amountLD ?? 0n,
            ),
          },
        ]);
      case "balanceOf":
        return Promise.resolve(this.options.balance ?? 1_000_000_000n);
      default:
        throw new Error(`fake evm: ${args.functionName} not supported`);
    }
  }
  getBalance(): Promise<bigint> {
    return Promise.resolve(this.options.nativeBalance ?? 10n ** 18n);
  }
}

export type { TransferStage };
