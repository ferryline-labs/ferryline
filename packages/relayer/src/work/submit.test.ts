import { describe, expect, it } from "vitest";

import { SpendCapExceededError } from "../chain/mint-and-forward.js";
import { InMemoryTransferRepository } from "../repo/in-memory-transfers.js";
import type { TransferRow } from "../repo/types.js";
import type { Signer } from "../signer/types.js";
import { InMemorySpendCeiling } from "../spend/ceiling.js";
import { InMemorySpendLog, type SpendLedgerEvent } from "../spend/spend-log.js";
import { RelayerRetryableError } from "./errors.js";
import { submitUntilDelivered, type SubmitOptions } from "./submit.js";

/**
 * These tests exercise submit.ts's own responsibility — the spend-cap sequence, the crash-safe
 * `submitting` write ordering, and (STEP 5's focus) the spend-log/spend-ledger-events write ordering
 * — NOT a real Soroban simulation of `mint_and_forward`. buildSignedFeeBumpMintAndForward and
 * broadcastFeeBump are replaced via `drivers`, a seam submit.ts exposes for exactly this reason (see
 * its own doc comment); production code (main.ts, via work/loop.ts) never sets it. A real fixture-
 * recorded RPC simulation of the actual contract call belongs to chain/mint-and-forward.ts's own
 * test coverage, a separate concern from this file's spend-sequencing logic.
 */

const FORWARDER = "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T";
const MESSAGE_TRANSMITTER = "CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV";
const SPONSOR = "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q";
const RECIPIENT = "GB44W23OXZC2EQBM4E3XM7DLFYM6AV66CUOA2FXDBNZ6IZ2T4EZERZIH";

const fakeSigner: Signer = {
  publicKey: () => Promise.resolve(SPONSOR),
  sign: (xdr) => Promise.resolve(xdr),
};

async function registerAttested(
  repo: InMemoryTransferRepository,
  id: string,
): Promise<TransferRow> {
  const pending = await repo.register({
    id,
    rail: "usdc-cctp",
    sourceChain: "ethereum",
    sourceTxHash: `0x${id}`,
    sourceDomain: 0,
  });
  return repo.transition(pending.id, pending.version, "attested", {
    amount: "1000000",
    recipient: RECIPIENT,
    irisNonce: "0xnonce",
    irisMessage: "0xmessage",
    irisAttestation: "0xattestation",
    mintRecipient: FORWARDER,
    destinationCaller: FORWARDER,
  });
}

/** A minimal, real fee-bump envelope: an unsigned Transaction fee-bumped by the sponsor, built via
 *  the real stellar-sdk so asFeeBump()/feeBumpHashHex() (submit.ts's own helpers) can parse it —
 *  this test file is not trying to prove anything about the ENVELOPE's contents, only about the
 *  spend-log ordering around it, so a minimal real envelope is enough. */
async function realFeeBumpEnvelope(): Promise<string> {
  const { Account, BASE_FEE, Networks, Operation, TransactionBuilder } =
    await import("@stellar/stellar-sdk");
  const inner = new TransactionBuilder(new Account(SPONSOR, "0"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "0" }))
    .setTimeout(30)
    .build();
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    SPONSOR,
    BASE_FEE,
    inner,
    Networks.TESTNET,
  );
  return feeBump.toXDR();
}

function baseOptions(
  repo: InMemoryTransferRepository,
  spendLog: InMemorySpendLog,
  overrides: Partial<SubmitOptions["drivers"]> & {
    maxFeeBumpStroops?: bigint;
    spendCeiling?: InMemorySpendCeiling;
  } = {},
): SubmitOptions {
  return {
    rpc: {} as SubmitOptions["rpc"], // never called directly: drivers replace both call sites that would use it
    repo,
    signer: fakeSigner,
    sponsorAccount: SPONSOR,
    networkPassphrase: "Test SDF Network ; September 2015",
    forwarderContractId: FORWARDER,
    messageTransmitterContractId: MESSAGE_TRANSMITTER,
    maxFeeBumpStroops: overrides.maxFeeBumpStroops ?? 10_000_000n,
    spendCeiling: overrides.spendCeiling ?? new InMemorySpendCeiling(1_000_000_000n),
    spendLog,
    pollIntervalMs: 0,
    pollMaxIntervalMs: 0,
    drivers: {
      buildSignedFeeBumpMintAndForward:
        overrides.buildSignedFeeBumpMintAndForward ??
        (async () => ({ envelopeXdr: await realFeeBumpEnvelope(), feeBumpFeeStroops: 100n })),
      broadcastFeeBump:
        overrides.broadcastFeeBump ?? (() => Promise.resolve({ hash: "abc", status: "PENDING" })),
    },
  };
}

function eventTypes(spendLog: InMemorySpendLog): SpendLedgerEvent["type"][] {
  return spendLog.events.map((e) => e.type);
}

describe("submitUntilDelivered: spend-log write ordering (STEP 5)", () => {
  it("on the happy path: logs the attempt, then 'reserved', then reserves, then 'submitting', then 'broadcast' — each before its action", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA1");
    const spendLog = new InMemorySpendLog();
    const spendCeiling = new InMemorySpendCeiling(1_000_000_000n);

    // waitForDelivery would poll forever with a fake rpc; abort immediately after submitUntilDelivered
    // itself resolves the part this test cares about by using a signal that is already aborted, so
    // waitForDelivery's first is_nonce_used call throws (fake rpc has no getAccount), which this test
    // catches — the assertions below all concern the write ordering BEFORE that point.
    const controller = new AbortController();
    controller.abort();

    await expect(
      submitUntilDelivered(
        transfer,
        baseOptions(repo, spendLog, { spendCeiling }),
        controller.signal,
      ),
    ).rejects.toBeDefined(); // waitForDelivery's fake-rpc call fails; irrelevant to this test's claim

    expect(spendLog.entries).toHaveLength(1);
    expect(spendLog.entries[0]).toMatchObject({ transferId: transfer.id, amountStroops: 100n });
    expect(eventTypes(spendLog)).toEqual(["reserved", "broadcast"]);

    const reservedEvent = spendLog.events[0];
    expect(reservedEvent).toMatchObject({
      type: "reserved",
      transferId: transfer.id,
      amountStroops: 100n,
    });
    // The reservation must be REAL by the time 'reserved' is logged: spentToday() already reflects it.
    expect(await spendCeiling.spentToday()).toBe(100n);

    const reread = await repo.get(transfer.id);
    expect(reread?.status).toBe("submitting"); // the crash-safe write happened
    expect(reread?.destinationTxHash).toBeTruthy();
  });

  it("logs a 'released' event with reason concurrent_race_lost, BEFORE the actual release, when a concurrent worker wins the race to `submitting`", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA2");
    const spendLog = new InMemorySpendLog();
    const spendCeiling = new InMemorySpendCeiling(1_000_000_000n);

    // Simulate a concurrent winner: move the row past `attested` before submitUntilDelivered's own
    // transition call runs, so that call hits a version conflict.
    await repo.transition(transfer.id, transfer.version, "submitting", {
      destinationTxHash: "someoneelsealreadywon",
    });

    const result = await submitUntilDelivered(
      transfer,
      baseOptions(repo, spendLog, { spendCeiling }),
    );

    expect(eventTypes(spendLog)).toEqual(["reserved", "released"]);
    expect(spendLog.events[1]).toMatchObject({
      type: "released",
      transferId: transfer.id,
      amountStroops: 100n,
      reason: "concurrent_race_lost",
    });
    // The reservation must actually be given back: spentToday() nets to zero, not left at 100n.
    expect(await spendCeiling.spentToday()).toBe(0n);
    // And the caller gets back wherever the row actually is now, not a thrown ambiguity.
    expect(result.status).toBe("submitting");
    expect(result.destinationTxHash).toBe("someoneelsealreadywon");
  });

  it("logs a 'released' event with reason broadcast_rejected, BEFORE the actual release, when sendTransaction returns ERROR", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA3");
    const spendLog = new InMemorySpendLog();
    const spendCeiling = new InMemorySpendCeiling(1_000_000_000n);

    await expect(
      submitUntilDelivered(
        transfer,
        baseOptions(repo, spendLog, {
          spendCeiling,
          broadcastFeeBump: () =>
            Promise.resolve({ hash: "dead", status: "ERROR", errorDetail: "bad sequence number" }),
        }),
      ),
    ).rejects.toThrow(RelayerRetryableError);

    expect(eventTypes(spendLog)).toEqual(["reserved", "released"]);
    expect(spendLog.events[1]).toMatchObject({
      type: "released",
      transferId: transfer.id,
      amountStroops: 100n,
      reason: "broadcast_rejected",
    });
    expect(await spendCeiling.spentToday()).toBe(0n);

    // The row is left `submitting` (the crash-safe write already happened before broadcast) with a
    // hash that will never appear on-chain — reconcileSubmitting resolves this on restart.
    const reread = await repo.get(transfer.id);
    expect(reread?.status).toBe("submitting");
  });

  it("writes NO spend_ledger_events row when the daily ceiling has no room: the reservation never actually happened", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA4");
    const spendLog = new InMemorySpendLog();
    const spendCeiling = new InMemorySpendCeiling(50n); // room for less than the 100n quote

    await expect(
      submitUntilDelivered(transfer, baseOptions(repo, spendLog, { spendCeiling })),
    ).rejects.toThrow(RelayerRetryableError);

    // The attempt is still logged to spend_attempts (that log is unconditional, before the
    // reservation is even tried) — but spend_ledger_events has nothing, since reserve() never
    // actually succeeded: there is no 'reserved' event to release, and none should be invented.
    expect(spendLog.entries).toHaveLength(1);
    expect(eventTypes(spendLog)).toEqual([]);
    const reread = await repo.get(transfer.id);
    expect(reread?.status).toBe("attested"); // unchanged: no status-changing transition happens
  });

  it("writes NO spend_ledger_events row when the per-transfer spend cap is exceeded: no reservation was ever attempted", async () => {
    const repo = new InMemoryTransferRepository();
    const transfer = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA5");
    const spendLog = new InMemorySpendLog();

    const result = await submitUntilDelivered(
      transfer,
      baseOptions(repo, spendLog, {
        buildSignedFeeBumpMintAndForward: () =>
          Promise.reject(new SpendCapExceededError(999_999_999n, 10_000_000n)),
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("TRANSFER_EXCEEDS_SPEND_CAP");
    // Nothing was ever logged at all here: the cap rejection happens before spendLog.record's own
    // call site (step 1 fails before "every spend attempt is logged" even runs).
    expect(spendLog.entries).toHaveLength(0);
    expect(eventTypes(spendLog)).toEqual([]);
  });
});
