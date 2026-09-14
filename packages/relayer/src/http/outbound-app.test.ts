import { newTransferId } from "@ferryline/core";
import type { StellarRpc } from "@ferryline/sdk";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InMemoryApiKeyStore } from "./auth.js";
import { buildApp } from "./app.js";
import { FakeRelayerEvmRpc } from "../chain/fake-evm-rpc.test-support.js";
import { InMemoryOutboundTransferRepository } from "../repo/in-memory-outbound-transfers.js";
import { InMemoryTransferRepository } from "../repo/in-memory-transfers.js";
import { InMemorySpendCeiling } from "../spend/ceiling.js";
import { InMemoryOutboundSpendCeiling } from "../spend/outbound-ceiling.js";
import { InMemoryRegistrationLimiter } from "../spend/registration-limit.js";

/**
 * STEP 4: HTTP API for the outbound direction — POST/GET /outbound-transfers and the outbound
 * section of GET /healthz. Mirrors app.test.ts's own harness/test structure exactly, adapted for
 * outbound's Stellar-source-tx-hash / EVM-recipient shape. Inbound's own app.test.ts is untouched
 * and unaffected — buildApp's `outbound` option is optional, so every existing inbound-only test
 * keeps building an app with no outbound routes registered at all (see the "outbound routes are
 * absent" test below, which proves that directly).
 */

const VALID_KEY = "test-key-abc123";
const SPONSOR = "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q";
const EVM_SPONSOR: `0x${string}` = `0x${"7".repeat(40)}`;
const STELLAR_TX_HASH = "a".repeat(64);
const RECIPIENT: `0x${string}` = `0x${"b".repeat(40)}`;

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
  repo: InMemoryTransferRepository;
  outboundRepo: InMemoryOutboundTransferRepository;
  apiKeys: InMemoryApiKeyStore;
  outboundEvmRpc: FakeRelayerEvmRpc;
  outboundSpendCeiling: InMemoryOutboundSpendCeiling;
}

function harness(
  overrides: {
    includeOutbound?: boolean;
    outboundCeilingWei?: bigint;
    registrationLimiter?: InMemoryRegistrationLimiter;
  } = {},
): Harness {
  const repo = new InMemoryTransferRepository();
  const outboundRepo = new InMemoryOutboundTransferRepository();
  const apiKeys = new InMemoryApiKeyStore([VALID_KEY]);
  const spendCeiling = new InMemorySpendCeiling(1_000_000_000n);
  const registrationLimiter =
    overrides.registrationLimiter ??
    new InMemoryRegistrationLimiter({ maxAttemptsPerWindow: 1000, windowMs: 60_000 });
  const outboundCeilingWei = overrides.outboundCeilingWei ?? 1_000_000_000_000_000_000n;
  const outboundSpendCeiling = new InMemoryOutboundSpendCeiling(outboundCeilingWei);
  const outboundEvmRpc = new FakeRelayerEvmRpc(new Map());
  const includeOutbound = overrides.includeOutbound ?? true;

  const app = buildApp({
    repo,
    apiKeys,
    network: "testnet",
    rpc: fakeRpc(),
    sponsorAccount: SPONSOR,
    spendCeiling,
    dailySpendCeilingStroops: 1_000_000_000n,
    registrationLimiter,
    version: "test",
    startedAt: 0,
    now: () => 5000,
    ...(includeOutbound
      ? {
          outbound: {
            repo: outboundRepo,
            registrationLimiter,
            healthz: {
              rpc: outboundEvmRpc,
              sponsorAddress: EVM_SPONSOR,
              destinationChain: "ethereum-sepolia",
              spendCeiling: outboundSpendCeiling,
              dailyGasCeilingWei: outboundCeilingWei,
            },
          },
        }
      : {}),
  });
  return { app, repo, outboundRepo, apiKeys, outboundEvmRpc, outboundSpendCeiling };
}

describe("POST /outbound-transfers", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it("registers an outbound transfer and returns 201 with pending status", async () => {
    const id = newTransferId();
    const response = await h.app.inject({
      method: "POST",
      url: "/outbound-transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: id,
        sourceTxHash: STELLAR_TX_HASH,
        destinationChain: "ethereum-sepolia",
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id,
      status: "pending",
      sourceChain: "stellar",
      sourceTxHash: STELLAR_TX_HASH,
      destinationChain: "ethereum-sepolia",
    });

    const stored = await h.outboundRepo.get(id);
    expect(stored?.status).toBe("pending");
    expect(stored?.sourceDomain).toBe(27); // Stellar's own CCTP domain, derived server-side
    // amount/recipient must NOT be settable via this route.
    expect(stored?.amount).toBeNull();
    expect(stored?.recipient).toBeNull();
  });

  it("rejects a missing Authorization header with 401, before touching the repository", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/outbound-transfers",
      payload: {
        transferId: newTransferId(),
        sourceTxHash: STELLAR_TX_HASH,
        destinationChain: "ethereum-sepolia",
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(await h.outboundRepo.listByStatus("pending")).toHaveLength(0);
  });

  it("rejects a malformed sourceTxHash (EVM-shaped 0x hash, wrong length, or uppercase hex) with 400", async () => {
    for (const bad of [`0x${"a".repeat(64)}`, "abc", "A".repeat(64), `${"a".repeat(63)}`]) {
      const response = await h.app.inject({
        method: "POST",
        url: "/outbound-transfers",
        headers: { authorization: `Bearer ${VALID_KEY}` },
        payload: {
          transferId: newTransferId(),
          sourceTxHash: bad,
          destinationChain: "ethereum-sepolia",
          rail: "usdc-cctp",
        },
      });
      expect(response.statusCode, `sourceTxHash=${bad}`).toBe(400);
    }
  });

  it("rejects a destinationChain that is not a known CCTP EVM chain for this network with 400", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/outbound-transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: newTransferId(),
        sourceTxHash: STELLAR_TX_HASH,
        destinationChain: "not-a-real-chain",
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a mainnet-only destinationChain on a testnet relayer with 400", async () => {
    // "ethereum" is valid on mainnet, not on testnet — this harness is built with network: "testnet".
    const response = await h.app.inject({
      method: "POST",
      url: "/outbound-transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: newTransferId(),
        sourceTxHash: STELLAR_TX_HASH,
        destinationChain: "ethereum",
        rail: "usdc-cctp",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an unsupported rail with 400", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/outbound-transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: newTransferId(),
        sourceTxHash: STELLAR_TX_HASH,
        destinationChain: "ethereum-sepolia",
        rail: "usdt0-layerzero",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 409 on a duplicate sourceTxHash registration", async () => {
    const payload = {
      transferId: newTransferId(),
      sourceTxHash: STELLAR_TX_HASH,
      destinationChain: "ethereum-sepolia",
      rail: "usdc-cctp" as const,
    };
    const first = await h.app.inject({
      method: "POST",
      url: "/outbound-transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await h.app.inject({
      method: "POST",
      url: "/outbound-transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: { ...payload, transferId: newTransferId() },
    });
    expect(second.statusCode).toBe(409);
  });

  it("shares the registration-time rate limiter with the inbound route (same API key, same table)", async () => {
    const limited = harness({
      registrationLimiter: new InMemoryRegistrationLimiter({
        maxAttemptsPerWindow: 1,
        windowMs: 60_000,
      }),
    });
    const inboundFirst = await limited.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: newTransferId(),
        sourceChain: "ethereum-sepolia",
        sourceTxHash: `0x${"1".repeat(64)}`,
        rail: "usdc-cctp",
      },
    });
    // Inbound registration consumes this key's shared limit...
    expect(inboundFirst.statusCode).toBe(201);

    const outboundSecond = await limited.app.inject({
      method: "POST",
      url: "/outbound-transfers",
      headers: { authorization: `Bearer ${VALID_KEY}` },
      payload: {
        transferId: newTransferId(),
        sourceTxHash: STELLAR_TX_HASH,
        destinationChain: "ethereum-sepolia",
        rail: "usdc-cctp",
      },
    });
    // ...so the very next outbound attempt from the SAME key is already over the shared limit.
    expect(outboundSecond.statusCode).toBe(429);

    await limited.app.close();
  });
});

describe("GET /outbound-transfers/:id", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it("returns the current status of a registered outbound transfer", async () => {
    const row = await h.outboundRepo.register({
      id: newTransferId(),
      rail: "usdc-cctp",
      sourceTxHash: STELLAR_TX_HASH,
      sourceDomain: 27,
      destinationChain: "ethereum-sepolia",
    });
    const response = await h.app.inject({ method: "GET", url: `/outbound-transfers/${row.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: row.id,
      status: "pending",
      sourceChain: "stellar",
      amount: null,
      recipient: null,
    });
  });

  it("returns amount and recipient once attested", async () => {
    const row = await h.outboundRepo.register({
      id: newTransferId(),
      rail: "usdc-cctp",
      sourceTxHash: STELLAR_TX_HASH,
      sourceDomain: 27,
      destinationChain: "ethereum-sepolia",
    });
    await h.outboundRepo.transition(row.id, row.version, "attested", {
      amount: "1000000",
      recipient: RECIPIENT,
      irisNonce: "0xabc",
      irisMessage: "0xdead",
      irisAttestation: "0xbeef",
    });
    const response = await h.app.inject({ method: "GET", url: `/outbound-transfers/${row.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "attested",
      amount: "1000000",
      recipient: RECIPIENT,
    });
  });

  it("returns 404 for an unknown id", async () => {
    const response = await h.app.inject({
      method: "GET",
      url: `/outbound-transfers/${newTransferId()}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for a malformed id (not a valid ULID)", async () => {
    const response = await h.app.inject({ method: "GET", url: "/outbound-transfers/not-a-ulid" });
    expect(response.statusCode).toBe(400);
  });

  it("requires no auth (read-only, unguessable ULID key)", async () => {
    const row = await h.outboundRepo.register({
      id: newTransferId(),
      rail: "usdc-cctp",
      sourceTxHash: STELLAR_TX_HASH,
      sourceDomain: 27,
      destinationChain: "ethereum-sepolia",
    });
    const response = await h.app.inject({ method: "GET", url: `/outbound-transfers/${row.id}` });
    expect(response.statusCode).toBe(200);
  });
});

describe("GET /healthz — outbound extension (STEP 4: extends the existing route, not a parallel one)", () => {
  it("omits the outbound field entirely when the process has no outbound direction configured", async () => {
    const h = harness({ includeOutbound: false });
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("outbound");
    await h.app.close();
  });

  it("reports outbound sponsor balance and daily ceiling status when outbound is configured", async () => {
    const h = harness();
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      outbound: {
        destinationChain: string;
        sponsor: { address: string; nativeBalanceWei: string | null; balanceUnknown: boolean };
        dailySpend: { spentWei: string; ceilingWei: string; ceilingReached: boolean };
      };
    }>();
    expect(body.outbound).toMatchObject({
      destinationChain: "ethereum-sepolia",
      sponsor: {
        address: EVM_SPONSOR,
        nativeBalanceWei: "1000000000000000000",
        balanceUnknown: false,
      },
      dailySpend: {
        spentWei: "0",
        ceilingWei: "1000000000000000000",
        ceilingReached: false,
      },
    });
    await h.app.close();
  });

  it("reports balanceUnknown: true when the EVM RPC balance read fails", async () => {
    const h = harness();
    h.outboundEvmRpc.nextGetBalanceShouldFail = true;
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    const body = response.json<{
      outbound: { sponsor: { nativeBalanceWei: string | null; balanceUnknown: boolean } };
    }>();
    expect(body.outbound.sponsor.balanceUnknown).toBe(true);
    expect(body.outbound.sponsor.nativeBalanceWei).toBeNull();
    await h.app.close();
  });

  it("reports outbound ceilingReached: true once the outbound daily ceiling is fully reserved", async () => {
    const h = harness({ outboundCeilingWei: 100n });
    await h.outboundSpendCeiling.reserve("ethereum-sepolia", 100n);
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    const body = response.json<{
      outbound: { dailySpend: { spentWei: string; ceilingWei: string; ceilingReached: boolean } };
    }>();
    expect(body.outbound.dailySpend).toEqual({
      spentWei: "100",
      ceilingWei: "100",
      ceilingReached: true,
    });
    await h.app.close();
  });

  it("inbound-direction reporting is unaffected by outbound being configured", async () => {
    const h = harness();
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    const body = response.json<{
      sponsor: { account: string };
      dailySpend: { spentStroops: string };
    }>();
    expect(body.sponsor.account).toBe(SPONSOR);
    expect(body.dailySpend.spentStroops).toBe("0");
    await h.app.close();
  });
});
