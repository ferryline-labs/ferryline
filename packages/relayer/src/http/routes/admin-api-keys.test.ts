import { newTransferId } from "@ferryline/core";
import type { StellarRpc } from "@ferryline/sdk";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { InMemoryApiKeyStore } from "../auth.js";
import { InMemoryTransferRepository } from "../../repo/in-memory-transfers.js";
import { InMemorySpendCeiling } from "../../spend/ceiling.js";
import { InMemoryRegistrationLimiter } from "../../spend/registration-limit.js";

const ADMIN_SECRET = "the-real-admin-secret-abc123";
const SEED_INTEGRATOR_KEY = "a-pre-existing-integrator-key";
const SPONSOR = "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q";
const VALID_TX_HASH = `0x${"a".repeat(64)}`;

/** Matches POST /admin/api-keys's real response schema (admin-api-keys.ts's createResponseSchema)
 *  — kept as a plain local type, not imported from the route module, since the route intentionally
 *  keeps its zod schema private to that file. */
interface CreateKeyResponseBody {
  readonly apiKey: string;
  readonly keyHash: string;
  readonly label: string;
}

function fakeRpc(): StellarRpc {
  return {
    getAccount: () => Promise.reject(new Error("not used by these tests")),
    simulateTransaction: () => Promise.reject(new Error("not used by these tests")),
    getTransaction: () => Promise.reject(new Error("not used by these tests")),
    getLatestLedger: () => Promise.reject(new Error("not used by these tests")),
    getLedgerEntries: () => Promise.resolve({ entries: [], latestLedger: 1 }),
  };
}

interface Harness {
  app: FastifyInstance;
  apiKeys: InMemoryApiKeyStore;
}

function harness(): Harness {
  const apiKeys = new InMemoryApiKeyStore([SEED_INTEGRATOR_KEY]);
  const app = buildApp({
    repo: new InMemoryTransferRepository(),
    apiKeys,
    adminSecret: ADMIN_SECRET,
    network: "mainnet",
    rpc: fakeRpc(),
    sponsorAccount: SPONSOR,
    spendCeiling: new InMemorySpendCeiling(1_000_000_000n),
    dailySpendCeilingStroops: 1_000_000_000n,
    registrationLimiter: new InMemoryRegistrationLimiter({
      maxAttemptsPerWindow: 1000,
      windowMs: 60_000,
    }),
    version: "test",
    startedAt: 0,
    now: () => 5000,
  });
  return { app, apiKeys };
}

describe("POST /admin/api-keys", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(async () => {
    await h.app.close();
  });

  /**
   * The real, load-bearing proof this route exists to provide: a key created here must be a REAL,
   * USABLE integrator key — not just "the endpoint returned 201," but "the exact plaintext this
   * response returned genuinely authenticates a real integrator-only route afterward," proving the
   * hash round-trips correctly through hashApiKey on both the write side (this route) and the read
   * side (requireApiKey's own lookup, exercised for real via POST /transfers below).
   */
  it("creates a real, usable API key — round-trips through a real integrator-only endpoint", async () => {
    const createResponse = await h.app.inject({
      method: "POST",
      url: "/admin/api-keys",
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
      payload: { label: "acme-corp-integration" },
    });

    expect(createResponse.statusCode).toBe(201);
    const body = createResponse.json<CreateKeyResponseBody>();
    expect(body.label).toBe("acme-corp-integration");
    expect(body.apiKey).toMatch(/^[0-9a-f]{64}$/); // 32 real random bytes, hex-encoded
    expect(body.keyHash).toMatch(/^[0-9a-f]{64}$/); // a real SHA-256 hash, hex-encoded
    // The plaintext and its hash must genuinely differ — a trivial but real sanity check that the
    // route isn't accidentally returning the same value twice under two field names.
    expect(body.apiKey).not.toBe(body.keyHash);

    // The real proof: use the freshly-returned PLAINTEXT key (not the seed key, not the hash) to
    // call a real integrator-only route. This only succeeds if hashApiKey(body.apiKey) — computed
    // independently here by requireApiKey's own preHandler — equals body.keyHash, the value this
    // route persisted via ApiKeyStore.create. A hash mismatch anywhere in that chain would show up
    // here as a 401, not as a passing test with an untested assumption.
    const transferId = newTransferId();
    const registerResponse = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${body.apiKey}` },
      payload: {
        transferId,
        sourceChain: "ethereum",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdc-cctp",
      },
    });
    expect(registerResponse.statusCode).toBe(201);
    expect(registerResponse.json()).toMatchObject({ id: transferId, status: "pending" });
  });

  it("rejects with 401 when called with a real integrator API key instead of the admin secret", async () => {
    // The exact credential-confusion this route must never allow: SEED_INTEGRATOR_KEY is a real,
    // active, valid integrator key (it successfully authenticates POST /transfers, confirmed by
    // the "creates a real, usable API key" test's own pattern) — it must NOT also work here.
    const response = await h.app.inject({
      method: "POST",
      url: "/admin/api-keys",
      headers: { authorization: `Bearer ${SEED_INTEGRATOR_KEY}` },
      payload: { label: "should-not-be-created" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "invalid admin secret" });
  });

  it("rejects with 401 when no Authorization header is present", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/admin/api-keys",
      payload: { label: "should-not-be-created" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects with 401 when the admin secret is present but wrong", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/admin/api-keys",
      headers: { authorization: "Bearer definitely-not-the-real-admin-secret" },
      payload: { label: "should-not-be-created" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "invalid admin secret" });
  });

  it("rejects a request with an empty label with 400, before ever reaching the handler", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/admin/api-keys",
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
      payload: { label: "" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("DELETE /admin/api-keys/:keyHash", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it("revoking a real, freshly-created key genuinely stops it from authenticating on the next real request", async () => {
    const createResponse = await h.app.inject({
      method: "POST",
      url: "/admin/api-keys",
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
      payload: { label: "to-be-revoked" },
    });
    const { apiKey, keyHash } = createResponse.json<CreateKeyResponseBody>();

    // Confirm it genuinely works BEFORE revocation — otherwise "revoking makes it stop working"
    // would be unfalsifiable (it could have never worked at all).
    const beforeRevoke = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        transferId: newTransferId(),
        sourceChain: "ethereum",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdc-cctp",
      },
    });
    expect(beforeRevoke.statusCode).toBe(201);

    const revokeResponse = await h.app.inject({
      method: "DELETE",
      url: `/admin/api-keys/${keyHash}`,
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    expect(revokeResponse.statusCode).toBe(204);

    // The real, load-bearing assertion: the SAME plaintext key, on a genuinely NEW request, is now
    // rejected — proves requireApiKey's own isActive check (which already reads revoked_at IS NULL
    // for the real Postgres store) actually observes the revocation, not just that revoke() ran
    // without throwing.
    const afterRevoke = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        transferId: newTransferId(),
        sourceChain: "ethereum",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdc-cctp",
      },
    });
    expect(afterRevoke.statusCode).toBe(401);
    expect(afterRevoke.json()).toMatchObject({ error: "invalid or revoked API key" });
  });

  it("rejects with 401 when called with a real integrator API key instead of the admin secret", async () => {
    const response = await h.app.inject({
      method: "DELETE",
      url: `/admin/api-keys/${"a".repeat(64)}`,
      headers: { authorization: `Bearer ${SEED_INTEGRATOR_KEY}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "invalid admin secret" });
  });

  it("is idempotent: revoking a keyHash that doesn't match any real row still returns 204, not an error", async () => {
    const response = await h.app.inject({
      method: "DELETE",
      url: `/admin/api-keys/${"f".repeat(64)}`,
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    expect(response.statusCode).toBe(204);
  });

  it("rejects a malformed keyHash param with 400, before ever reaching the handler", async () => {
    const response = await h.app.inject({
      method: "DELETE",
      url: "/admin/api-keys/not-a-real-hex-hash",
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    expect(response.statusCode).toBe(400);
  });
});
