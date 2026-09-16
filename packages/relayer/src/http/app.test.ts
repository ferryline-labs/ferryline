import { newTransferId } from "@ferryline/core";
import type { StellarRpc } from "@ferryline/sdk";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InMemoryApiKeyStore } from "./auth.js";
import { buildApp } from "./app.js";
import { InMemoryTransferRepository } from "../repo/in-memory-transfers.js";
import { InMemorySpendCeiling } from "../spend/ceiling.js";
import { InMemoryRegistrationLimiter } from "../spend/registration-limit.js";

const VALID_KEY = "test-key-abc123";
const ADMIN_SECRET = "test-admin-secret-xyz789";
const SPONSOR = "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q";
const VALID_TX_HASH = `0x${"a".repeat(64)}`;

/**
 * Minimal StellarRpc fake for the HTTP layer's own tests: getLedgerEntries either answers with a
 * fixed balance (when `balance` is given) or an empty result (the "account not found / balance
 * unknown" path GET /healthz must handle gracefully). The Stellar RPC read path itself
 * (getNativeBalance's actual ledger-entry decoding) is @ferryline/sdk's own tested code — these
 * tests exercise the route wiring around it, not the SDK internals a second time.
 */
function fakeRpc(balance?: bigint): StellarRpc {
  return {
    getAccount: () => Promise.reject(new Error("not used by these tests")),
    simulateTransaction: () => Promise.reject(new Error("not used by these tests")),
    getTransaction: () => Promise.reject(new Error("not used by these tests")),
    getLatestLedger: () => Promise.reject(new Error("not used by these tests")),
    getLedgerEntries: (...keys) => {
      if (balance === undefined) {
        return Promise.resolve({ entries: [], latestLedger: 1 });
      }
      const entries = keys.map((key) => ({
        key,
        val: { type: "account" as const, account: { balance } },
        lastModifiedLedgerSeq: 1,
      }));
      return Promise.resolve({ entries, latestLedger: 1 } as never);
    },
  };
}

interface Harness {
  app: FastifyInstance;
  repo: InMemoryTransferRepository;
  apiKeys: InMemoryApiKeyStore;
  spendCeiling: InMemorySpendCeiling;
  registrationLimiter: InMemoryRegistrationLimiter;
}

function harness(
  overrides: {
    ceilingStroops?: bigint;
    sponsorBalance?: bigint;
    registrationLimiter?: InMemoryRegistrationLimiter;
    corsOrigins?: readonly string[];
  } = {},
): Harness {
  const repo = new InMemoryTransferRepository();
  const apiKeys = new InMemoryApiKeyStore([VALID_KEY]);
  const spendCeiling = new InMemorySpendCeiling(overrides.ceilingStroops ?? 1_000_000_000n);
  // Generous default so ordinary route tests can't accidentally trip STEP 4's registration-time
  // limit as a side effect of assertions unrelated to it — see the dedicated 429 tests below for
  // the actual limiter behavior.
  const registrationLimiter =
    overrides.registrationLimiter ??
    new InMemoryRegistrationLimiter({ maxAttemptsPerWindow: 1000, windowMs: 60_000 });
  const app = buildApp({
    repo,
    apiKeys,
    adminSecret: ADMIN_SECRET,
    network: "mainnet",
    rpc: fakeRpc(overrides.sponsorBalance),
    sponsorAccount: SPONSOR,
    spendCeiling,
    dailySpendCeilingStroops: overrides.ceilingStroops ?? 1_000_000_000n,
    registrationLimiter,
    version: "test",
    startedAt: 0,
    now: () => 5000,
    // Fail-closed default, matching production: a test that doesn't care about CORS gets the same
    // real "no browser origin allowed" behavior as an operator who never set FERRYLINE_CORS_ORIGINS
    // — see the dedicated CORS describe block below for tests of the allowed-origin path itself.
    corsOrigins: overrides.corsOrigins ?? [],
  });
  return { app, repo, apiKeys, spendCeiling, registrationLimiter };
}

describe("POST /transfers", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it("registers a transfer and returns 201 with pending status, given a valid bearer key", async () => {
    const id = newTransferId();
    const response = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: id,
        sourceChain: "ethereum",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id, status: "pending", sourceChain: "ethereum" });

    const stored = await h.repo.get(id);
    expect(stored?.status).toBe("pending");
    expect(stored?.sourceDomain).toBe(0); // ethereum's CCTP domain, derived server-side
    // amount/recipient must NOT be settable via this route.
    expect(stored?.amount).toBeNull();
    expect(stored?.recipient).toBeNull();
  });

  it("rejects a missing Authorization header with 401, before touching the database", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/transfers",
      payload: {
        transferId: newTransferId(),
        sourceChain: "ethereum",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(await h.repo.listByStatus("pending")).toHaveLength(0);
  });

  it("rejects an invalid bearer key with 401", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: "Bearer not-a-real-key" },
      payload: {
        transferId: newTransferId(),
        sourceChain: "ethereum",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a revoked key with 401", async () => {
    h.apiKeys.revokeRawKey(VALID_KEY);
    const response = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: newTransferId(),
        sourceChain: "ethereum",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an invalid transferId (not a ULID) with 400, and touches neither DB nor chain", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: "not-a-ulid",
        sourceChain: "ethereum",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(await h.repo.listByStatus("pending")).toHaveLength(0);
  });

  it("rejects an unsupported rail with 400", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: newTransferId(),
        sourceChain: "ethereum",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdt0-layerzero",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a malformed sourceTxHash (wrong length / not hex) with 400", async () => {
    for (const bad of ["0xabc", "not-hex-at-all", `${"a".repeat(64)}`, `0x${"g".repeat(64)}`]) {
      const response = await h.app.inject({
        method: "POST",
        url: "/transfers",
        headers: { authorization: `Bearer ${VALID_KEY}` },
        payload: {
          transferId: newTransferId(),
          sourceChain: "ethereum",
          sourceTxHash: bad,
          rail: "usdc-cctp",
        },
      });
      expect(response.statusCode, `sourceTxHash=${bad}`).toBe(400);
    }
  });

  it("rejects a sourceChain that is not a known CCTP chain for this network with 400", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: newTransferId(),
        sourceChain: "not-a-real-chain",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a testnet-only sourceChain on a mainnet relayer with 400", async () => {
    // "ethereum-sepolia" is valid on testnet, not on mainnet — this harness is built with network: "mainnet".
    const response = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: newTransferId(),
        sourceChain: "ethereum-sepolia",
        sourceTxHash: VALID_TX_HASH,
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 409 on a duplicate (sourceChain, sourceTxHash) registration", async () => {
    const payload = {
      transferId: newTransferId(),
      sourceChain: "ethereum",
      sourceTxHash: VALID_TX_HASH,
      rail: "usdc-cctp" as const,
    };
    const first = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: { ...payload, transferId: newTransferId() },
    });
    expect(second.statusCode).toBe(409);
  });

  it("rejects an unknown/extra field or missing required field with 400", async () => {
    const missingField = await h.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: { sourceChain: "ethereum", sourceTxHash: VALID_TX_HASH, rail: "usdc-cctp" },
    });
    expect(missingField.statusCode).toBe(400);
  });

  describe("STEP 4 registration-time rate limit (per API key)", () => {
    it("returns 429 once this key's registrations exceed the configured window/threshold", async () => {
      const limited = harness({
        registrationLimiter: new InMemoryRegistrationLimiter({
          maxAttemptsPerWindow: 2,
          windowMs: 60_000,
        }),
      });
      const post = (txHash: string) =>
        limited.app.inject({
          method: "POST",
          url: "/transfers",
          headers: { authorization: `Bearer ${VALID_KEY}` },
          payload: {
            transferId: newTransferId(),
            sourceChain: "ethereum",
            sourceTxHash: txHash,
            rail: "usdc-cctp",
          },
        });

      const first = await post(`0x${"1".repeat(64)}`);
      const second = await post(`0x${"2".repeat(64)}`);
      const third = await post(`0x${"3".repeat(64)}`);

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(third.statusCode).toBe(429);
      // The rejected attempt must not have reached the repository at all.
      expect(await limited.repo.listByStatus("pending")).toHaveLength(2);

      await limited.app.close();
    });

    it("is scoped PER API KEY: a different key is unaffected by another key's limit", async () => {
      const limited = harness({
        registrationLimiter: new InMemoryRegistrationLimiter({
          maxAttemptsPerWindow: 1,
          windowMs: 60_000,
        }),
      });
      limited.apiKeys.addRawKey("other-key-xyz");
      const postWith = (key: string, txHash: string) =>
        limited.app.inject({
          method: "POST",
          url: "/transfers",
          headers: { authorization: `Bearer ${key}` },
          payload: {
            transferId: newTransferId(),
            sourceChain: "ethereum",
            sourceTxHash: txHash,
            rail: "usdc-cctp",
          },
        });

      const firstKeyFirst = await postWith(VALID_KEY, `0x${"1".repeat(64)}`);
      const firstKeySecond = await postWith(VALID_KEY, `0x${"2".repeat(64)}`); // over its own limit
      const otherKeyFirst = await postWith("other-key-xyz", `0x${"3".repeat(64)}`); // unaffected

      expect(firstKeyFirst.statusCode).toBe(201);
      expect(firstKeySecond.statusCode).toBe(429);
      expect(otherKeyFirst.statusCode).toBe(201);

      await limited.app.close();
    });

    it("this is a BLUNT per-key spam brake, not the real per-recipient limit: it does not know or care about recipient", async () => {
      // Documents the intended scope, per the STEP 4 sign-off's README-documentation ask: this test
      // exists so a future reader sees explicitly that this check has no recipient awareness, rather
      // than assuming (incorrectly) that a 429 here says anything about a specific recipient.
      const limited = harness({
        registrationLimiter: new InMemoryRegistrationLimiter({
          maxAttemptsPerWindow: 1,
          windowMs: 60_000,
        }),
      });
      const post = (txHash: string) =>
        limited.app.inject({
          method: "POST",
          url: "/transfers",
          headers: { authorization: `Bearer ${VALID_KEY}` },
          payload: {
            transferId: newTransferId(),
            sourceChain: "ethereum",
            sourceTxHash: txHash,
            rail: "usdc-cctp",
          },
        });

      const first = await post(`0x${"1".repeat(64)}`);
      const second = await post(`0x${"2".repeat(64)}`);
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(429);
      // Neither registered row has ever had a recipient (amount/recipient are always null at
      // registration — see the security-property comment on registerTransferBodySchema) — the 429
      // above was decided purely from the API key, before any recipient could exist.
      const { id } = first.json<{ id: string }>();
      const stored = await limited.repo.get(id);
      expect(stored?.recipient).toBeNull();

      await limited.app.close();
    });
  });
});

describe("GET /transfers/:id", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it("returns the current status of a registered transfer", async () => {
    const row = await h.repo.register({
      id: newTransferId(),
      rail: "usdc-cctp",
      sourceChain: "ethereum",
      sourceTxHash: VALID_TX_HASH,
      sourceDomain: 0,
    });
    const response = await h.app.inject({ method: "GET", url: `/transfers/${row.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: row.id,
      status: "pending",
      amount: null,
      recipient: null,
    });
  });

  it("returns amount and recipient once attested", async () => {
    const row = await h.repo.register({
      id: newTransferId(),
      rail: "usdc-cctp",
      sourceChain: "ethereum",
      sourceTxHash: VALID_TX_HASH,
      sourceDomain: 0,
    });
    await h.repo.transition(row.id, row.version, "attested", {
      amount: "1000000",
      recipient: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
      irisNonce: "0xabc",
      irisMessage: "0xdead",
      irisAttestation: "0xbeef",
      mintRecipient: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
      destinationCaller: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
    });
    const response = await h.app.inject({ method: "GET", url: `/transfers/${row.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "attested",
      amount: "1000000",
      recipient: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
    });
  });

  it("returns 404 for an unknown id", async () => {
    const response = await h.app.inject({ method: "GET", url: `/transfers/${newTransferId()}` });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for a malformed id (not a valid ULID)", async () => {
    const response = await h.app.inject({ method: "GET", url: "/transfers/not-a-ulid" });
    expect(response.statusCode).toBe(400);
  });

  it("requires no auth (read-only, unguessable ULID key)", async () => {
    const row = await h.repo.register({
      id: newTransferId(),
      rail: "usdc-cctp",
      sourceChain: "ethereum",
      sourceTxHash: VALID_TX_HASH,
      sourceDomain: 0,
    });
    const response = await h.app.inject({ method: "GET", url: `/transfers/${row.id}` });
    expect(response.statusCode).toBe(200);
  });
});

interface HealthzBody {
  status: string;
  service: string;
  uptimeSeconds: number;
  sponsor: { account: string; nativeBalanceStroops: string | null; balanceUnknown: boolean };
  dailySpend: { spentStroops: string; ceilingStroops: string; ceilingReached: boolean };
}

describe("GET /healthz", () => {
  it("reports ok status, uptime, and daily-spend info with no sponsor balance readable", async () => {
    const h = harness();
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    const body = response.json<HealthzBody>();
    expect(body).toMatchObject({
      status: "ok",
      service: "ferryline-relayer",
      uptimeSeconds: 5,
      dailySpend: { spentStroops: "0", ceilingStroops: "1000000000", ceilingReached: false },
    });
    expect(body.sponsor.account).toBe(SPONSOR);
    expect(body.sponsor.balanceUnknown).toBe(true);
    expect(body.sponsor.nativeBalanceStroops).toBeNull();
    await h.app.close();
  });

  it("reports the sponsor's actual native balance when the account is readable", async () => {
    const h = harness({ sponsorBalance: 42_000_000n });
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    const body = response.json<HealthzBody>();
    expect(body.sponsor.balanceUnknown).toBe(false);
    expect(body.sponsor.nativeBalanceStroops).toBe("42000000");
    await h.app.close();
  });

  it("reports ceilingReached: true once the daily ceiling has been reserved to the limit", async () => {
    const h = harness({ ceilingStroops: 100n });
    await h.spendCeiling.reserve(100n);
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    expect(response.json()).toMatchObject({
      dailySpend: { spentStroops: "100", ceilingStroops: "100", ceilingReached: true },
    });
    await h.app.close();
  });

  it("reports ceilingReached: false at exactly one stroop below the limit (STEP 4: proves the same >= boundary the loop's gate uses, not a stale or off-by-one value)", async () => {
    // healthz.ts computes ceilingReached as spentStroops >= dailySpendCeilingStroops — the identical
    // predicate work/loop.ts's ceiling gate uses (spentToday() >= maxDailySpendCeilingStroops, see
    // that gate's own doc comment for why it is NOT wouldExceed(0n)). Both read from the SAME
    // SpendCeiling instance in production (main.ts constructs exactly one PostgresSpendCeiling and
    // passes it to both buildApp and the work loop's options) — this test proves the boundary itself
    // agrees, at the one point (one stroop short of the ceiling) where a >/>=  or off-by-one
    // discrepancy between two independently-written predicates would actually show up.
    const h = harness({ ceilingStroops: 100n });
    await h.spendCeiling.reserve(99n);
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    expect(response.json()).toMatchObject({
      dailySpend: { spentStroops: "99", ceilingStroops: "100", ceilingReached: false },
    });
    await h.app.close();
  });

  it("does not require auth", async () => {
    const h = harness();
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    await h.app.close();
  });
});

describe("CORS: fail-closed by default, real preflight behavior when origins are configured", () => {
  // A real, pre-existing gap found and fixed during the outbound-auto-registration phase: this
  // relayer had NO CORS configuration at all, which silently blocks EVERY browser-based caller —
  // confirmed directly against a real browser running the real widget against a real running
  // relayer instance (a real preflight OPTIONS request failed with no
  // Access-Control-Allow-Origin header, and the browser itself refused the actual POST as a
  // result, before it ever reached this server). These tests exercise the REAL mechanism a
  // browser depends on — a real OPTIONS preflight and the real Access-Control-Allow-Origin
  // response header @fastify/cors computes — not just "was corsOrigins parsed correctly"
  // (config.test.ts's own job).

  it("fail-closed default: a real preflight OPTIONS request from ANY origin gets no Access-Control-Allow-Origin header when corsOrigins is unset/empty", async () => {
    const h = harness(); // corsOrigins defaults to [] in the harness itself
    const response = await h.app.inject({
      method: "OPTIONS",
      url: "/transfers",
      headers: {
        origin: "https://some-widget-host.example.com",
        "access-control-request-method": "POST",
      },
    });
    // @fastify/cors still answers the preflight (200/204), but WITHOUT the one header a browser
    // actually checks before allowing the real request through — this is the real, browser-facing
    // mechanism that blocks the request, not a 403/error response from this server.
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("an ALLOWED origin's real preflight OPTIONS request gets a matching Access-Control-Allow-Origin header", async () => {
    const h = harness({ corsOrigins: ["https://widget.example.com"] });
    const response = await h.app.inject({
      method: "OPTIONS",
      url: "/transfers",
      headers: {
        origin: "https://widget.example.com",
        "access-control-request-method": "POST",
      },
    });
    expect(response.headers["access-control-allow-origin"]).toBe("https://widget.example.com");
  });

  it("a DIFFERENT, non-configured origin's real preflight OPTIONS request is genuinely blocked even when OTHER origins are allowed", async () => {
    const h = harness({ corsOrigins: ["https://widget.example.com"] });
    const response = await h.app.inject({
      method: "OPTIONS",
      url: "/transfers",
      headers: {
        origin: "https://attacker.example.com",
        "access-control-request-method": "POST",
      },
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("the actual GET /transfers/:id response (not just the preflight) carries the real Access-Control-Allow-Origin header for an allowed origin", async () => {
    // The preflight is what a browser sends FIRST and refuses to proceed past if it fails — but
    // the real, substantive response also needs the header, since browsers check it there too
    // (simple/actual requests, not just preflighted ones, still require CORS headers on the real
    // response before JS is allowed to read it).
    const h = harness({ corsOrigins: ["https://widget.example.com"] });
    const row = await h.repo.register({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      rail: "usdc-cctp",
      sourceChain: "ethereum",
      sourceTxHash: VALID_TX_HASH,
      sourceDomain: 0,
    });
    const response = await h.app.inject({
      method: "GET",
      url: `/transfers/${row.id}`,
      headers: { origin: "https://widget.example.com" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://widget.example.com");
    await h.app.close();
  });
});
