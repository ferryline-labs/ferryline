/* Test double for RelayerStellarRpc. Not shipped: not reachable from src/index.ts. */
import {
  Account,
  scValToNative,
  SorobanDataBuilder,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Api } from "@stellar/stellar-sdk/rpc";

import type { RelayerStellarRpc } from "./stellar-rpc.js";

export interface RecordedNonceCheck {
  readonly nonceHex: string;
  readonly expected: boolean;
  readonly retvalXdr: string;
  readonly transactionDataXdr: string;
  readonly minResourceFee: string;
  readonly authXdr: string[];
  readonly latestLedger: number;
}

/**
 * Replays real mainnet `is_nonce_used` simulations recorded by
 * packages/relayer/scripts/record-nonce-check-fixtures.ts (see
 * src/chain/__fixtures__/is-nonce-used-mainnet-2026-09-11.json): one nonce a real inbound CCTP
 * message actually delivered (answers true), one no real message has used (answers false).
 *
 * `sendTransaction` is NOT backed by any recorded broadcast — this repo has not submitted a real
 * `mint_and_forward` from this relayer to any network (see the phase-3 report). It returns a
 * caller-controlled synthetic verdict so tests can exercise the state machine's handling of
 * PENDING/DUPLICATE/TRY_AGAIN_LATER/ERROR without asserting anything about real broadcast behavior.
 */
export class FakeRelayerStellarRpc implements RelayerStellarRpc {
  readonly sentEnvelopes: string[] = [];
  nextSendResult: { hash: string; status: Api.SendTransactionStatus; errorResult?: unknown } = {
    hash: "0000000000000000000000000000000000000000000000000000000000000000",
    status: "PENDING",
  };

  constructor(private readonly nonceFixtures: readonly RecordedNonceCheck[]) {}

  getAccount(address: string): Promise<Account> {
    return Promise.resolve(new Account(address, "0"));
  }

  simulateTransaction(tx: Transaction): Promise<Api.SimulateTransactionResponse> {
    const op = tx.operations[0];
    if (op?.type !== "invokeHostFunction" || op.func.type !== "hostFunctionTypeInvokeContract") {
      throw new Error(
        "FakeRelayerStellarRpc.simulateTransaction only replays invokeContract calls",
      );
    }
    const invoke = op.func.invokeContract;
    if (invoke.functionName.toString() !== "is_nonce_used") {
      throw new Error("FakeRelayerStellarRpc.simulateTransaction only replays is_nonce_used calls");
    }
    const nonceArg = invoke.args[0];
    const nonceHex = nonceArg
      ? Buffer.from(scValToNative(nonceArg) as Uint8Array).toString("hex")
      : "";
    const recorded = this.nonceFixtures.find((f) => f.nonceHex === nonceHex);
    if (!recorded) {
      throw new Error(
        `FakeRelayerStellarRpc: no recorded is_nonce_used fixture for nonce ${nonceHex}. ` +
          `Recorded nonces: ${this.nonceFixtures.map((f) => f.nonceHex).join(", ")}`,
      );
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

  getTransaction(): Promise<Api.GetTransactionResponse> {
    throw new Error(
      "FakeRelayerStellarRpc.getTransaction is not implemented (not needed by the tests using it)",
    );
  }

  getLedgerEntries(): Promise<Api.GetLedgerEntriesResponse> {
    return Promise.resolve({ entries: [], latestLedger: 1 });
  }

  getLatestLedger(): Promise<Api.GetLatestLedgerResponse> {
    return Promise.resolve({
      id: "fake",
      sequence: 1,
      protocolVersion: "25",
    } as unknown as Api.GetLatestLedgerResponse);
  }

  sendTransaction(): Promise<Api.SendTransactionResponse> {
    this.sentEnvelopes.push("sent");
    return Promise.resolve(this.nextSendResult as unknown as Api.SendTransactionResponse);
  }
}
