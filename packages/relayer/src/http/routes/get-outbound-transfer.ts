import type { FastifyPluginCallbackZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import type { OutboundTransferRepository } from "../../repo/outbound-types.js";
import { outboundTransferIdParamSchema } from "../outbound-schemas.js";

export interface GetOutboundTransferRouteOptions {
  readonly repo: OutboundTransferRepository;
}

const outboundTransferResponseSchema = z.object({
  id: z.string(),
  rail: z.string(),
  status: z.enum(["pending", "attested", "submitting", "delivered", "failed"]),
  sourceChain: z.string(),
  sourceTxHash: z.string(),
  sourceDomain: z.number(),
  destinationChain: z.string(),
  destinationTxHash: z.string().nullable(),
  amount: z.string().nullable(),
  recipient: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const responseSchema = {
  200: outboundTransferResponseSchema,
  404: z.object({ error: z.string() }),
};

/**
 * GET /outbound-transfers/:id — the outbound mirror of get-transfer.ts's own route: status lookup
 * for the manual-recovery path. No auth required, same reasoning — a read of a ULID-keyed row
 * (unguessable) with no spend-related side effect, unlike POST /outbound-transfers which spends the
 * sponsor's gas budget by admitting work.
 */
export const getOutboundTransferRoute: FastifyPluginCallbackZod<GetOutboundTransferRouteOptions> = (
  fastify,
  options,
  done,
) => {
  fastify.get(
    "/outbound-transfers/:id",
    { schema: { params: outboundTransferIdParamSchema, response: responseSchema } },
    async (request, reply) => {
      const row = await options.repo.get(request.params.id);
      if (!row) {
        await reply.code(404).send({ error: `no outbound transfer with id ${request.params.id}` });
        return;
      }
      await reply.code(200).send({
        id: row.id,
        rail: row.rail,
        status: row.status,
        sourceChain: row.sourceChain,
        sourceTxHash: row.sourceTxHash,
        sourceDomain: row.sourceDomain,
        destinationChain: row.destinationChain,
        destinationTxHash: row.destinationTxHash,
        amount: row.amount,
        recipient: row.recipient,
        errorCode: row.errorCode,
        errorDetail: row.errorDetail,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    },
  );
  done();
};
