import { describe, expect, it } from "vitest";

import { newTransferId } from "@ferryline/core";

import {
  DuplicateTransferError,
  IllegalTransitionError,
  VersionConflictError,
  type RegisterTransferInput,
  type TransferRepository,
} from "./types.js";

/**
 * One behavioral contract, run against every TransferRepository implementation. A test that passes
 * here against the in-memory fake is a claim about the interface's contract; running the exact same
 * suite against PostgresTransferRepository (see postgres-transfers.integration.test.ts) is what turns
 * that into a claim about the real thing.
 */
export function describeTransferRepositoryContract(
  name: string,
  makeRepo: () => Promise<TransferRepository> | TransferRepository,
): void {
  describe(`TransferRepository contract: ${name}`, () => {
    function input(overrides: Partial<RegisterTransferInput> = {}): RegisterTransferInput {
      return {
        id: newTransferId(),
        rail: "usdc-cctp",
        sourceChain: "base",
        sourceTxHash:
          `0x${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`.slice(
            0,
            66,
          ),
        sourceDomain: 6,
        amount: "1000000",
        recipient: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
        ...overrides,
      };
    }

    it("registers a transfer at status pending with version 1", async () => {
      const repo = await makeRepo();
      const row = await repo.register(input());
      expect(row.status).toBe("pending");
      expect(row.version).toBe(1);
      expect(row.destinationTxHash).toBeNull();
      expect(row.errorCode).toBeNull();
    });

    it("rejects a duplicate (sourceChain, sourceTxHash) registration", async () => {
      const repo = await makeRepo();
      const params = input();
      await repo.register(params);
      await expect(repo.register(params)).rejects.toBeInstanceOf(DuplicateTransferError);
    });

    it("get returns undefined for an unknown id", async () => {
      const repo = await makeRepo();
      expect(await repo.get("01ARZ3NDEKTSV4RRFFQ69G5FA0")).toBeUndefined();
    });

    it("walks the full happy path pending -> attested -> submitting -> delivered", async () => {
      const repo = await makeRepo();
      const row = await repo.register(input());

      const attested = await repo.transition(row.id, row.version, "attested", {
        irisNonce: "0xabc",
        irisMessage: "0xdead",
        irisAttestation: "0xbeef",
        mintRecipient: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
        destinationCaller: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
      });
      expect(attested.status).toBe("attested");
      expect(attested.version).toBe(row.version + 1);
      expect(attested.irisNonce).toBe("0xabc");

      const submitting = await repo.transition(attested.id, attested.version, "submitting");
      expect(submitting.status).toBe("submitting");
      expect(submitting.version).toBe(attested.version + 1);

      const delivered = await repo.transition(submitting.id, submitting.version, "delivered", {
        destinationTxHash: "abc123",
      });
      expect(delivered.status).toBe("delivered");
      expect(delivered.destinationTxHash).toBe("abc123");
    });

    it("rejects illegal transitions (skipping a state, or moving out of a terminal state)", async () => {
      const repo = await makeRepo();
      const row = await repo.register(input());

      // pending -> submitting is not allowed; must go through attested.
      await expect(repo.transition(row.id, row.version, "submitting")).rejects.toBeInstanceOf(
        IllegalTransitionError,
      );

      const failed = await repo.transition(row.id, row.version, "failed", {
        errorCode: "MALFORMED_MESSAGE",
        errorDetail: "test",
      });
      expect(failed.status).toBe("failed");

      // failed is terminal: nothing moves out of it.
      await expect(repo.transition(failed.id, failed.version, "attested")).rejects.toBeInstanceOf(
        IllegalTransitionError,
      );
    });

    it("rejects a transition whose expectedVersion is stale (optimistic concurrency)", async () => {
      const repo = await makeRepo();
      const row = await repo.register(input());

      // Two callers both read the row at version 1 and race to advance it.
      const winner = await repo.transition(row.id, row.version, "attested");
      expect(winner.version).toBe(row.version + 1);

      // The loser retries the SAME transition (pending -> attested) with the SAME stale version
      // number the row no longer has. The row's actual current status is now "attested", so this
      // is simultaneously "the transition pending->attested is no longer legal from here" (the
      // row moved) AND "the version I hold is stale" (the row moved). Implementations differing
      // on which check fires first is fine; both errors mean the same thing operationally: stop,
      // re-read, decide again. What the test pins down is that it is one of these two, not silent
      // success or a third, unrelated error.
      const loserError: unknown = await repo
        .transition(row.id, row.version, "attested")
        .catch((error: unknown) => error);
      expect(loserError).toSatisfy(
        (e: unknown) => e instanceof VersionConflictError || e instanceof IllegalTransitionError,
      );

      // Isolate the version check on its own: a transition that IS still legal from the row's
      // current status ("attested" -> "submitting"), but presented with the stale version. This can
      // only fail as a version conflict, never as an illegal transition.
      await expect(repo.transition(row.id, row.version, "submitting")).rejects.toBeInstanceOf(
        VersionConflictError,
      );
    });

    it("failed is reachable from every non-terminal status", async () => {
      const repo = await makeRepo();
      for (const from of ["pending", "attested", "submitting"] as const) {
        const row = await repo.register(input());
        let current = row;
        if (from === "attested" || from === "submitting") {
          current = await repo.transition(current.id, current.version, "attested");
        }
        if (from === "submitting") {
          current = await repo.transition(current.id, current.version, "submitting");
        }
        const failed = await repo.transition(current.id, current.version, "failed", {
          errorCode: "NONCE_ALREADY_USED",
          errorDetail: `from ${from}`,
        });
        expect(failed.status).toBe("failed");
        expect(failed.errorCode).toBe("NONCE_ALREADY_USED");
      }
    });

    it("listByStatus returns only rows in that status, oldest first", async () => {
      const repo = await makeRepo();
      const a = await repo.register(input());
      await new Promise((r) => setTimeout(r, 5));
      const b = await repo.register(input());
      await repo.transition(a.id, a.version, "attested");

      const pending = await repo.listByStatus("pending");
      expect(pending.map((r) => r.id)).toEqual([b.id]);

      const attested = await repo.listByStatus("attested");
      expect(attested.map((r) => r.id)).toEqual([a.id]);
    });

    it("countByRecipientSince counts only that recipient's transfers created on or after the window start", async () => {
      const repo = await makeRepo();
      const recipient = "GBZOXV2V4U4QOAE34EUM7CAQLHME434UFAVAPCSKGVBDDZPGD3Z3ADZJ";
      const otherRecipient = "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q";

      // A row from before the window: its own createdAt (as the repository itself assigned it, not
      // a JS-side Date racing the DB's clock) is the window boundary, so "since" is unambiguous
      // regardless of clock resolution or skew between the test process and the database. The
      // explicit gap guards against `before` and the first in-window row landing on the exact same
      // timestamp tick, which countByRecipientSince's `>= since` would (correctly, for the rolling
      // window's real semantics) include.
      const before = await repo.register(input({ recipient: otherRecipient }));
      await new Promise((r) => setTimeout(r, 5));
      const since = new Date(before.createdAt.getTime() + 1);

      const inWindowA = await repo.register(input({ recipient }));
      const inWindowB = await repo.register(input({ recipient }));
      await repo.register(input({ recipient: otherRecipient }));

      // Both in-window rows must not have been created strictly before the boundary; if the
      // repository's clock resolution ever made that ambiguous, that is itself worth surfacing
      // rather than silently tolerating with a sleep.
      expect(inWindowA.createdAt.getTime()).toBeGreaterThanOrEqual(since.getTime());
      expect(inWindowB.createdAt.getTime()).toBeGreaterThanOrEqual(since.getTime());

      expect(await repo.countByRecipientSince(recipient, since)).toBe(2);
      expect(await repo.countByRecipientSince(recipient, new Date(since.getTime() - 1))).toBe(2);
      expect(await repo.countByRecipientSince(recipient, new Date(Date.now() + 60_000))).toBe(0);
    });
  });
}
