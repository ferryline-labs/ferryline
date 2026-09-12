import { cctpEvmChain, type CctpNetwork } from "@ferryline/sdk";
import type { FastifyPluginCallbackZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import type { ApiKeyStore } from "../auth.js";
import { requireApiKey } from "../auth.js";
import { DuplicateTransferError } from "../../repo/types.js";
import type { TransferRepository } from "../../repo/types.js";
import type { RegistrationLimiter } from "../../spend/registration-limit.js";
import { registerTransferBodySchema } from "../schemas.js";

export interface RegisterTransferRouteOptions {
  readonly repo: TransferRepository;
  readonly apiKeys: ApiKeyStore;
  readonly network: CctpNetwork;
  readonly registrationLimiter: RegistrationLimiter;
}

const responseSchema = {
  201: z.object({
    id: z.string(),
    status: z.literal("pending"),
    sourceChain: z.string(),
    sourceTxHash: z.string(),
  }),
  409: z.object({ error: z.string() }),
  429: z.object({ error: z.string() }),
};

/**
 * POST /transfers — registers a transfer for the relayer to complete.
 *
 * Per STEP 2: only WHICH source transaction to watch is accepted here (transferId, sourceChain,
 * sourceTxHash, rail). amount and recipient are NOT accepted from the caller — they are extracted
 * from the real, attested Iris message once the work loop picks this up (see work/attest.ts and
 * db/schema.sql), so a caller cannot register a transfer claiming a recipient/amount that does not
 * match what is actually on-chain. sourceDomain is derived server-side from sourceChain via
 * @ferryline/sdk's cctpEvmChain, for the same reason: never trust chain metadata a caller supplies
 * when the SDK already knows the correct value.
 *
 * Schema validation (zod, via @fastify/type-provider-zod) runs before this handler is ever called —
 * a malformed body never reaches the database or any chain call. Bearer-token auth is a preHandler,
 * so it runs before schema validation would even matter for an unauthenticated caller.
 *
 * STEP 4's registration-time rate limit (registrationLimiter) runs first inside the handler body,
 * right after auth, before the chain lookup or any repository/database call. It is a BLUNT per-API-
 * key spam brake, not the real per-recipient limit — the recipient is not known yet at registration
 * time (see the security-property comment on registerTransferBodySchema in ../schemas.js). The real
 * per-recipient check runs later, at the pending -> attested transition, once the recipient is
 * verified from the on-chain message (see work/attest.ts and RECIPIENT_RATE_LIMITED in
 * work/errors.ts).
 */
export const registerTransferRoute: FastifyPluginCallbackZod<RegisterTransferRouteOptions> = (
  fastify,
  options,
  done,
) => {
  fastify.post(
    "/transfers",
    {
      preHandler: requireApiKey(options.apiKeys),
      schema: {
        body: registerTransferBodySchema(options.network),
        response: responseSchema,
      },
    },
    async (request, reply) => {
      // request.apiKeyHash is always set here: requireApiKey's preHandler either sets it or has
      // already replied 401 and returned, in which case Fastify never reaches this handler.
      const keyHash = request.apiKeyHash;
      if (!keyHash) {
        throw new Error(
          "registerTransferRoute reached without request.apiKeyHash set — requireApiKey's " +
            "preHandler should have set it or already replied 401",
        );
      }
      const limit = await options.registrationLimiter.recordAndCheck(keyHash);
      if (!limit.allowed) {
        await reply.code(429).send({
          error:
            `registration rate limit exceeded for this API key ` +
            `(${String(limit.countInWindow)} attempts in the current window)`,
        });
        return;
      }

      const { transferId, sourceChain, sourceTxHash, rail } = request.body;
      // The body schema already refined sourceChain against cctpEvmChain for this exact network,
      // so this lookup cannot fail here — but the schema and this handler are two different pieces
      // of code, so re-deriving via the same function (not duplicating its logic) rather than
      // trusting the schema's success as a specific fact about the domain value.
      const chain = cctpEvmChain(options.network, sourceChain);
      if (!chain) {
        // Unreachable if the schema validated correctly; a 500 here would mean the schema and this
        // handler disagreed about what "valid" means, which is itself a bug worth surfacing loudly
        // rather than silently falling back to a guessed domain.
        throw new Error(
          `sourceChain "${sourceChain}" passed schema validation but cctpEvmChain(${options.network}, ...) returned undefined`,
        );
      }

      try {
        const row = await options.repo.register({
          id: transferId,
          rail,
          sourceChain,
          sourceTxHash,
          sourceDomain: chain.domain,
        });
        await reply.code(201).send({
          id: row.id,
          status: "pending",
          sourceChain: row.sourceChain,
          sourceTxHash: row.sourceTxHash,
        });
      } catch (error) {
        if (error instanceof DuplicateTransferError) {
          await reply.code(409).send({
            error: `a transfer for ${error.sourceChain}:${error.sourceTxHash} is already registered`,
          });
          return;
        }
        throw error;
      }
    },
  );
  done();
};
