import type { CctpNetwork, StellarRpc } from "@ferryline/sdk";
import cors from "@fastify/cors";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify, { type FastifyInstance } from "fastify";

import type { OutboundTransferRepository } from "../repo/outbound-types.js";
import type { TransferRepository } from "../repo/types.js";
import type { SpendCeiling } from "../spend/ceiling.js";
import type { RegistrationLimiter } from "../spend/registration-limit.js";
import type { ApiKeyStore } from "./auth.js";
import { adminApiKeysRoute } from "./routes/admin-api-keys.js";
import { getOutboundTransferRoute } from "./routes/get-outbound-transfer.js";
import { getTransferRoute } from "./routes/get-transfer.js";
import { healthzRoute, type HealthzOutboundOptions } from "./routes/healthz.js";
import { registerOutboundTransferRoute } from "./routes/register-outbound-transfer.js";
import { registerTransferRoute } from "./routes/register-transfer.js";

/** Only present once the outbound direction is wired up (see main.ts) — omit entirely to run this
 *  process inbound-only, same optionality as HealthzOutboundOptions itself. */
export interface BuildAppOutboundOptions {
  readonly repo: OutboundTransferRepository;
  readonly registrationLimiter: RegistrationLimiter;
  readonly healthz: HealthzOutboundOptions;
}

export interface BuildAppOptions {
  readonly repo: TransferRepository;
  readonly apiKeys: ApiKeyStore;
  /** Gates POST/DELETE /admin/api-keys — see auth.ts's requireAdminSecret and admin-config.ts's own
   *  doc comment for why this is a genuinely separate, more sensitive credential from anything in
   *  `apiKeys` above, never interchangeable with an integrator's own key. */
  readonly adminSecret: string;
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
  readonly outbound?: BuildAppOutboundOptions;
  /** Browser origins allowed to call ANY route here cross-origin (inbound and outbound
   *  registration/status routes alike — this is one Fastify instance, one CORS policy for the
   *  whole app, not per-route). Defaults to `[]` (fail-closed: no browser origin is allowed) if
   *  omitted — see RelayerConfig.corsOrigins's own doc comment in config.ts for the full
   *  reasoning. Pass real origins here (from FERRYLINE_CORS_ORIGINS) to let a real
   *  `<ferryline-widget>` page call this relayer directly from a browser. */
  readonly corsOrigins?: readonly string[];
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

  // Registered before any route: a real, pre-existing gap found and fixed during the
  // outbound-auto-registration phase (see RelayerConfig.corsOrigins's own doc comment in
  // config.ts for the full story) — without this, EVERY browser-based caller (the widget
  // included) is silently blocked by the browser itself before the request ever reaches this
  // process, confirmed directly against a real browser run. Fail-closed by construction: an
  // empty `corsOrigins` list means `@fastify/cors`'s own `origin` option receives `[]`, which it
  // treats as "no origin is ever allowed" — never a wildcard.
  void app.register(cors, { origin: [...(options.corsOrigins ?? [])] });

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
    ...(options.outbound ? { outbound: options.outbound.healthz } : {}),
  });
  void app.register(registerTransferRoute, {
    repo: options.repo,
    apiKeys: options.apiKeys,
    network: options.network,
    registrationLimiter: options.registrationLimiter,
  });
  void app.register(getTransferRoute, { repo: options.repo });
  void app.register(adminApiKeysRoute, {
    apiKeys: options.apiKeys,
    adminSecret: options.adminSecret,
  });

  if (options.outbound) {
    const outbound = options.outbound;
    void app.register(registerOutboundTransferRoute, {
      repo: outbound.repo,
      apiKeys: options.apiKeys,
      network: options.network,
      registrationLimiter: outbound.registrationLimiter,
    });
    void app.register(getOutboundTransferRoute, { repo: outbound.repo });
  }

  return app;
}
