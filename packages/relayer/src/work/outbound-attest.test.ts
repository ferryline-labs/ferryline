import { evmAddressToBytes32 } from "@ferryline/core";
import type { IrisClient, IrisMessage } from "@ferryline/sdk";
import { describe, expect, it } from "vitest";

import { InMemoryOutboundTransferRepository } from "../repo/in-memory-outbound-transfers.js";
import {
  attestOutboundOnce,
  attestOutboundUntilDone,
  type OutboundAttestOptions,
} from "./outbound-attest.js";
import { OutboundRelayerTerminalError } from "./outbound-errors.js";

/**
 * Mirrors attest.test.ts's own structure exactly, adapted for outbound's simpler shape: no
 * forwarder/hook-data indirection, mintRecipient decodes straight to the real destination EVM
 * address (see outbound-attest.ts's own doc comment for the full reasoning).
 */
const RECIPIENT: `0x${string}` = `0x${"a".repeat(40)}`;
const REAL_AMOUNT = 580_673_900n;
const SEPOLIA = "ethereum-sepolia";

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function u256be(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let remaining = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

/** Builds a message at the same layout attest.test.ts's own buildMessage uses (per
 *  @ferryline/sdk's usdc-cctp/message.ts), with a Stellar source domain / EVM destination domain,
 *  and NO hook data — a real Stellar-source burn body has none of inbound's forwarder indirection. */
function buildMessage(opts: { mintRecipient?: Uint8Array; amount?: bigint }): string {
  const header = concat(
    u32be(1), // version
    u32be(27), // sourceDomain (Stellar)
    u32be(0), // destinationDomain (Ethereum)
    new Uint8Array(32), // nonce (unused by attestOutboundOnce; Iris supplies the real nonce out of band)
    new Uint8Array(32), // sender
    new Uint8Array(32), // recipient
    new Uint8Array(32), // destinationCaller (irrelevant to outbound: not validated the way inbound does)
    u32be(2000), // minFinalityThreshold
    u32be(2000), // finalityThresholdExecuted
  );
  const body = concat(
    u32be(1), // version
    new Uint8Array(32), // burnToken
    opts.mintRecipient ?? evmAddressToBytes32(RECIPIENT), // mintRecipient: the real EVM destination
    u256be(opts.amount ?? REAL_AMOUNT), // amount
    new Uint8Array(32), // messageSender
    u256be(0n), // maxFee
    u256be(0n), // feeExecuted
    u256be(0n), // expirationBlock
    // no hookData: outbound messages carry none.
  );
  return toHex(concat(header, body));
}

class FakeIris implements IrisClient {
  constructor(private readonly responses: readonly (readonly IrisMessage[])[]) {}
  private index = 0;
  messagesByTx(): Promise<readonly IrisMessage[]> {
    const response = this.responses[Math.min(this.index, this.responses.length - 1)] ?? [];
    this.index += 1;
    return Promise.resolve(response);
  }
  messagesByNonce(): Promise<readonly IrisMessage[]> {
    throw new Error("not used by outbound-attest.ts");
  }
  fees(): Promise<readonly []> {
    return Promise.resolve([]);
  }
}

function completeMessage(message: string, overrides: Partial<IrisMessage> = {}): IrisMessage {
  return {
    message,
    eventNonce: "0xnonce",
    attestation: "0xattestation",
    cctpVersion: 2,
    status: "complete",
    delayReason: null,
    decodedMessage: null,
    ...overrides,
  };
}

async function registerPending(
  repo: InMemoryOutboundTransferRepository,
  overrides: Partial<Parameters<InMemoryOutboundTransferRepository["register"]>[0]> = {},
) {
  return repo.register({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    rail: "usdc-cctp",
    sourceTxHash: "a".repeat(64),
    sourceDomain: 27,
    destinationChain: SEPOLIA,
    ...overrides,
  });
}

function baseOptions(
  repo: InMemoryOutboundTransferRepository,
  iris: IrisClient,
  overrides: Partial<OutboundAttestOptions> = {},
): OutboundAttestOptions {
  return {
    iris,
    repo,
    pollIntervalMs: 0,
    pollMaxIntervalMs: 0,
    maxTransfersPerRecipient: 1000,
    recipientRateLimitWindowMs: 60_000,
    ...overrides,
  };
}

describe("attestOutboundOnce", () => {
  it("extracts amount and recipient from the REAL parsed message (mintRecipient directly, no hook data)", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerPending(repo);
    expect(transfer.amount).toBeNull();
    expect(transfer.recipient).toBeNull();

    const iris = new FakeIris([[completeMessage(buildMessage({}))]]);
    const attested = await attestOutboundOnce(transfer, baseOptions(repo, iris));

    expect(attested.status).toBe("attested");
    expect(attested.amount).toBe(REAL_AMOUNT.toString());
    expect(attested.recipient).toBe(RECIPIENT);
  });

  it("extracts a different real recipient/amount correctly (not a hardcoded echo)", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerPending(repo);
    const otherRecipient: `0x${string}` = `0x${"c".repeat(40)}`;
    const otherAmount = 100_000_000n;

    const iris = new FakeIris([
      [
        completeMessage(
          buildMessage({ mintRecipient: evmAddressToBytes32(otherRecipient), amount: otherAmount }),
        ),
      ],
    ]);
    const attested = await attestOutboundOnce(transfer, baseOptions(repo, iris));

    expect(attested.recipient).toBe(otherRecipient);
    expect(attested.amount).toBe(otherAmount.toString());
  });

  it("throws MALFORMED_MESSAGE (never silently accepts) when mintRecipient does not decode to a well-formed EVM address", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerPending(repo);
    // Non-zero padding bytes: not a left-padded EVM address — bytes32ToEvmAddress must reject this.
    const malformed = new Uint8Array(32);
    malformed[0] = 1;
    const iris = new FakeIris([[completeMessage(buildMessage({ mintRecipient: malformed }))]]);

    let caught: unknown;
    try {
      await attestOutboundOnce(transfer, baseOptions(repo, iris));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OutboundRelayerTerminalError);
    expect((caught as OutboundRelayerTerminalError).code).toBe("MALFORMED_MESSAGE");

    // And the row must NOT have been silently attested with a wrong/missing recipient.
    const reread = await repo.get(transfer.id);
    expect(reread?.status).toBe("pending");
  });

  it("throws OutboundRelayerRetryableError (does not touch the row) while Iris has not indexed the tx yet", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerPending(repo);
    const iris = new FakeIris([[]]);

    await expect(attestOutboundOnce(transfer, baseOptions(repo, iris))).rejects.toThrow(
      /not indexed/,
    );
    expect((await repo.get(transfer.id))?.status).toBe("pending");
  });
});

describe("attestOutboundOnce: STEP 4 per-recipient rate limit", () => {
  it("goes straight to failed with RECIPIENT_RATE_LIMITED, carrying the real amount/recipient, when the recipient is over its window", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    for (const suffix of ["1", "2", "3"]) {
      const prior = await registerPending(repo, {
        id: `01ARZ3NDEKTSV4RRFFQ69G5FA${suffix}`,
        sourceTxHash: `${suffix.repeat(64)}`.slice(0, 64),
      });
      await repo.transition(prior.id, prior.version, "attested", {
        amount: "1",
        recipient: RECIPIENT,
        irisNonce: "0xn",
        irisMessage: "0xm",
        irisAttestation: "0xa",
      });
    }

    const transfer = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA9",
      sourceTxHash: "9".repeat(64),
    });
    const iris = new FakeIris([[completeMessage(buildMessage({}))]]); // recipient = RECIPIENT

    const result = await attestOutboundOnce(
      transfer,
      baseOptions(repo, iris, { maxTransfersPerRecipient: 3 }),
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("RECIPIENT_RATE_LIMITED");
    expect(result.amount).toBe(REAL_AMOUNT.toString());
    expect(result.recipient).toBe(RECIPIENT);
  });

  it("proceeds to attested normally when the recipient is under its window", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerPending(repo);
    const iris = new FakeIris([[completeMessage(buildMessage({}))]]);

    const result = await attestOutboundOnce(
      transfer,
      baseOptions(repo, iris, { maxTransfersPerRecipient: 3 }),
    );

    expect(result.status).toBe("attested");
    expect(result.errorCode).toBeNull();
  });

  it("only counts transfers within the configured window, not ones outside it", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const old = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA8",
      sourceTxHash: "8".repeat(64),
    });
    await repo.transition(old.id, old.version, "attested", {
      amount: "1",
      recipient: RECIPIENT,
      irisNonce: "0xn",
      irisMessage: "0xm",
      irisAttestation: "0xa",
    });

    const transfer = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA9",
      sourceTxHash: "9".repeat(64),
    });
    const iris = new FakeIris([[completeMessage(buildMessage({}))]]);

    const farFuture = () => new Date(Date.now() + 2 * 60 * 60 * 1000);
    const result = await attestOutboundOnce(
      transfer,
      baseOptions(repo, iris, {
        maxTransfersPerRecipient: 1,
        recipientRateLimitWindowMs: 60 * 60 * 1000,
        now: farFuture,
      }),
    );

    expect(result.status).toBe("attested");
  });
});

describe("attestOutboundUntilDone", () => {
  it("retries through not-yet-complete Iris responses, then succeeds and extracts the real fields", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerPending(repo);
    const iris = new FakeIris([
      [],
      [completeMessage(buildMessage({}), { status: "pending_confirmations" })],
      [completeMessage(buildMessage({}))],
    ]);

    const result = await attestOutboundUntilDone(transfer, baseOptions(repo, iris));

    expect(result.status).toBe("attested");
    expect(result.amount).toBe(REAL_AMOUNT.toString());
    expect(result.recipient).toBe(RECIPIENT);
  });

  it("moves the transfer to failed on a terminal error instead of retrying forever", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerPending(repo);
    const iris = new FakeIris([[completeMessage("0xdead")]]); // too short to parse

    const result = await attestOutboundUntilDone(transfer, baseOptions(repo, iris));

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("MALFORMED_MESSAGE");
  });
});
