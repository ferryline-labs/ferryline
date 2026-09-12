import { isTransferId } from "@ferryline/core";
import { cctpEvmChain, type CctpNetwork } from "@ferryline/sdk";
import { z } from "zod";

// isTransferId lives in @ferryline/core and is not separately re-exported by @ferryline/sdk's top
// level; imported directly from core here rather than adding a re-export the SDK's own code never
// needed. cctpEvmChain/CctpNetwork ARE re-exported by the SDK (via its usdc-cctp rail module), so
// those come from "@ferryline/sdk" as normal.

/** Only rail the relayer completes work for. usdt0-layerzero never needs a relayer (LayerZero's own executor delivers it). */
export const SUPPORTED_RAILS = ["usdc-cctp"] as const;

/** ULID, validated with @ferryline/core's own predicate — not reimplemented here. */
export const zTransferId = z.string().refine(isTransferId, {
  message: "transferId must be a valid ULID (26 Crockford-base32 characters)",
});

export const zRail = z.enum(SUPPORTED_RAILS);

/** 0x-prefixed 32-byte hex: the EVM transaction hash format. Every CCTP source chain the relayer
 *  watches is an EVM chain (see @ferryline/sdk's CCTP_EVM_CHAINS) — Stellar-sourced CCTP burns
 *  never need the relayer, since the sender submits deposit_for_burn themselves. */
export const zEvmTxHash = z
  .string()
  .regex(
    /^0x[0-9a-fA-F]{64}$/,
    "sourceTxHash must be a 0x-prefixed 32-byte (64 hex character) transaction hash",
  );

/**
 * Builds the sourceChain schema against the relayer's actually-configured network, so a testnet
 * relayer rejects mainnet chain slugs and vice versa (cctpEvmChain from @ferryline/sdk — the same
 * chain list the work loop uses — not a separately maintained enum that could drift from it).
 */
export function zSourceChain(network: CctpNetwork): z.ZodString {
  return z.string().refine((chain) => cctpEvmChain(network, chain) !== undefined, {
    message: `sourceChain is not a supported CCTP source chain for network "${network}"`,
  });
}

/**
 * SECURITY PROPERTY, not an oversight — do not "simplify" this by adding `amount`/`recipient` here
 * as a convenience: this schema deliberately accepts ONLY which source transaction to watch. The
 * actual amount and recipient are never taken from the caller's word for it; they are extracted
 * later, at the pending -> attested transition, from the independently-parsed and verified on-chain
 * CCTP message and its forwarder hook data (see work/attest.ts's parseCctpMessage/
 * parseForwarderHookData usage, and repo/types.ts's TransferRow.amount/recipient, which are `null`
 * until that transition writes them). If a caller could register a transfer claiming a recipient or
 * amount that doesn't match what actually happened on-chain, the relayer's own spend/rate-limit
 * decisions could be made against a fabricated fact instead of a verified one. Confirmed correct in
 * the phase-3 sign-off; if a future change needs the caller to supply these, that is a different,
 * deliberately-reviewed design, not a quiet field addition here.
 */
export function registerTransferBodySchema(network: CctpNetwork): z.ZodObject<{
  transferId: typeof zTransferId;
  sourceChain: ReturnType<typeof zSourceChain>;
  sourceTxHash: typeof zEvmTxHash;
  rail: typeof zRail;
}> {
  return z.object({
    transferId: zTransferId,
    sourceChain: zSourceChain(network),
    sourceTxHash: zEvmTxHash,
    rail: zRail,
  });
}

export type RegisterTransferBody = z.infer<ReturnType<typeof registerTransferBodySchema>>;

export const transferIdParamSchema = z.object({
  id: zTransferId,
});
