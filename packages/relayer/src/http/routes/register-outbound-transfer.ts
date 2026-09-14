import type { CctpNetwork } from "@ferryline/sdk";
import type { FastifyPluginCallbackZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import type { ApiKeyStore } from "../auth.js";
import { requireApiKey } from "../auth.js";
import { DuplicateOutboundTransferError } from "../../repo/outbound-types.js";
import type { OutboundTransferRepository } from "../../repo/outbound-types.js";
import type { RegistrationLimiter } from "../../spend/registration-limit.js";
import { registerOutboundTransferBodySchema, stellarSourceDomain } from "../outbound-schemas.js";

export interface RegisterOutboundTransferRouteOptions {
  readonly repo: OutboundTransferRepository;
  readonly apiKeys: ApiKeyStore;
  readonly network: CctpNetwork;
  readonly registrationLimiter: RegistrationLimiter;
}

const responseSchema = {
  201: z.object({
    id: z.string(),
    status: z.literal("pending"),
    sourceChain: z.literal("stellar"),
    sourceTxHash: z.string(),
    destinationChain: z.string(),
  }),
  409: z.object({ error: z.string() }),
  429: z.object({ error: z.string() }),
};

/**
 * POST /outbound-transfers — registers a Stellar-source CCTP burn for the outbound relayer to
 * complete on the destination EVM chain. Mirrors register-transfer.ts's own route exactly — same
 * auth-then-registration-limit-then-schema-validated-registration order, same reasoning for why
 * amount/recipient are never accepted from the caller (see outbound-schemas.js's own doc comment).
 *
 * registrationLimiter is the SAME shared per-API-key limiter/table as the inbound route (see
 * spend/registration-limit.ts's own doc comment: it is not parameterized by direction, and nothing
 * at registration time spends money in either direction, so one shared blunt spam brake across both
 * directions is a deliberate choice, not an oversight). The real per-recipient limit is enforced
 * later, at the pending -> attested transition, once the recipient is known from the verified Iris
 * message (see RECIPIENT_RATE_LIMITED in work/outbound-errors.ts).
 */
export const registerOutboundTransferRoute: FastifyPluginCallbackZod<
  RegisterOutboundTransferRouteOptions
> = (fastify, options, done) => {
  fastify.post(
    "/outbound-transfers",
    {
      preHandler: requireApiKey(options.apiKeys),
      schema: {
        body: registerOutboundTransferBodySchema(options.network),
        response: responseSchema,
      },
    },
    async (request, reply) => {
      // request.apiKeyHash is always set here: requireApiKey's preHandler either sets it or has
      // already replied 401 and returned, in which case Fastify never reaches this handler.
      const keyHash = request.apiKeyHash;
      if (!keyHash) {
        throw new Error(
          "registerOutboundTransferRoute reached without request.apiKeyHash set — requireApiKey's " +
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

      const { transferId, sourceTxHash, destinationChain, rail } = request.body;

      try {
        const row = await options.repo.register({
          id: transferId,
          rail,
          sourceTxHash,
          sourceDomain: stellarSourceDomain(options.network),
          destinationChain,
        });
        await reply.code(201).send({
          id: row.id,
          status: "pending",
          sourceChain: "stellar",
          sourceTxHash: row.sourceTxHash,
          destinationChain: row.destinationChain,
        });
      } catch (error) {
        if (error instanceof DuplicateOutboundTransferError) {
          await reply.code(409).send({
            error: `an outbound transfer for source tx ${error.sourceTxHash} is already registered`,
          });
          return;
        }
        throw error;
      }
    },
  );
  done();
};
