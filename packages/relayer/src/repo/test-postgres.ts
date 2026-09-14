import { Pool } from "pg";
import { GenericContainer, type StartedTestContainer } from "testcontainers";

import { migrate } from "../db/pool.js";

/** One ephemeral Postgres container, shared by every test in a describe block via beforeAll/afterAll. */
export interface TestPostgres {
  readonly pool: Pool;
  truncateAll(): Promise<void>;
  stop(): Promise<void>;
}

export async function startTestPostgres(): Promise<TestPostgres> {
  const container: StartedTestContainer = await new GenericContainer("postgres:17-alpine")
    .withEnvironment({ POSTGRES_PASSWORD: "ferryline-test", POSTGRES_DB: "ferryline" })
    .withExposedPorts(5432)
    .start();

  const pool = new Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: "postgres",
    password: "ferryline-test",
    database: "ferryline",
  });

  // Postgres inside the container can accept TCP connections slightly before it is ready to serve
  // queries during the very first boot; retry briefly rather than racing it.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (error) {
      if (attempt >= 10) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  await migrate(pool);

  return {
    pool,
    async truncateAll() {
      // Real, pre-existing gap found and fixed while adding the outbound tables below: this list
      // was missing spend_ledger_events and registration_attempts (both real tables in
      // db/schema.sql since STEP 4/5 of the inbound relayer) — a test relying on truncateAll()
      // between cases could have seen stale rows from an earlier test in either table. Listed here
      // in full, in schema.sql's own order, rather than left to accumulate a second gap.
      await pool.query(
        "TRUNCATE TABLE transfers, spend_attempts, spend_ledger_events, daily_spend, api_keys, " +
          "registration_attempts, outbound_transfers, outbound_spend_attempts, " +
          "outbound_spend_ledger_events, outbound_daily_spend RESTART IDENTITY",
      );
    },
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
