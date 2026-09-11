/* CCTP test doubles over the shared fakes. Not shipped. */
import { xdr } from "@stellar/stellar-sdk";

import {
  FakeStellarRpc as SharedFakeStellarRpc,
  type RecordedSimulation,
} from "../../stellar/fake-rpc.test-support.js";
import type { IrisClient, IrisFeeRow, IrisMessage } from "./iris.js";

export interface CctpFixture {
  sender: string;
  latestLedger: number;
  simulations: RecordedSimulation[];
  burnTransaction: {
    hash: string;
    ledger: number;
    fn: string;
    contractId: string;
    args: string[];
    sorobanDataXdr: string;
    resourceFee: string;
    fee: string;
    authXdr: string[];
    memo: string;
  };
  ledgerEntries: { keyXdr: string; valXdr: string; lastModifiedLedgerSeq: number }[];
  iris: { messages: IrisMessage[]; sourceTxHash?: string };
}

export interface CctpFakeOptions {
  withoutTrustline?: boolean;
  txStatus?: "SUCCESS" | "NOT_FOUND" | "FAILED";
  /** Standing SAC allowance the sender has granted the TokenMessengerMinter. Recorded value is 0. */
  allowance?: bigint;
  /** Answer for MessageTransmitter.is_nonce_used; recorded answers are used when absent. */
  nonceUsed?: boolean;
}

/**
 * The real burn's footprint stands in for a deposit_for_burn simulation: the recorder could not
 * simulate one (no allowance existed), so the fake replays the resource data and auth entry of the
 * mainnet transaction that actually executed this exact call.
 */
function burnAsSimulation(fixture: CctpFixture): RecordedSimulation {
  return {
    fn: fixture.burnTransaction.fn,
    contractId: fixture.burnTransaction.contractId,
    args: fixture.burnTransaction.args,
    retvalXdr: xdr.ScVal.scvVoid().toXDR("base64"),
    transactionDataXdr: fixture.burnTransaction.sorobanDataXdr,
    minResourceFee: fixture.burnTransaction.resourceFee,
    authXdr: fixture.burnTransaction.authXdr,
    latestLedger: fixture.latestLedger,
  };
}

export class FakeCctpRpc extends SharedFakeStellarRpc {
  constructor(fixture: CctpFixture, options: CctpFakeOptions = {}) {
    const overrides: Record<string, (args: unknown[]) => xdr.ScVal> = {};
    if (options.allowance !== undefined) {
      const allowance = options.allowance;
      overrides["allowance"] = () => i128(allowance);
    }
    if (options.nonceUsed !== undefined) {
      const used = options.nonceUsed;
      overrides["is_nonce_used"] = () => xdr.ScVal.scvBool(used);
    }
    super(
      [...fixture.simulations, burnAsSimulation(fixture)],
      fixture.ledgerEntries,
      { [fixture.burnTransaction.hash]: { ledger: fixture.burnTransaction.ledger } },
      {
        ...(options.withoutTrustline ? { withoutTrustline: true } : {}),
        ...(options.txStatus ? { txStatus: options.txStatus } : {}),
        overrides,
        looseMatch: [
          "approve",
          "allowance",
          "balance",
          "deposit_for_burn",
          "get_min_fee_amount",
          "is_nonce_used",
        ],
      },
      fixture.latestLedger,
    );
  }

  /** Change the standing allowance mid-test (after "the approve confirmed"). */
  setAllowance(value: bigint): void {
    this.options.overrides!["allowance"] = () => i128(value);
  }
}

function i128(value: bigint): xdr.ScVal {
  const hi = value >> 64n;
  const lo = value & ((1n << 64n) - 1n);
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString(hi.toString()),
      lo: xdr.Uint64.fromString(lo.toString()),
    }),
  );
}

export class FakeIris implements IrisClient {
  readonly calls: string[] = [];
  private index = 0;
  constructor(
    private readonly feeRows: readonly IrisFeeRow[],
    private readonly messageSequence: readonly (readonly IrisMessage[])[] = [],
  ) {}

  private next(): readonly IrisMessage[] {
    const response =
      this.messageSequence[Math.min(this.index, this.messageSequence.length - 1)] ?? [];
    this.index += 1;
    return response;
  }

  messagesByTx(sourceDomain: number, txHash: string): Promise<readonly IrisMessage[]> {
    this.calls.push(`messagesByTx:${String(sourceDomain)}:${txHash.slice(0, 8)}`);
    return Promise.resolve(this.next());
  }

  messagesByNonce(sourceDomain: number, nonce: `0x${string}`): Promise<readonly IrisMessage[]> {
    this.calls.push(`messagesByNonce:${String(sourceDomain)}:${nonce.slice(0, 10)}`);
    return Promise.resolve(this.next());
  }

  fees(sourceDomain: number, destinationDomain: number): Promise<readonly IrisFeeRow[]> {
    this.calls.push(`fees:${String(sourceDomain)}->${String(destinationDomain)}`);
    return Promise.resolve(this.feeRows);
  }
}

export const FREE_FEES: readonly IrisFeeRow[] = [
  { finalityThreshold: 1000, minimumFee: 0 },
  { finalityThreshold: 2000, minimumFee: 0 },
];

/** Circle's production rows for EVM -> Stellar on 2026-09-11: fast costs 1.3 bps, standard is free. */
export const INBOUND_FEES: readonly IrisFeeRow[] = [
  { finalityThreshold: 1000, minimumFee: 1.3 },
  { finalityThreshold: 2000, minimumFee: 0 },
];
