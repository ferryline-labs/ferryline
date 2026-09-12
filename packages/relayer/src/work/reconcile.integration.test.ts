import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { newTransferId } from "@ferryline/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { FakeRelayerStellarRpc, type RecordedNonceCheck } from "../chain/fake-rpc.test-support.js";
import { PostgresTransferRepository } from "../repo/postgres-transfers.js";
import { startTestPostgres, type TestPostgres } from "../repo/test-postgres.js";
import type { RegisterTransferInput } from "../repo/types.js";
import { reconcileAllSubmitting, reconcileSubmitting } from "./reconcile.js";

const here = dirname(fileURLToPath(import.meta.url));
const nonceFixtures = JSON.parse(
  readFileSync(
    join(here, "..", "chain", "__fixtures__", "is-nonce-used-mainnet-2026-09-11.json"),
    "utf8",
  ),
) as { messageTransmitterContractId: string; fixtures: RecordedNonceCheck[] };
const MESSAGE_TRANSMITTER = nonceFixtures.messageTransmitterContractId;
const DELIVERED_NONCE = nonceFixtures.fixtures.find((f) => f.expected)!.nonceHex;
const UNUSED_NONCE = nonceFixtures.fixtures.find((f) => !f.expected)!.nonceHex;
const NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015";

let db: TestPostgres;

beforeAll(async () => {
  db = await startTestPostgres();
}, 60_000);

afterEach(async () => {
  await db.truncateAll();
});

afterAll(async () => {
  await db.stop();
});

function baseInput(overrides: Partial<RegisterTransferInput> = {}): RegisterTransferInput {
  return {
    id: newTransferId(),
    rail: "usdc-cctp",
    sourceChain: "base",
    sourceTxHash: `0x${crypto.randomUUID().replace(/-/g, "")}`,
    sourceDomain: 6,
    ...overrides,
  };
}

/**
 * Crash-recovery contract, per the phase-3 sign-off: "kills the process (or simulates a crash)
 * between 'wrote submitting' and 'confirmed delivered' and proves recovery does the right thing in
 * both cases."
 *
 * This test does not literally SIGKILL a child process — that would test the operating system, not
 * Ferryline's logic. What it does instead, and what actually matters: it reproduces the exact
 * database state a real crash at that point would leave behind (a `transfers` row in `submitting`,
 * with the destination_tx_hash already written — the crash-safe ordering submitUntilDelivered
 * guarantees, see work/submit.ts), against a REAL Postgres instance (not a mock of one), and then
 * runs the exact reconciliation function the relayer calls at startup against that state, checking
 * the real is_nonce_used answer for two genuinely different mainnet-observed cases.
 */
describe("crash recovery: a transfer stuck in `submitting`", () => {
  it("case 1 — the prior submission SUCCEEDED (nonce already used): reconciliation marks it delivered, without resubmitting", async () => {
    const repo = new PostgresTransferRepository(db.pool);
    const rpc = new FakeRelayerStellarRpc(nonceFixtures.fixtures);

    // Reproduce exactly what submitUntilDelivered leaves behind right after its critical write,
    // as if the process had died the instant after that write committed and before it ever
    // observed sendTransaction's response (the crash point named in the sign-off).
    const registered = await repo.register(baseInput());
    const attested = await repo.transition(registered.id, registered.version, "attested", {
      amount: "1000000",
      recipient: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
      irisNonce: DELIVERED_NONCE,
      irisMessage: "0xdeadbeef",
      irisAttestation: "0xcafe",
      mintRecipient: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
      destinationCaller: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
    });
    const stuck = await repo.transition(attested.id, attested.version, "submitting", {
      destinationTxHash: "some-hash-the-crashed-process-computed-pre-broadcast",
    });
    expect(stuck.status).toBe("submitting");

    // --- process "restarts" here; a fresh reconciliation pass runs against the row left behind ---

    const outcome = await reconcileSubmitting(stuck, {
      rpc,
      repo,
      networkPassphrase: NETWORK_PASSPHRASE,
      messageTransmitterContractId: MESSAGE_TRANSMITTER,
      sourceAccount: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
    });

    expect(outcome.kind).toBe("already-delivered");
    expect(outcome.row.status).toBe("delivered");

    // The defining property of this case: reconciliation must NEVER attempt to resubmit or spend
    // again for a transfer that already landed. It only ever calls simulateTransaction
    // (is_nonce_used, a read), never sendTransaction.
    expect(rpc.sentEnvelopes).toHaveLength(0);

    const reread = await repo.get(stuck.id);
    expect(reread?.status).toBe("delivered");
  });

  it("case 2 — the prior submission did NOT land (nonce still unused): reconciliation reports it safe to resubmit, without marking it delivered", async () => {
    const repo = new PostgresTransferRepository(db.pool);
    const rpc = new FakeRelayerStellarRpc(nonceFixtures.fixtures);

    const registered = await repo.register(baseInput());
    const attested = await repo.transition(registered.id, registered.version, "attested", {
      amount: "1000000",
      recipient: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
      irisNonce: UNUSED_NONCE,
      irisMessage: "0xdeadbeef",
      irisAttestation: "0xcafe",
      mintRecipient: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
      destinationCaller: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
    });
    const stuck = await repo.transition(attested.id, attested.version, "submitting", {
      destinationTxHash: "some-hash-the-crashed-process-computed-pre-broadcast",
    });

    // --- process "restarts" here ---

    const outcome = await reconcileSubmitting(stuck, {
      rpc,
      repo,
      networkPassphrase: NETWORK_PASSPHRASE,
      messageTransmitterContractId: MESSAGE_TRANSMITTER,
      sourceAccount: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
    });

    expect(outcome.kind).toBe("resubmit");
    // Crucially, the row must be left exactly as `submitting` — NOT `delivered` (that would be a
    // false positive: nothing landed) and NOT rolled back to `attested`/`pending` (which would let
    // a second, concurrent reconciliation pass race it). It stays `submitting` until the caller's
    // normal submit path (re-)broadcasts and this same reconciliation logic, or waitForDelivery,
    // observes a nonce flip to used.
    expect(outcome.row.status).toBe("submitting");
    expect(rpc.sentEnvelopes).toHaveLength(0);

    const reread = await repo.get(stuck.id);
    expect(reread?.status).toBe("submitting");
    expect(reread?.destinationTxHash).toBe("some-hash-the-crashed-process-computed-pre-broadcast");
  });

  it("reconcileAllSubmitting processes every stuck row, resolving each independently", async () => {
    const repo = new PostgresTransferRepository(db.pool);
    const rpc = new FakeRelayerStellarRpc(nonceFixtures.fixtures);

    async function stick(nonce: string): Promise<string> {
      const registered = await repo.register(baseInput());
      const attested = await repo.transition(registered.id, registered.version, "attested", {
        amount: "1000000",
        recipient: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
        irisNonce: nonce,
        irisMessage: "0xdeadbeef",
        irisAttestation: "0xcafe",
        mintRecipient: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
        destinationCaller: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
      });
      const stuck = await repo.transition(attested.id, attested.version, "submitting", {
        destinationTxHash: `hash-for-${registered.id}`,
      });
      return stuck.id;
    }

    const deliveredId = await stick(DELIVERED_NONCE);
    const resubmitId = await stick(UNUSED_NONCE);

    const outcomes = await reconcileAllSubmitting({
      rpc,
      repo,
      networkPassphrase: NETWORK_PASSPHRASE,
      messageTransmitterContractId: MESSAGE_TRANSMITTER,
      sourceAccount: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
    });

    expect(outcomes).toHaveLength(2);
    const byId = new Map(outcomes.map((o) => [o.row.id, o]));
    expect(byId.get(deliveredId)?.kind).toBe("already-delivered");
    expect(byId.get(resubmitId)?.kind).toBe("resubmit");

    expect((await repo.get(deliveredId))?.status).toBe("delivered");
    expect((await repo.get(resubmitId))?.status).toBe("submitting");
  });

  it("rejects reconciling a row that is not actually in `submitting`", async () => {
    const repo = new PostgresTransferRepository(db.pool);
    const rpc = new FakeRelayerStellarRpc(nonceFixtures.fixtures);
    const pending = await repo.register(baseInput());

    await expect(
      reconcileSubmitting(pending, {
        rpc,
        repo,
        networkPassphrase: NETWORK_PASSPHRASE,
        messageTransmitterContractId: MESSAGE_TRANSMITTER,
        sourceAccount: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
      }),
    ).rejects.toThrow(/not "submitting"/);
  });
});
