import { randomBytes } from "node:crypto";

import type { FastifyPluginCallbackZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import type { ApiKeyStore } from "../auth.js";
import { hashApiKey, requireAdminSecret } from "../auth.js";

export interface AdminApiKeysRouteOptions {
  readonly apiKeys: ApiKeyStore;
  readonly adminSecret: string;
}

const createBodySchema = z.object({
  label: z
    .string()
    .min(1, "label must not be empty")
    .max(200, "label must be at most 200 characters"),
});

const createResponseSchema = {
  201: z.object({
    apiKey: z.string(),
    keyHash: z.string(),
    label: z.string(),
  }),
};

const revokeParamsSchema = z.object({
  keyHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "keyHash must be a 64-character lowercase hex SHA-256 hash"),
});

const revokeResponseSchema = {
  204: z.undefined(),
};

/**
 * Admin-only routes for creating/revoking real integrator API keys — see admin-config.ts's own doc
 * comment for why FERRYLINE_ADMIN_SECRET is a genuinely separate, more sensitive credential from any
 * integrator key, and auth.ts's requireAdminSecret for why the two credential classes cannot be
 * confused by construction. Before these routes existed, the ONLY way to add or remove a row in
 * `api_keys` was a raw SQL statement run by hand against the database (see README.md's now-
 * superseded manual-INSERT instructions) — every real integrator's onboarding required direct
 * Postgres write access from whoever ran it. This does not change the MVP posture of the key store
 * itself (still no sessions, no scopes, no key-rotation UI, no integrator-facing self-signup — see
 * this route's own scope note below) — it only replaces "needs a database credential" with "needs
 * the admin secret" as the actual gate on who can mint a key.
 *
 * Deliberately NOT built here, matching the brief's own explicit scope: integrator-facing UI,
 * self-signup, key rotation, or any scopes/permissions beyond the binary admin/integrator split
 * `requireAdminSecret` vs. `requireApiKey` already gives. The caller of these routes is still an
 * operator (you, or your team) running a `curl` command once per new integrator, not the integrator
 * themselves — see README.md's own usage example.
 */
export const adminApiKeysRoute: FastifyPluginCallbackZod<AdminApiKeysRouteOptions> = (
  fastify,
  options,
  done,
) => {
  fastify.post(
    "/admin/api-keys",
    {
      preHandler: requireAdminSecret(options.adminSecret),
      schema: {
        body: createBodySchema,
        response: createResponseSchema,
      },
    },
    async (request, reply) => {
      // A real, cryptographically random 32-byte secret, hex-encoded — the same shape as the
      // manual-INSERT instructions this replaces recommended choosing by hand, generated instead
      // of relying on an operator to pick something sufficiently random themselves.
      const apiKey = randomBytes(32).toString("hex");
      const keyHash = hashApiKey(apiKey);
      // The plaintext key is computed above, returned once in the response below, and NEVER
      // written to a log, a database column, or anywhere else in this handler — only its hash
      // (via hashApiKey, the exact same function requireApiKey's own lookup uses) is persisted, so
      // this key can never be recovered again after this one response, the same one-time-reveal
      // guarantee every API provider with this design gives.
      await options.apiKeys.create(keyHash, request.body.label);
      await reply.code(201).send({ apiKey, keyHash, label: request.body.label });
    },
  );

  fastify.delete(
    "/admin/api-keys/:keyHash",
    {
      preHandler: requireAdminSecret(options.adminSecret),
      schema: {
        params: revokeParamsSchema,
        response: revokeResponseSchema,
      },
    },
    async (request, reply) => {
      // Idempotent by construction (see ApiKeyStore.revoke's own doc comment): revoking an already-
      // revoked or never-existent keyHash is not an error, the same "DELETE is idempotent" contract
      // most real HTTP APIs give. No 404 case to handle here as a result.
      await options.apiKeys.revoke(request.params.keyHash);
      await reply.code(204).send();
    },
  );

  done();
};
