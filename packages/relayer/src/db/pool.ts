import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool, type PoolConfig } from "pg";

/**
 * Finds the relayer package's root directory (the one containing package.json and db/schema.sql)
 * by walking up from `startDir`. NOT a fixed "go up N levels" path: this file runs at two genuinely
 * different depths relative to the package root — packages/relayer/src/db/ when run from source
 * (two levels below the root) vs. packages/relayer/dist/ when run as the bundled production build
 * tsup produces (one level below the root, since tsup flattens src/db/pool.ts's whole module tree
 * into a single dist/main.js). A hardcoded "../.." was wrong for the bundled case — this was only
 * caught by actually running `node dist/main.js` (via docker compose up) rather than trusting it
 * built cleanly; see the STEP 6 report. Walking up until package.json is found works at either depth
 * and stays correct if the bundler's output layout ever changes again.
 */
export function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `could not find the relayer package root (no package.json found walking up from ${startDir})`,
      );
    }
    dir = parent;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(findPackageRoot(here), "db", "schema.sql");

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
