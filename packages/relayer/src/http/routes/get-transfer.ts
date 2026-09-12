import type { FastifyPluginCallbackZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import type { TransferRepository } from "../../repo/types.js";
import { transferIdParamSchema } from "../schemas.js";

export interface GetTransferRouteOptions {
  readonly repo: TransferRepository;
}

const transferResponseSchema = z.object({
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
  200: transferResponseSchema,
  404: z.object({ error: z.string() }),
};

/**
 * GET /transfers/:id — status lookup for the manual-recovery path. No auth required: this is a
 * read of a ULID-keyed row (unguessable) and carries no spend-related side effect, unlike
 * POST /transfers which spends the sponsor's gas budget by admitting work.
 */
export const getTransferRoute: FastifyPluginCallbackZod<GetTransferRouteOptions> = (
  fastify,
  options,
  done,
) => {
  fastify.get(
    "/transfers/:id",
    { schema: { params: transferIdParamSchema, response: responseSchema } },
    async (request, reply) => {
      const row = await options.repo.get(request.params.id);
      if (!row) {
        await reply.code(404).send({ error: `no transfer with id ${request.params.id}` });
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
