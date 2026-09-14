import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { FakeRelayerEvmRpc } from "../chain/fake-evm-rpc.test-support.js";
import { InMemoryOutboundTransferRepository } from "../repo/in-memory-outbound-transfers.js";
import type { OutboundTransferRow } from "../repo/outbound-types.js";
import type { EvmSigner } from "../signer/evm-types.js";
import { InMemoryOutboundSpendCeiling } from "../spend/outbound-ceiling.js";
import {
  InMemoryOutboundSpendLog,
  type OutboundSpendLedgerEvent,
} from "../spend/outbound-spend-log.js";
import { OutboundRelayerRetryableError } from "./outbound-errors.js";
import { submitOutboundUntilDelivered, type OutboundSubmitOptions } from "./outbound-submit.js";

/**
 * These tests exercise outbound-submit.ts's own responsibility — the spend-cap sequence (including
 * the REQUIRED retry-cap test below), the crash-safe `submitting` write ordering, and the
 * spend-log/spend-ledger-events write ordering — NOT a real EVM simulation of `receiveMessage`.
 * FakeRelayerEvmRpc replaces the real viem-backed RelayerEvmRpc, the same "exercise this file's own
 * sequencing, not the chain client" reasoning as submit.test.ts's own doc comment. Mirrors that
 * file's structure/coverage exactly, adapted for the outbound direction's shape.
 */

const MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const; // real, verified Sepolia address
const SEPOLIA = "ethereum-sepolia";
const RECIPIENT: `0x${string}` = `0x${"b".repeat(40)}`;

function fakeSigner(): EvmSigner {
  const account = privateKeyToAccount(generatePrivateKey());
  return { account, address: () => Promise.resolve(account.address) };
}

async function registerAttested(
  repo: InMemoryOutboundTransferRepository,
  id: string,
): Promise<OutboundTransferRow> {
  const pending = await repo.register({
    id,
    rail: "usdc-cctp",
    sourceTxHash: id.toLowerCase().padEnd(64, "0"),
    sourceDomain: 27,
    destinationChain: SEPOLIA,
  });
  return repo.transition(pending.id, pending.version, "attested", {
    amount: "1000000",
    recipient: RECIPIENT,
    irisNonce: "0xnonce",
    irisMessage: "0xmessage",
    irisAttestation: "0xattestation",
  });
}

function baseOptions(
  repo: InMemoryOutboundTransferRepository,
  spendLog: InMemoryOutboundSpendLog,
  rpc: FakeRelayerEvmRpc,
  overrides: {
    maxGasCostWei?: bigint;
    spendCeiling?: InMemoryOutboundSpendCeiling;
    signer?: EvmSigner;
  } = {},
): OutboundSubmitOptions {
  return {
    rpc,
    repo,
    signer: overrides.signer ?? fakeSigner(),
    messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
    destinationChain: SEPOLIA,
    maxGasCostWei: overrides.maxGasCostWei ?? 10_000_000_000_000_000n, // 0.01 ETH-equivalent
    spendCeiling:
      overrides.spendCeiling ?? new InMemoryOutboundSpendCeiling(1_000_000_000_000_000_000n),
    spendLog,
    pollIntervalMs: 0,
    pollMaxIntervalMs: 0,
  };
}

function eventTypes(spendLog: InMemoryOutboundSpendLog): OutboundSpendLedgerEvent["type"][] {
  return spendLog.events.map((e) => e.type);
}

describe("submitOutboundUntilDelivered: spend-log write ordering", () => {
  it("on the happy path: logs the attempt, then 'reserved', then reserves, then 'submitting', then 'broadcast' — each before its action", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerAttested(repo, "01arz3ndektsv4rrffq69g5fa1");
    const spendLog = new InMemoryOutboundSpendLog();
    const spendCeiling = new InMemoryOutboundSpendCeiling(1_000_000_000_000_000_000n);
    const rpc = new FakeRelayerEvmRpc(new Map());
    rpc.nextGasCostWei = 500_000_000_000_000n; // 0.0005 ETH-equivalent

    // waitForOutboundDelivery would poll forever with the fake rpc's default (no configured
    // usedNonces verdict); abort immediately so submitOutboundUntilDelivered itself resolves the
    // part this test cares about, then waitForOutboundDelivery's first usedNonces call throws
    // (no verdict configured for "0xnonce"), which this test catches — the assertions below all
    // concern the write ordering BEFORE that point.
    const controller = new AbortController();
    controller.abort();

    await expect(
      submitOutboundUntilDelivered(
        transfer,
        baseOptions(repo, spendLog, rpc, { spendCeiling }),
        controller.signal,
      ),
    ).rejects.toBeDefined();

    expect(spendLog.entries).toHaveLength(1);
    expect(spendLog.entries[0]).toMatchObject({
      transferId: transfer.id,
      amountWei: 500_000_000_000_000n,
    });
    expect(eventTypes(spendLog)).toEqual(["reserved", "broadcast"]);

    const reservedEvent = spendLog.events[0];
    expect(reservedEvent).toMatchObject({
      type: "reserved",
      transferId: transfer.id,
      amountWei: 500_000_000_000_000n,
    });
    // The reservation must be REAL by the time 'reserved' is logged: spentToday() already reflects it.
    expect(await spendCeiling.spentToday(SEPOLIA)).toBe(500_000_000_000_000n);

    const reread = await repo.get(transfer.id);
    expect(reread?.status).toBe("submitting"); // the crash-safe write happened
    expect(reread?.destinationTxHash).toBeTruthy();
    expect(rpc.broadcastCalls).toHaveLength(1);
  });

  it(
    "REQUIRED test: a retry at a higher gas price than the original cap allows is rejected, not " +
      "silently permitted because 'it's a retry' — every attempt re-quotes and re-checks against " +
      "the SAME per-transfer cap, with no escalating allowance",
    async () => {
      const repo = new InMemoryOutboundTransferRepository();
      const transfer = await registerAttested(repo, "01arz3ndektsv4rrffq69g5fa2");
      const cap = 1_000_000_000_000_000n; // 0.001 ETH-equivalent cap

      // First attempt: gas price is within the cap, but the broadcast is rejected before reaching
      // the network (simulating e.g. a transient RPC failure) — the transfer stays `attested` for a
      // retry, and its reservation is released so the cap is not permanently consumed by a failed
      // attempt.
      const spendLogFirst = new InMemoryOutboundSpendLog();
      const rpcFirst = new FakeRelayerEvmRpc(new Map());
      rpcFirst.nextGasCostWei = cap; // exactly at the cap: allowed
      const brokenWrite = () => Promise.reject(new Error("simulated broadcast failure"));
      rpcFirst.writeReceiveMessage = brokenWrite;

      await expect(
        submitOutboundUntilDelivered(
          transfer,
          baseOptions(repo, spendLogFirst, rpcFirst, { maxGasCostWei: cap }),
        ),
      ).rejects.toThrow(OutboundRelayerRetryableError);

      const afterFirstAttempt = await repo.get(transfer.id);
      expect(afterFirstAttempt?.status).toBe("attested"); // unchanged: safe to retry

      // Second attempt (the "retry"): gas price has since risen ABOVE the same configured cap. This
      // must be rejected exactly as a first attempt at that price would be — no special allowance
      // for "this is already a retry". The cap passed to baseOptions here is unchanged from the
      // first attempt: nothing in this test raises it between attempts.
      const spendLogSecond = new InMemoryOutboundSpendLog();
      const rpcSecond = new FakeRelayerEvmRpc(new Map());
      rpcSecond.nextGasCostWei = cap + 1n; // one wei over the SAME cap as the first attempt

      const retryResult = await submitOutboundUntilDelivered(
        afterFirstAttempt!,
        baseOptions(repo, spendLogSecond, rpcSecond, { maxGasCostWei: cap }),
      );

      expect(retryResult.status).toBe("failed");
      expect(retryResult.errorCode).toBe("TRANSFER_EXCEEDS_SPEND_CAP");
      // The retry's rejection happened before ever reaching the spend log or the ceiling: nothing
      // was reserved or logged for the over-cap retry attempt.
      expect(spendLogSecond.entries).toHaveLength(0);
      expect(eventTypes(spendLogSecond)).toEqual([]);
      // And the broadcast itself was never even attempted for the over-cap retry.
      expect(rpcSecond.broadcastCalls).toHaveLength(0);
    },
  );

  it("logs a 'released' event with reason broadcast_rejected, BEFORE the actual release, when simulation reverts for a reason other than an already-used nonce", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerAttested(repo, "01arz3ndektsv4rrffq69g5fa3");
    const spendLog = new InMemoryOutboundSpendLog();
    const spendCeiling = new InMemoryOutboundSpendCeiling(1_000_000_000_000_000_000n);
    // usedNonces verdict for "0xnonce" says unused (0n) — so a simulation revert here is NOT the
    // already-used-nonce case, and must be treated as retryable.
    const rpc = new FakeRelayerEvmRpc(new Map([["0xnonce", 0n]]));
    rpc.nextSimulateShouldRevert = true;

    await expect(
      submitOutboundUntilDelivered(transfer, baseOptions(repo, spendLog, rpc, { spendCeiling })),
    ).rejects.toThrow(OutboundRelayerRetryableError);

    expect(eventTypes(spendLog)).toEqual(["reserved", "released"]);
    expect(spendLog.events[1]).toMatchObject({
      type: "released",
      transferId: transfer.id,
      reason: "broadcast_rejected",
    });
    expect(await spendCeiling.spentToday(SEPOLIA)).toBe(0n);
    const reread = await repo.get(transfer.id);
    expect(reread?.status).toBe("attested"); // unchanged: safe to retry
  });

  it("transitions straight to failed with NONCE_ALREADY_USED when simulation reverts AND usedNonces confirms the nonce is already consumed", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerAttested(repo, "01arz3ndektsv4rrffq69g5fa4");
    const spendLog = new InMemoryOutboundSpendLog();
    const spendCeiling = new InMemoryOutboundSpendCeiling(1_000_000_000_000_000_000n);
    const rpc = new FakeRelayerEvmRpc(new Map([["0xnonce", 1n]])); // already used
    rpc.nextSimulateShouldRevert = true;

    const result = await submitOutboundUntilDelivered(
      transfer,
      baseOptions(repo, spendLog, rpc, { spendCeiling }),
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("NONCE_ALREADY_USED");
    expect(eventTypes(spendLog)).toEqual(["reserved", "released"]);
    expect(await spendCeiling.spentToday(SEPOLIA)).toBe(0n);
  });

  it("writes NO spend_ledger_events row when the daily ceiling has no room: the reservation never actually happened", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerAttested(repo, "01arz3ndektsv4rrffq69g5fa5");
    const spendLog = new InMemoryOutboundSpendLog();
    const spendCeiling = new InMemoryOutboundSpendCeiling(50n); // room for less than the quote
    const rpc = new FakeRelayerEvmRpc(new Map());
    rpc.nextGasCostWei = 100n;

    await expect(
      submitOutboundUntilDelivered(transfer, baseOptions(repo, spendLog, rpc, { spendCeiling })),
    ).rejects.toThrow(OutboundRelayerRetryableError);

    expect(spendLog.entries).toHaveLength(1); // the attempt is still logged, unconditionally
    expect(eventTypes(spendLog)).toEqual([]);
    const reread = await repo.get(transfer.id);
    expect(reread?.status).toBe("attested");
  });

  it("writes NO spend_ledger_events row when the per-transfer gas cap is exceeded: no reservation was ever attempted", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerAttested(repo, "01arz3ndektsv4rrffq69g5fa6");
    const spendLog = new InMemoryOutboundSpendLog();
    const rpc = new FakeRelayerEvmRpc(new Map());
    rpc.nextGasCostWei = 999_999_999_999_999_999n; // far over the default cap

    const result = await submitOutboundUntilDelivered(
      transfer,
      baseOptions(repo, spendLog, rpc, { maxGasCostWei: 10_000_000_000_000_000n }),
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("TRANSFER_EXCEEDS_SPEND_CAP");
    expect(spendLog.entries).toHaveLength(0);
    expect(eventTypes(spendLog)).toEqual([]);
  });

  it("logs a 'released' event when a concurrent worker wins the race to `submitting`, without releasing the broadcast that already happened", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const transfer = await registerAttested(repo, "01arz3ndektsv4rrffq69g5fa7");
    const spendLog = new InMemoryOutboundSpendLog();
    const spendCeiling = new InMemoryOutboundSpendCeiling(1_000_000_000_000_000_000n);
    const rpc = new FakeRelayerEvmRpc(new Map());

    // Simulate a concurrent winner: move the row past `attested` before submitOutboundUntilDelivered's
    // own transition call runs, so that call hits a version conflict. Unlike the inbound direction
    // (where the equivalent race is caught BEFORE broadcasting), the outbound broadcast has already
    // happened by the time this race is detected — see outbound-submit.ts's own doc comment for why
    // no additional release happens here.
    await repo.transition(transfer.id, transfer.version, "submitting", {
      destinationTxHash: "0xsomeoneelsealreadywon",
    });

    const result = await submitOutboundUntilDelivered(
      transfer,
      baseOptions(repo, spendLog, rpc, { spendCeiling }),
    );

    expect(eventTypes(spendLog)).toEqual(["reserved", "broadcast"]);
    expect(result.status).toBe("submitting");
    expect(result.destinationTxHash).toBe("0xsomeoneelsealreadywon");
  });
});
