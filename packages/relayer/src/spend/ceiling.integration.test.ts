import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { startTestPostgres, type TestPostgres } from "../repo/test-postgres.js";
import { PostgresSpendCeiling } from "./ceiling.js";

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

/** Fixed "now" so every test in this file reserves against the same UTC day. */
const NOW = () => new Date("2026-09-15T12:00:00.000Z");

describe("PostgresSpendCeiling.reserve: atomic check-and-increment under real concurrency", () => {
  it("sequential reservations: accepts up to the ceiling, rejects anything past it, and never overshoots", async () => {
    const ceiling = new PostgresSpendCeiling(db.pool, 100n, NOW);

    const first = await ceiling.reserve(60n);
    expect(first).toEqual({ reserved: true, spentAfter: 60n });

    const second = await ceiling.reserve(60n); // 60 + 60 = 120 > 100
    expect(second).toEqual({ reserved: false, spentAfter: 60n });
    expect(await ceiling.spentToday()).toBe(60n); // unchanged by the rejected attempt

    const third = await ceiling.reserve(40n); // exactly fills the remaining budget
    expect(third).toEqual({ reserved: true, spentAfter: 100n });

    const fourth = await ceiling.reserve(1n); // ceiling exhausted
    expect(fourth.reserved).toBe(false);
    expect(await ceiling.spentToday()).toBe(100n);
  });

  it(
    "REQUIRED test: two transfers become attested at the same instant, each individually eligible " +
      "under the cap but not together — only one is ever reserved, proven by firing genuinely " +
      "concurrent database connections (not timing/sleep tricks) at the same atomic operation",
    async () => {
      const ceilingStroops = 100n;
      const eachAmount = 60n; // 60 + 60 = 120 > 100: individually fine, together over the ceiling

      // Two independent PostgresSpendCeiling instances over two independent pool connections,
      // firing their reserve() calls with Promise.all so they race for real inside Postgres —
      // this is what actually exercises the row lock, not an artifact of one client's connection
      // ordering its own queries.
      const { Pool } = await import("pg");
      const poolA = new Pool(db.pool.options);
      const poolB = new Pool(db.pool.options);
      try {
        const ceilingA = new PostgresSpendCeiling(poolA, ceilingStroops, NOW);
        const ceilingB = new PostgresSpendCeiling(poolB, ceilingStroops, NOW);

        const [resultA, resultB] = await Promise.all([
          ceilingA.reserve(eachAmount),
          ceilingB.reserve(eachAmount),
        ]);

        const outcomes = [resultA, resultB];
        const reservedCount = outcomes.filter((r) => r.reserved).length;
        const rejectedCount = outcomes.filter((r) => !r.reserved).length;

        // The core assertion: exactly one of the two concurrent, individually-eligible reservations
        // actually landed. Not "probably one" — the atomic WHERE clause guarantees it every time.
        expect(reservedCount).toBe(1);
        expect(rejectedCount).toBe(1);

        // The ledger reflects exactly one reservation's worth of spend, never both (120) and never
        // neither (0).
        const finalCeiling = new PostgresSpendCeiling(db.pool, ceilingStroops, NOW);
        expect(await finalCeiling.spentToday()).toBe(eachAmount);
      } finally {
        await poolA.end();
        await poolB.end();
      }
    },
  );

  it("running the race 20 times never once double-reserves", async () => {
    const ceilingStroops = 100n;
    const eachAmount = 60n;
    const { Pool } = await import("pg");

    for (let trial = 0; trial < 20; trial += 1) {
      await db.truncateAll();
      const poolA = new Pool(db.pool.options);
      const poolB = new Pool(db.pool.options);
      try {
        const ceilingA = new PostgresSpendCeiling(poolA, ceilingStroops, NOW);
        const ceilingB = new PostgresSpendCeiling(poolB, ceilingStroops, NOW);
        const [a, b] = await Promise.all([
          ceilingA.reserve(eachAmount),
          ceilingB.reserve(eachAmount),
        ]);
        const reservedCount = [a, b].filter((r) => r.reserved).length;
        expect(reservedCount, `trial ${String(trial)}`).toBe(1);
      } finally {
        await poolA.end();
        await poolB.end();
      }
    }
  });

  it("release gives back exactly the reserved amount, and never underflows below zero", async () => {
    const ceiling = new PostgresSpendCeiling(db.pool, 100n, NOW);
    await ceiling.reserve(60n);
    await ceiling.release(60n);
    expect(await ceiling.spentToday()).toBe(0n);

    // A reservation is possible again for the full ceiling after release.
    const again = await ceiling.reserve(100n);
    expect(again).toEqual({ reserved: true, spentAfter: 100n });

    // Releasing more than was ever reserved floors at zero rather than going negative.
    await ceiling.release(1000n);
    expect(await ceiling.spentToday()).toBe(0n);
  });

  it("reservations on different UTC days do not interact", async () => {
    const day1 = new PostgresSpendCeiling(
      db.pool,
      100n,
      () => new Date("2026-09-15T23:59:00.000Z"),
    );
    const day2 = new PostgresSpendCeiling(
      db.pool,
      100n,
      () => new Date("2026-09-16T00:01:00.000Z"),
    );

    expect((await day1.reserve(100n)).reserved).toBe(true);
    // Same ceiling, next UTC day: fully available again.
    expect((await day2.reserve(100n)).reserved).toBe(true);
    expect(await day1.spentToday()).toBe(100n);
    expect(await day2.spentToday()).toBe(100n);
  });
});
