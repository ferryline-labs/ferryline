import { describe, expect, it } from "vitest";

import { newTransferId } from "@ferryline/core";

import {
  DuplicateOutboundTransferError,
  OutboundIllegalTransitionError,
  OutboundVersionConflictError,
  type OutboundTransferRepository,
  type RegisterOutboundTransferInput,
} from "./outbound-types.js";

/**
 * One behavioral contract, run against every OutboundTransferRepository implementation — the exact
 * same discipline as describeTransferRepositoryContract (see that file's own doc comment): a test
 * passing against the in-memory fake is a claim about the interface's contract, running the same
 * suite against PostgresOutboundTransferRepository (see postgres-outbound-transfers.integration.test.ts)
 * is what turns that into a claim about the real thing.
 */
export function describeOutboundTransferRepositoryContract(
  name: string,
  makeRepo: () => Promise<OutboundTransferRepository> | OutboundTransferRepository,
): void {
  describe(`OutboundTransferRepository contract: ${name}`, () => {
    function input(
      overrides: Partial<RegisterOutboundTransferInput> = {},
    ): RegisterOutboundTransferInput {
      return {
        id: newTransferId(),
        rail: "usdc-cctp",
        sourceTxHash:
          `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`.slice(
            0,
            64,
          ),
        sourceDomain: 27,
        destinationChain: "ethereum-sepolia",
        ...overrides,
      };
    }

    it("registers a transfer at status pending with version 1, amount and recipient unknown until attested", async () => {
      const repo = await makeRepo();
      const row = await repo.register(input());
      expect(row.status).toBe("pending");
      expect(row.version).toBe(1);
      expect(row.sourceChain).toBe("stellar");
      expect(row.destinationTxHash).toBeNull();
      expect(row.errorCode).toBeNull();
      expect(row.amount).toBeNull();
      expect(row.recipient).toBeNull();
    });

    it("rejects a duplicate sourceTxHash registration", async () => {
      const repo = await makeRepo();
      const params = input();
      await repo.register(params);
      await expect(repo.register(params)).rejects.toBeInstanceOf(DuplicateOutboundTransferError);
    });

    it("get returns undefined for an unknown id", async () => {
      const repo = await makeRepo();
      expect(await repo.get("01ARZ3NDEKTSV4RRFFQ69G5FA0")).toBeUndefined();
    });

    it("walks the full happy path pending -> attested -> submitting -> delivered", async () => {
      const repo = await makeRepo();
      const row = await repo.register(input());

      const attested = await repo.transition(row.id, row.version, "attested", {
        amount: "1000000",
        recipient: "0x78253429b7483FBcCEf90e943526BB990a4D5b5",
        irisNonce: "0xabc",
        irisMessage: "0xdead",
        irisAttestation: "0xbeef",
      });
      expect(attested.status).toBe("attested");
      expect(attested.version).toBe(row.version + 1);
      expect(attested.irisNonce).toBe("0xabc");
      expect(attested.amount).toBe("1000000");
      expect(attested.recipient).toBe("0x78253429b7483FBcCEf90e943526BB990a4D5b5");

      const submitting = await repo.transition(attested.id, attested.version, "submitting");
      expect(submitting.status).toBe("submitting");
      expect(submitting.version).toBe(attested.version + 1);

      const delivered = await repo.transition(submitting.id, submitting.version, "delivered", {
        destinationTxHash: "0xabc123",
      });
      expect(delivered.status).toBe("delivered");
      expect(delivered.destinationTxHash).toBe("0xabc123");
    });

    it("rejects illegal transitions (skipping a state, or moving out of a terminal state)", async () => {
      const repo = await makeRepo();
      const row = await repo.register(input());

      await expect(repo.transition(row.id, row.version, "submitting")).rejects.toBeInstanceOf(
        OutboundIllegalTransitionError,
      );

      const failed = await repo.transition(row.id, row.version, "failed", {
        errorCode: "MALFORMED_MESSAGE",
        errorDetail: "test",
      });
      expect(failed.status).toBe("failed");

      await expect(repo.transition(failed.id, failed.version, "attested")).rejects.toBeInstanceOf(
        OutboundIllegalTransitionError,
      );
    });

    it("rejects a transition whose expectedVersion is stale (optimistic concurrency)", async () => {
      const repo = await makeRepo();
      const row = await repo.register(input());

      const winner = await repo.transition(row.id, row.version, "attested");
      expect(winner.version).toBe(row.version + 1);

      const loserError: unknown = await repo
        .transition(row.id, row.version, "attested")
        .catch((error: unknown) => error);
      expect(loserError).toSatisfy(
        (e: unknown) =>
          e instanceof OutboundVersionConflictError || e instanceof OutboundIllegalTransitionError,
      );

      await expect(repo.transition(row.id, row.version, "submitting")).rejects.toBeInstanceOf(
        OutboundVersionConflictError,
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
      const recipient = "0x78253429b7483FBcCEf90e943526BB990a4D5b5";
      const otherRecipient = "0x000000000000000000000000000000000000aa";
      async function registerAndAttestTo(who: `0x${string}`) {
        const row = await repo.register(input());
        return repo.transition(row.id, row.version, "attested", { recipient: who });
      }

      const before = await registerAndAttestTo(otherRecipient);
      await new Promise((r) => setTimeout(r, 5));
      const since = new Date(before.createdAt.getTime() + 1);

      const inWindowA = await registerAndAttestTo(recipient);
      const inWindowB = await registerAndAttestTo(recipient);
      await registerAndAttestTo(otherRecipient);

      expect(inWindowA.createdAt.getTime()).toBeGreaterThanOrEqual(since.getTime());
      expect(inWindowB.createdAt.getTime()).toBeGreaterThanOrEqual(since.getTime());

      expect(await repo.countByRecipientSince(recipient, since)).toBe(2);
      expect(await repo.countByRecipientSince(recipient, new Date(since.getTime() - 1))).toBe(2);
      expect(await repo.countByRecipientSince(recipient, new Date(Date.now() + 60_000))).toBe(0);
    });
  });
}
