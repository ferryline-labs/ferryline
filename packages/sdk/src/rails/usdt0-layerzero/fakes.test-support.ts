/* Test doubles that replay the recorded mainnet fixtures. Not shipped: excluded via tsup entry. */
import type { TransferStage } from "@ferryline/core";

import { HandlerEvmReader } from "../../evm/fake-reader.test-support.js";
import {
  FakeStellarRpc as SharedFakeStellarRpc,
  type RecordedSimulation,
} from "../../stellar/fake-rpc.test-support.js";
import type { ScanClient, ScanMessage } from "./scan.js";

export type { RecordedSimulation } from "../../stellar/fake-rpc.test-support.js";

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
  withoutTrustline?: boolean;
  txStatus?: "SUCCESS" | "NOT_FOUND" | "FAILED";
}

/** USDT0 preset over the shared replaying fake. */
export class FakeStellarRpc extends SharedFakeStellarRpc {
  constructor(fixture: Fixture, options: FakeRpcOptions = {}) {
    const sendRecording = "retvalXdr" in fixture.sendSimulation ? [fixture.sendSimulation] : [];
    super(
      [...fixture.simulations, ...sendRecording],
      fixture.ledgerEntries,
      {
        [fixture.sentTransaction.hash]: {
          ...(fixture.sentTransaction.ledger === undefined
            ? {}
            : { ledger: fixture.sentTransaction.ledger }),
          ...(fixture.sentTransaction.returnValueXdr === undefined
            ? {}
            : { returnValueXdr: fixture.sentTransaction.returnValueXdr }),
        },
      },
      { ...options, looseMatch: ["quote_oft", "quote_send", "send", "balance"] },
      fixture.latestLedger,
    );
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

/** USDT0 preset: answers the IOFT quote calls and the ERC-20 balance. */
export class FakeEvmReader extends HandlerEvmReader {
  constructor(options: FakeEvmOptions = {}) {
    super(
      {
        quoteSend: () => ({
          nativeFee: options.nativeFee ?? 1_000_000_000_000_000n,
          lzTokenFee: 0n,
        }),
        quoteOFT: (args) => {
          const sendParam = args[0] as { amountLD: bigint };
          return [
            {
              minAmountLD: options.minAmountLD ?? 0n,
              maxAmountLD: options.maxAmountLD ?? 1n << 64n,
            },
            [],
            {
              amountSentLD: sendParam.amountLD,
              amountReceivedLD: (options.amountReceivedLD ?? ((x) => x))(sendParam.amountLD),
            },
          ];
        },
        balanceOf: () => options.balance ?? 1_000_000_000n,
      },
      options.nativeBalance ?? 10n ** 18n,
    );
  }
}

export type { TransferStage };
