import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Set by requireApiKey's preHandler once auth succeeds: the SHA-256 hash of the caller's bearer
     * token (never the raw key itself). Routes that need to key something off "which caller" — the
     * STEP 4 registration-time rate limit is the only current user — read this instead of
     * re-parsing the Authorization header or recomputing the hash themselves. Undefined on any
     * request that did not go through requireApiKey (e.g. GET /transfers/:id, which has no auth).
     */
    apiKeyHash?: string;
  }
}

/**
 * MVP bearer-token allow-list. Per the phase-3 sign-off, this is deliberately NOT a full auth
 * system: no sessions, no scopes, no key rotation UI — just enough to gate who the sponsor account
 * pays gas for. Keys are stored as a SHA-256 hash in the `api_keys` table (never plaintext); the
 * lookup itself is a straight indexed SELECT, and the comparison of the caller's hash against the
 * stored one is not a constant-time concern (we are comparing a hash of the presented secret against
 * hashes read from the database, not comparing secrets directly — see hashApiKey below).
 *
 * `create`/`revoke` back the admin-only POST/DELETE /admin/api-keys routes (see
 * http/routes/admin-api-keys.ts) — the ONLY way, before this, to add or remove a row here was a raw
 * SQL statement run by hand against the database (see README.md's now-superseded manual-INSERT
 * instructions). Still no scopes, no per-key rate-limit overrides, no rotation — genuinely minimal,
 * matching the same MVP posture this store already had; this just replaces "someone with direct
 * Postgres access" with "someone who holds the separate, more sensitive FERRYLINE_ADMIN_SECRET" as
 * the actual gate on who can mint a real, spend-capable integrator key.
 */
export interface ApiKeyStore {
  /** True if `keyHash` matches an active (non-revoked) row. */
  isActive(keyHash: string): Promise<boolean>;
  /** Inserts a new row. The caller (the admin route) generates the real random secret and computes
   *  `keyHash` via `hashApiKey` BEFORE calling this — this method only ever sees/stores the hash,
   *  never the plaintext, the same discipline the manual SQL instructions this replaces already
   *  had. */
  create(keyHash: string, label: string): Promise<void>;
  /** Sets `revoked_at` on an existing row, if one exists for `keyHash` — a no-op (not an error) if
   *  `keyHash` doesn't match any row, so DELETE is naturally idempotent. */
  revoke(keyHash: string): Promise<void>;
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export class PostgresApiKeyStore implements ApiKeyStore {
  constructor(private readonly pool: Pool) {}

  async isActive(keyHash: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL
       ) AS exists`,
      [keyHash],
    );
    return result.rows[0]?.exists ?? false;
  }

  async create(keyHash: string, label: string): Promise<void> {
    await this.pool.query(`INSERT INTO api_keys (key_hash, label) VALUES ($1, $2)`, [
      keyHash,
      label,
    ]);
  }

  async revoke(keyHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE api_keys SET revoked_at = now() WHERE key_hash = $1 AND revoked_at IS NULL`,
      [keyHash],
    );
  }
}

/** In-memory ApiKeyStore for tests: holds already-hashed keys. */
export class InMemoryApiKeyStore implements ApiKeyStore {
  private readonly active = new Set<string>();

  constructor(rawKeys: readonly string[] = []) {
    for (const key of rawKeys) {
      this.active.add(hashApiKey(key));
    }
  }

  addRawKey(rawKey: string): void {
    this.active.add(hashApiKey(rawKey));
  }

  revokeRawKey(rawKey: string): void {
    this.active.delete(hashApiKey(rawKey));
  }

  isActive(keyHash: string): Promise<boolean> {
    return Promise.resolve(this.active.has(keyHash));
  }

  create(keyHash: string, _label: string): Promise<void> {
    this.active.add(keyHash);
    return Promise.resolve();
  }

  revoke(keyHash: string): Promise<void> {
    this.active.delete(keyHash);
    return Promise.resolve();
  }
}

const BEARER_PREFIX = "Bearer ";

/**
 * Fastify preHandler: rejects with 401 unless `authorization: Bearer <key>` names an active key.
 * The secret itself is never compared directly: the caller's raw key is hashed and the hash is
 * looked up in the database, so there is no `===` on secret bytes for a timing side channel to
 * target in the first place.
 */
export function requireApiKey(store: ApiKeyStore) {
  return async function apiKeyPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      await reply
        .code(401)
        .send({ error: "missing or malformed Authorization: Bearer <key> header" });
      return;
    }
    const rawKey = header.slice(BEARER_PREFIX.length).trim();
    if (rawKey.length === 0) {
      await reply.code(401).send({ error: "empty bearer token" });
      return;
    }
    const keyHash = hashApiKey(rawKey);
    const active = await store.isActive(keyHash);
    if (!active) {
      await reply.code(401).send({ error: "invalid or revoked API key" });
      return;
    }
    request.apiKeyHash = keyHash;
  };
}

/**
 * Fastify preHandler for the admin-only /admin/api-keys routes — deliberately a SEPARATE function
 * from `requireApiKey` above, checking a SEPARATE credential (`FERRYLINE_ADMIN_SECRET`, loaded once
 * at startup via `loadAdminConfig` in ../admin-config.js — refuses to start if unset, same "no
 * silent fallback" discipline as every spend-related value, since this credential is genuinely more
 * sensitive: anyone holding it can mint unlimited real, spend-capable integrator keys, all sharing
 * the same sponsor account and daily spend ceiling).
 *
 * An integrator's own API key must NEVER authenticate here, and the admin secret must NEVER
 * authenticate `requireApiKey`'s routes — there is no shared code path between the two checks
 * (this function does not call `store.isActive` at all, and `requireApiKey` never reads
 * `adminSecret`), so the two credential classes cannot be confused by construction, not merely by
 * convention. Constant-time comparison (`timingSafeEqual`), unlike `requireApiKey`'s hash lookup
 * above: the admin secret is compared directly against the presented value (there is no hash-based
 * indirection here, since there is only ever one real admin secret, not a table of many), so a
 * naive `===` would be a real timing side channel for this specific comparison in a way it is not
 * for the hash-based integrator-key check.
 */
export function requireAdminSecret(adminSecret: string) {
  const expected = Buffer.from(adminSecret, "utf8");
  return async function adminSecretPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      await reply
        .code(401)
        .send({ error: "missing or malformed Authorization: Bearer <admin secret> header" });
      return;
    }
    const presented = Buffer.from(header.slice(BEARER_PREFIX.length).trim(), "utf8");
    // timingSafeEqual throws (does not return false) if the two buffers have different lengths —
    // a length mismatch is itself not a timing-sensitive fact worth hiding here (the real secret's
    // length is not a meaningful secret), so this is caught and treated as a plain rejection rather
    // than allowed to become an unhandled 500.
    const matches = presented.length === expected.length && timingSafeEqual(presented, expected);
    if (!matches) {
      await reply.code(401).send({ error: "invalid admin secret" });
      return;
    }
  };
}
