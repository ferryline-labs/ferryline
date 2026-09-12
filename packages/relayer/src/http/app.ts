import type { CctpNetwork, StellarRpc } from "@ferryline/sdk";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify, { type FastifyInstance } from "fastify";

import type { TransferRepository } from "../repo/types.js";
import type { SpendCeiling } from "../spend/ceiling.js";
import type { RegistrationLimiter } from "../spend/registration-limit.js";
import type { ApiKeyStore } from "./auth.js";
import { getTransferRoute } from "./routes/get-transfer.js";
import { healthzRoute } from "./routes/healthz.js";
import { registerTransferRoute } from "./routes/register-transfer.js";

export interface BuildAppOptions {
  readonly repo: TransferRepository;
  readonly apiKeys: ApiKeyStore;
  readonly network: CctpNetwork;
  readonly rpc: StellarRpc;
  readonly sponsorAccount: string;
  readonly spendCeiling: SpendCeiling;
  readonly dailySpendCeilingStroops: bigint;
  readonly registrationLimiter: RegistrationLimiter;
  readonly version: string;
  /** Defaults to Date.now at build time. Overridable for deterministic tests. */
  readonly startedAt?: number;
  readonly now?: () => number;
  readonly logger?: boolean;
}

/**
 * Builds (but does not start listening) the relayer's Fastify app. Every route's own schema lives
 * next to that route (see http/routes/*.ts) — nothing here defines request/response shapes. zod is
 * wired as Fastify's validator AND serializer compiler, so both incoming bodies/params and outgoing
 * responses are checked against their declared zod schemas; a malformed request is rejected with 400
 * before the handler (and therefore before any database or chain call) ever runs — this is Fastify's
 * own default behavior once validatorCompiler is registered, not custom logic here.
 */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      reply.code(400).send({
        error: "request validation failed",
        details: error.validation.map((v) => ({
          path: v.instancePath || v.schemaPath,
          message: v.message,
        })),
      });
      return;
    }
    request.log.error(error);
    reply.code(500).send({ error: "internal error" });
  });

  const startedAt = options.startedAt ?? Date.now();

  void app.register(healthzRoute, {
    rpc: options.rpc,
    sponsorAccount: options.sponsorAccount,
    spendCeiling: options.spendCeiling,
    dailySpendCeilingStroops: options.dailySpendCeilingStroops,
    version: options.version,
    startedAt,
    ...(options.now ? { now: options.now } : {}),
  });
  void app.register(registerTransferRoute, {
    repo: options.repo,
    apiKeys: options.apiKeys,
    network: options.network,
    registrationLimiter: options.registrationLimiter,
  });
  void app.register(getTransferRoute, { repo: options.repo });

  return app;
}
