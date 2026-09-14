import { newTransferId } from "@ferryline/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { FakeRelayerEvmRpc } from "../chain/fake-evm-rpc.test-support.js";
import { PostgresOutboundTransferRepository } from "../repo/postgres-outbound-transfers.js";
import type { RegisterOutboundTransferInput } from "../repo/outbound-types.js";
import { startTestPostgres, type TestPostgres } from "../repo/test-postgres.js";
import {
  reconcileAllOutboundSubmitting,
  reconcileOutboundSubmitting,
} from "./outbound-reconcile.js";

const MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const; // real, verified Sepolia address (submit-receive-message.mjs)
const DELIVERED_NONCE = `0x${"11".repeat(32)}` as const;
const UNUSED_NONCE = `0x${"22".repeat(32)}` as const;

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

function baseInput(
  overrides: Partial<RegisterOutboundTransferInput> = {},
): RegisterOutboundTransferInput {
  return {
    id: newTransferId(),
    rail: "usdc-cctp",
    sourceTxHash: crypto.randomUUID().replace(/-/g, ""),
    sourceDomain: 27,
    destinationChain: "ethereum-sepolia",
    ...overrides,
  };
}

/**
 * Crash-recovery contract for the OUTBOUND direction, the exact same standard
 * work/reconcile.integration.test.ts already proved for inbound: reproduces the real database state
 * a crash between "wrote submitting" and "confirmed delivered" would leave — a real Postgres row in
 * `submitting`, destination_tx_hash already written (the crash-safe ordering
 * outbound-submit.ts's own doc comment guarantees) — against a REAL Postgres instance, then runs the
 * exact reconciliation function the outbound relayer calls at startup against that state.
 *
 * Uses a synthetic (not fixture-replayed) EVM nonce verdict — see FakeRelayerEvmRpc's own doc
 * comment for why: this repo has no real recorded EVM usedNonces fixture yet (that's STEP 6's real
 * testnet run). What this test proves is real regardless: the relayer's OWN logic, given a real
 * "nonce is used" or "nonce is unused" answer from whatever actually answers that question, does
 * the right thing with a real database row.
 */
describe("outbound crash recovery: a transfer stuck in `submitting`", () => {
  it("case 1 — the prior submission SUCCEEDED (nonce already used): reconciliation marks it delivered, without resubmitting", async () => {
    const repo = new PostgresOutboundTransferRepository(db.pool);
    const rpc = new FakeRelayerEvmRpc(new Map([[DELIVERED_NONCE, 1n]]));

    // Reproduce exactly what outbound-submit.ts leaves behind right after its critical write, as if
    // the process had died the instant after that write committed and before it ever observed
    // waitForReceipt's response (the crash point named in the design doc).
    const registered = await repo.register(baseInput());
    const attested = await repo.transition(registered.id, registered.version, "attested", {
      amount: "1000000",
      recipient: "0x78253429b7483FBcCEf90e943526BB990a4D5b5",
      irisNonce: DELIVERED_NONCE,
      irisMessage: "0xdeadbeef",
      irisAttestation: "0xcafe",
    });
    const stuck = await repo.transition(attested.id, attested.version, "submitting", {
      destinationTxHash: "0xsomehashthecrashedprocesscomputedpreconfirmation",
    });
    expect(stuck.status).toBe("submitting");

    // --- process "restarts" here; a fresh reconciliation pass runs against the row left behind ---

    const outcome = await reconcileOutboundSubmitting(stuck, {
      rpc,
      repo,
      messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
    });

    expect(outcome.kind).toBe("already-delivered");
    expect(outcome.row.status).toBe("delivered");

    // The defining property of this case: reconciliation must NEVER attempt to resubmit or spend
    // gas again for a transfer that already landed. It only ever calls readContract (usedNonces, a
    // read), never simulateReceiveMessage/writeReceiveMessage.
    expect(rpc.broadcastCalls).toHaveLength(0);

    const reread = await repo.get(stuck.id);
    expect(reread?.status).toBe("delivered");
  });

  it("case 2 — the prior submission did NOT land (nonce still unused): reconciliation reports it safe to resubmit, without marking it delivered", async () => {
    const repo = new PostgresOutboundTransferRepository(db.pool);
    const rpc = new FakeRelayerEvmRpc(new Map([[UNUSED_NONCE, 0n]]));

    const registered = await repo.register(baseInput());
    const attested = await repo.transition(registered.id, registered.version, "attested", {
      amount: "1000000",
      recipient: "0x78253429b7483FBcCEf90e943526BB990a4D5b5",
      irisNonce: UNUSED_NONCE,
      irisMessage: "0xdeadbeef",
      irisAttestation: "0xcafe",
    });
    const stuck = await repo.transition(attested.id, attested.version, "submitting", {
      destinationTxHash: "0xsomehashthecrashedprocesscomputedpreconfirmation",
    });

    // --- process "restarts" here ---

    const outcome = await reconcileOutboundSubmitting(stuck, {
      rpc,
      repo,
      messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
    });

    expect(outcome.kind).toBe("resubmit");
    // Crucially, the row must be left exactly as `submitting` — NOT `delivered` (a false positive:
    // nothing landed) and NOT rolled back to `attested`/`pending` (which would let a second,
    // concurrent reconciliation pass race it).
    expect(outcome.row.status).toBe("submitting");
    expect(rpc.broadcastCalls).toHaveLength(0);

    const reread = await repo.get(stuck.id);
    expect(reread?.status).toBe("submitting");
    expect(reread?.destinationTxHash).toBe("0xsomehashthecrashedprocesscomputedpreconfirmation");
  });

  it("reconcileAllOutboundSubmitting processes every stuck row, resolving each independently", async () => {
    const repo = new PostgresOutboundTransferRepository(db.pool);
    const rpc = new FakeRelayerEvmRpc(
      new Map([
        [DELIVERED_NONCE, 1n],
        [UNUSED_NONCE, 0n],
      ]),
    );

    async function stick(nonce: `0x${string}`): Promise<string> {
      const registered = await repo.register(baseInput());
      const attested = await repo.transition(registered.id, registered.version, "attested", {
        amount: "1000000",
        recipient: "0x78253429b7483FBcCEf90e943526BB990a4D5b5",
        irisNonce: nonce,
        irisMessage: "0xdeadbeef",
        irisAttestation: "0xcafe",
      });
      const stuck = await repo.transition(attested.id, attested.version, "submitting", {
        destinationTxHash: `0xhashfor${registered.id}`,
      });
      return stuck.id;
    }

    const deliveredId = await stick(DELIVERED_NONCE);
    const resubmitId = await stick(UNUSED_NONCE);

    const outcomes = await reconcileAllOutboundSubmitting({
      rpc,
      repo,
      messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
    });

    expect(outcomes).toHaveLength(2);
    const byId = new Map(outcomes.map((o) => [o.row.id, o]));
    expect(byId.get(deliveredId)?.kind).toBe("already-delivered");
    expect(byId.get(resubmitId)?.kind).toBe("resubmit");

    expect((await repo.get(deliveredId))?.status).toBe("delivered");
    expect((await repo.get(resubmitId))?.status).toBe("submitting");
  });

  it("rejects reconciling a row that is not actually in `submitting`", async () => {
    const repo = new PostgresOutboundTransferRepository(db.pool);
    const rpc = new FakeRelayerEvmRpc(new Map([[DELIVERED_NONCE, 1n]]));
    const pending = await repo.register(baseInput());

    await expect(
      reconcileOutboundSubmitting(pending, {
        rpc,
        repo,
        messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
      }),
    ).rejects.toThrow(/not "submitting"/);
  });
});
