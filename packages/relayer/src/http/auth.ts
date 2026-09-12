import { createHash } from "node:crypto";

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
 */
export interface ApiKeyStore {
  /** True if `keyHash` matches an active (non-revoked) row. */
  isActive(keyHash: string): Promise<boolean>;
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
