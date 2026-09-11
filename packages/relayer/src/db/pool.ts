import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool, type PoolConfig } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(here, "..", "..", "db", "schema.sql");

export function createPool(config: PoolConfig): Pool {
  return new Pool(config);
}

/**
 * Applies db/schema.sql. Idempotent: every DDL statement is CREATE ... IF NOT EXISTS, except the
 * enum type, which Postgres has no IF NOT EXISTS for — that one statement is guarded separately so
 * re-running this against an already-migrated database is safe (self-hosters run the relayer
 * against a fresh Postgres and this is the only "migration" step there is).
 */
export async function migrate(pool: Pool): Promise<void> {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const client = await pool.connect();
  try {
    const enumExists = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_status') AS exists`,
    );
    const sql = enumExists.rows[0]?.exists
      ? schema.replace(/CREATE TYPE transfer_status AS ENUM \([^;]*\);/, "")
      : schema;
    await client.query(sql);
  } finally {
    client.release();
  }
}
