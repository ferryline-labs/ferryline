import { accountAddressToBytes32, contractAddressToBytes32 } from "@ferryline/core";
import { buildForwarderHookData } from "@ferryline/sdk";
import type { IrisClient, IrisMessage } from "@ferryline/sdk";
import { describe, expect, it } from "vitest";

import { InMemoryTransferRepository } from "../repo/in-memory-transfers.js";
import { attestOnce, attestUntilDone, type AttestOptions } from "./attest.js";
import { RelayerTerminalError } from "./errors.js";

const FORWARDER = "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T";
/** Real mainnet forwardRecipient/amount observed in a real inbound message, phase 2
 *  (packages/core/verified/experiments/evidence/iris.mainnet.inbound-to-stellar.observed.json,
 *  tx c52f172dec8234d…). The surrounding message bytes here are synthetic — assembled at this
 *  file's own layout offsets, which mirror @ferryline/sdk's message.ts docstring (itself checked
 *  against that same real message) — because no full raw message hex was recorded in phase 2, only
 *  its already-parsed fields. This is not a new claim about the wire format; it exercises attest.ts
 *  wiring the SDK's independently-tested parseCctpMessage/parseForwarderHookData together correctly.
 */
const REAL_FORWARD_RECIPIENT = "GBZOXV2V4U4QOAE34EUM7CAQLHME434UFAVAPCSKGVBDDZPGD3Z3ADZJ";
const REAL_AMOUNT = 580_673_900n;

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

/** Builds a message at the layout in @ferryline/sdk's usdc-cctp/message.ts, for this file's tests only. */
function buildMessage(opts: {
  mintRecipient?: Uint8Array;
  destinationCaller?: Uint8Array;
  amount?: bigint;
  forwardRecipient?: string;
}): string {
  const forwarderBytes = contractAddressToBytes32(FORWARDER);
  const header = concat(
    u32be(1), // version
    u32be(0), // sourceDomain (Ethereum)
    u32be(27), // destinationDomain (Stellar)
    new Uint8Array(32), // nonce (unused by attestOnce; Iris supplies the real nonce out of band)
    new Uint8Array(32), // sender
    new Uint8Array(32), // recipient
    opts.destinationCaller ?? forwarderBytes, // destinationCaller
    u32be(2000), // minFinalityThreshold
    u32be(2000), // finalityThresholdExecuted
  );
  const hookData = buildForwarderHookData(opts.forwardRecipient ?? REAL_FORWARD_RECIPIENT);
  const body = concat(
    u32be(1), // version
    new Uint8Array(32), // burnToken
    opts.mintRecipient ?? forwarderBytes, // mintRecipient
    u256be(opts.amount ?? REAL_AMOUNT), // amount
    new Uint8Array(32), // messageSender
    u256be(0n), // maxFee
    u256be(0n), // feeExecuted
    u256be(0n), // expirationBlock
    hookData,
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
    throw new Error("not used by attest.ts");
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
  repo: InMemoryTransferRepository,
  overrides: Partial<Parameters<InMemoryTransferRepository["register"]>[0]> = {},
) {
  return repo.register({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    rail: "usdc-cctp",
    sourceChain: "ethereum",
    sourceTxHash: "0xabc",
    sourceDomain: 0,
    ...overrides,
  });
}

/**
 * Shared AttestOptions builder — every test that isn't specifically about the per-recipient rate
 * limit uses generous rate-limit defaults here so it can't accidentally trip that check as a side
 * effect of unrelated assertions.
 */
function baseOptions(
  repo: InMemoryTransferRepository,
  iris: IrisClient,
  overrides: Partial<AttestOptions> = {},
): AttestOptions {
  return {
    iris,
    repo,
    forwarderContractId: FORWARDER,
    pollIntervalMs: 0,
    pollMaxIntervalMs: 0,
    maxTransfersPerRecipient: 1000,
    recipientRateLimitWindowMs: 60_000,
    ...overrides,
  };
}

describe("attestOnce", () => {
  it("extracts amount and recipient from the REAL parsed message/hook data, not from the registered row", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerPending(repo);
    expect(transfer.amount).toBeNull();
    expect(transfer.recipient).toBeNull();

    const iris = new FakeIris([[completeMessage(buildMessage({}))]]);
    const attested = await attestOnce(transfer, baseOptions(repo, iris));

    expect(attested.status).toBe("attested");
    expect(attested.amount).toBe(REAL_AMOUNT.toString());
    expect(attested.recipient).toBe(REAL_FORWARD_RECIPIENT);
    expect(attested.mintRecipient).toBe(FORWARDER);
    expect(attested.destinationCaller).toBe(FORWARDER);
  });

  it("extracts a different real recipient/amount correctly (not a hardcoded echo)", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerPending(repo);
    const otherRecipient = "GB44W23OXZC2EQBM4E3XM7DLFYM6AV66CUOA2FXDBNZ6IZ2T4EZERZIH"; // also real, phase-2 evidence
    const otherAmount = 100_000_000n;

    const iris = new FakeIris([
      [completeMessage(buildMessage({ forwardRecipient: otherRecipient, amount: otherAmount }))],
    ]);
    const attested = await attestOnce(transfer, baseOptions(repo, iris));

    expect(attested.recipient).toBe(otherRecipient);
    expect(attested.amount).toBe(otherAmount.toString());
  });

  it("throws FORWARDER_FIELDS_INVALID (never silently accepts) when mintRecipient is not the forwarder", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerPending(repo);
    const notTheForwarder = accountAddressToBytes32(REAL_FORWARD_RECIPIENT);
    const iris = new FakeIris([
      [completeMessage(buildMessage({ mintRecipient: notTheForwarder }))],
    ]);

    let caught: unknown;
    try {
      await attestOnce(transfer, baseOptions(repo, iris));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RelayerTerminalError);
    expect((caught as RelayerTerminalError).code).toBe("FORWARDER_FIELDS_INVALID");

    // And the row must NOT have been silently attested with a wrong/missing recipient.
    const reread = await repo.get(transfer.id);
    expect(reread?.status).toBe("pending");
  });

  it("throws FORWARDER_FIELDS_INVALID when destinationCaller is not the forwarder", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerPending(repo);
    const iris = new FakeIris([
      [completeMessage(buildMessage({ destinationCaller: new Uint8Array(32) }))],
    ]);

    await expect(attestOnce(transfer, baseOptions(repo, iris))).rejects.toMatchObject({
      code: "FORWARDER_FIELDS_INVALID",
    });
  });

  it("throws RelayerRetryableError (does not touch the row) while Iris has not indexed the tx yet", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerPending(repo);
    const iris = new FakeIris([[]]);

    await expect(attestOnce(transfer, baseOptions(repo, iris))).rejects.toThrow(/not indexed/);
    expect((await repo.get(transfer.id))?.status).toBe("pending");
  });
});

describe("attestOnce: STEP 4 per-recipient rate limit", () => {
  it("goes straight to failed with RECIPIENT_RATE_LIMITED, carrying the real amount/recipient, when the recipient is over its window", async () => {
    const repo = new InMemoryTransferRepository();
    // Three PRIOR transfers already registered to the same recipient, all within the window —
    // simulates countByRecipientSince already finding them, without needing them to go through a
    // full attest pass themselves (this test is about the CHECK, not about building up history).
    for (const suffix of ["1", "2", "3"]) {
      const prior = await registerPending(repo, {
        id: `01ARZ3NDEKTSV4RRFFQ69G5FA${suffix}`,
        sourceTxHash: `0xprior${suffix}`,
      });
      await repo.transition(prior.id, prior.version, "attested", {
        amount: "1",
        recipient: REAL_FORWARD_RECIPIENT,
        irisNonce: "0xn",
        irisMessage: "0xm",
        irisAttestation: "0xa",
        mintRecipient: FORWARDER,
        destinationCaller: FORWARDER,
      });
    }

    const transfer = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA9",
      sourceTxHash: "0xnew",
    });
    const iris = new FakeIris([[completeMessage(buildMessage({}))]]); // recipient = REAL_FORWARD_RECIPIENT

    const result = await attestOnce(
      transfer,
      baseOptions(repo, iris, { maxTransfersPerRecipient: 3 }),
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("RECIPIENT_RATE_LIMITED");
    // The real extracted amount/recipient must still be on the row — an operator investigating a
    // rate-limited recipient needs to see what actually triggered it, per the STEP 4 sign-off.
    expect(result.amount).toBe(REAL_AMOUNT.toString());
    expect(result.recipient).toBe(REAL_FORWARD_RECIPIENT);
  });

  it("proceeds to attested normally when the recipient is under its window", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerPending(repo);
    const iris = new FakeIris([[completeMessage(buildMessage({}))]]);

    const result = await attestOnce(
      transfer,
      baseOptions(repo, iris, { maxTransfersPerRecipient: 3 }),
    );

    expect(result.status).toBe("attested");
    expect(result.errorCode).toBeNull();
  });

  it("only counts transfers within the configured window, not ones outside it", async () => {
    const repo = new InMemoryTransferRepository();
    const old = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA8",
      sourceTxHash: "0xold",
    });
    await repo.transition(old.id, old.version, "attested", {
      amount: "1",
      recipient: REAL_FORWARD_RECIPIENT,
      irisNonce: "0xn",
      irisMessage: "0xm",
      irisAttestation: "0xa",
      mintRecipient: FORWARDER,
      destinationCaller: FORWARDER,
    });

    const transfer = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA9",
      sourceTxHash: "0xnew",
    });
    const iris = new FakeIris([[completeMessage(buildMessage({}))]]);

    // A "now" far enough in the future that the prior transfer's createdAt falls outside a
    // 1-hour window — proves the window is actually applied, not just an unbounded total count.
    const farFuture = () => new Date(Date.now() + 2 * 60 * 60 * 1000);
    const result = await attestOnce(
      transfer,
      baseOptions(repo, iris, {
        maxTransfersPerRecipient: 1,
        recipientRateLimitWindowMs: 60 * 60 * 1000,
        now: farFuture,
      }),
    );

    expect(result.status).toBe("attested"); // the old transfer no longer counts within the window
  });
});

describe("attestUntilDone", () => {
  it("retries through not-yet-complete Iris responses, then succeeds and extracts the real fields", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerPending(repo);
    const iris = new FakeIris([
      [], // not indexed yet
      [completeMessage(buildMessage({}), { status: "pending_confirmations" })],
      [completeMessage(buildMessage({}))],
    ]);

    const result = await attestUntilDone(transfer, baseOptions(repo, iris));

    expect(result.status).toBe("attested");
    expect(result.amount).toBe(REAL_AMOUNT.toString());
    expect(result.recipient).toBe(REAL_FORWARD_RECIPIENT);
  });

  it("moves the transfer to failed on a terminal error instead of retrying forever", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerPending(repo);
    const iris = new FakeIris([[completeMessage("0xdead")]]); // too short to parse

    const result = await attestUntilDone(transfer, baseOptions(repo, iris));

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("MALFORMED_MESSAGE");
  });
});
