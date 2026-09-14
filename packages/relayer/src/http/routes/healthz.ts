import { getNativeBalance, type StellarRpc } from "@ferryline/sdk";
import type { FastifyPluginCallbackZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import type { RelayerEvmRpc } from "../../chain/evm-rpc.js";
import type { SpendCeiling } from "../../spend/ceiling.js";
import type { OutboundSpendCeiling } from "../../spend/outbound-ceiling.js";
import { healthReport } from "../../health.js";

/**
 * Outbound-direction reporting is entirely optional (undefined) rather than a second, parallel
 * healthz route — per the STEP 4 sign-off's explicit instruction to "extend the existing GET
 * /healthz (don't create a parallel one)". A relayer deployment that has not configured the
 * outbound direction yet (or ever, if an operator only runs inbound) simply omits `outbound` here
 * and the response omits the field — see the response schema below, where `outbound` is
 * `.optional()`, not required.
 */
export interface HealthzOutboundOptions {
  readonly rpc: RelayerEvmRpc;
  readonly sponsorAddress: `0x${string}`;
  readonly destinationChain: string;
  readonly spendCeiling: OutboundSpendCeiling;
  readonly dailyGasCeilingWei: bigint;
}

export interface HealthzRouteOptions {
  readonly rpc: StellarRpc;
  readonly sponsorAccount: string;
  readonly spendCeiling: SpendCeiling;
  readonly dailySpendCeilingStroops: bigint;
  readonly version: string;
  readonly startedAt: number;
  readonly now?: () => number;
  /** Omit entirely when the outbound direction is not configured/running in this process — see
   *  HealthzOutboundOptions's own doc comment. */
  readonly outbound?: HealthzOutboundOptions;
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
    /** Present only when this process has the outbound (Stellar -> EVM) direction configured. */
    outbound: z
      .object({
        destinationChain: z.string(),
        sponsor: z.object({
          address: z.string(),
          /** Wei, as a string (can exceed Number.MAX_SAFE_INTEGER). */
          nativeBalanceWei: z.string().nullable(),
          balanceUnknown: z.boolean(),
        }),
        dailySpend: z.object({
          spentWei: z.string(),
          ceilingWei: z.string(),
          ceilingReached: z.boolean(),
        }),
      })
      .optional(),
  }),
};

/**
 * GET /healthz — extended per STEP 2 (inbound sponsor balance/ceiling) and STEP 4 (outbound, when
 * configured): reports sponsor balance and whether the daily spend ceiling has been hit, for both
 * directions, so an operator can see both without digging through logs. Balances are read live on
 * every call (not cached), matching the "no digging through logs" requirement over a "fast
 * endpoint" optimization — this route is for humans and monitoring, not a high-frequency hot path.
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

    let outbound: z.infer<(typeof responseSchema)[200]>["outbound"];
    if (options.outbound) {
      const ob = options.outbound;
      let nativeBalanceWei: string | null;
      let obBalanceUnknown: boolean;
      try {
        const balance = await ob.rpc.getBalance({ address: ob.sponsorAddress });
        nativeBalanceWei = balance.toString();
        obBalanceUnknown = false;
      } catch {
        nativeBalanceWei = null;
        obBalanceUnknown = true;
      }
      const spentWei = await ob.spendCeiling.spentToday(ob.destinationChain);
      outbound = {
        destinationChain: ob.destinationChain,
        sponsor: {
          address: ob.sponsorAddress,
          nativeBalanceWei,
          balanceUnknown: obBalanceUnknown,
        },
        dailySpend: {
          spentWei: spentWei.toString(),
          ceilingWei: ob.dailyGasCeilingWei.toString(),
          ceilingReached: spentWei >= ob.dailyGasCeilingWei,
        },
      };
    }

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
      ...(outbound ? { outbound } : {}),
    });
  });
  done();
};
