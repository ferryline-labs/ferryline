import { getNativeBalance, type StellarRpc } from "@ferryline/sdk";
import type { FastifyPluginCallbackZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import type { SpendCeiling } from "../../spend/ceiling.js";
import { healthReport } from "../../health.js";

export interface HealthzRouteOptions {
  readonly rpc: StellarRpc;
  readonly sponsorAccount: string;
  readonly spendCeiling: SpendCeiling;
  readonly dailySpendCeilingStroops: bigint;
  readonly version: string;
  readonly startedAt: number;
  readonly now?: () => number;
}

const responseSchema = {
  200: z.object({
    status: z.literal("ok"),
    service: z.literal("ferryline-relayer"),
    version: z.string(),
    uptimeSeconds: z.number(),
    now: z.string(),
    sponsor: z.object({
      account: z.string(),
      /** Stroops, as a string (can exceed Number.MAX_SAFE_INTEGER for large balances). */
      nativeBalanceStroops: z.string().nullable(),
      /** True if the account could not be read (does not exist, or the RPC call failed). */
      balanceUnknown: z.boolean(),
    }),
    dailySpend: z.object({
      spentStroops: z.string(),
      ceilingStroops: z.string(),
      ceilingReached: z.boolean(),
    }),
  }),
};

/**
 * GET /healthz — extended per STEP 2: reports sponsor balance and whether the daily spend ceiling
 * has been hit, so an operator can see both without digging through logs. Balance is read live on
 * every call (a simulated ledger-entry read, not cached), matching the "no digging through logs"
 * requirement over a "fast endpoint" optimization — this route is for humans and monitoring, not a
 * high-frequency hot path.
 */
export const healthzRoute: FastifyPluginCallbackZod<HealthzRouteOptions> = (
  fastify,
  options,
  done,
) => {
  fastify.get("/healthz", { schema: { response: responseSchema } }, async (_request, reply) => {
    const now = options.now ?? Date.now;

    let nativeBalanceStroops: string | null;
    let balanceUnknown: boolean;
    try {
      const balance = await getNativeBalance(options.rpc, options.sponsorAccount);
      nativeBalanceStroops = balance === undefined ? null : balance.toString();
      balanceUnknown = balance === undefined;
    } catch {
      nativeBalanceStroops = null;
      balanceUnknown = true;
    }

    const spentStroops = await options.spendCeiling.spentToday();
    const ceilingReached = spentStroops >= options.dailySpendCeilingStroops;

    await reply.code(200).send({
      ...healthReport(options.startedAt, now(), options.version),
      sponsor: {
        account: options.sponsorAccount,
        nativeBalanceStroops,
        balanceUnknown,
      },
      dailySpend: {
        spentStroops: spentStroops.toString(),
        ceilingStroops: options.dailySpendCeilingStroops.toString(),
        ceilingReached,
      },
    });
  });
  done();
};
