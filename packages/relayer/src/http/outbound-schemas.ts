import { cctpEvmChain, CCTP_STELLAR, type CctpNetwork } from "@ferryline/sdk";
import { z } from "zod";

import { zRail, zTransferId } from "./schemas.js";

// Reuses zTransferId/zRail directly from schemas.js — the ULID and rail validators are not
// direction-specific, so re-declaring them here would be a pure DRY violation with no adaptation
// needed (unlike zSourceChain/zEvmTxHash below, which genuinely differ per direction: inbound
// watches an EVM source tx, outbound watches a Stellar one).

/**
 * Stellar transaction hash: 64 lowercase hex characters (32 bytes), no "0x" prefix — the real
 * format Stellar RPC's getTransaction(hash) and Iris's messagesByTx(sourceDomain, txHash) both take
 * (see chain/stellar-rpc.ts and @ferryline/sdk's iris.ts). Genuinely different from EVM's
 * 0x-prefixed zEvmTxHash in schemas.js, hence its own schema rather than reuse.
 */
export const zStellarTxHash = z
  .string()
  .regex(
    /^[0-9a-f]{64}$/,
    "sourceTxHash must be a 64-character lowercase hex Stellar transaction hash (no 0x prefix)",
  );

/**
 * Validates destinationChain against @ferryline/sdk's own cctpEvmChain for the relayer's configured
 * network — same "never trust a chain slug the SDK doesn't already recognize" reasoning as
 * zSourceChain in schemas.js, mirrored for the outbound direction's destination side.
 */
export function zDestinationChain(network: CctpNetwork): z.ZodString {
  return z.string().refine((chain) => cctpEvmChain(network, chain) !== undefined, {
    message: `destinationChain is not a supported CCTP destination chain for network "${network}"`,
  });
}

/**
 * SECURITY PROPERTY, mirroring registerTransferBodySchema's own doc comment exactly: this schema
 * accepts ONLY which source Stellar transaction to watch and which destination chain it targets —
 * NOT amount or recipient. Those are extracted later, at the pending -> attested transition, from
 * the independently-verified Iris message body (see work/outbound-attest.ts and
 * repo/outbound-types.ts's OutboundTransferRow, whose amount/recipient are `null` until that
 * transition writes them). Do not "simplify" this by accepting them as a caller-supplied convenience
 * — the same fabrication risk registerTransferBodySchema's comment describes applies identically
 * here.
 *
 * sourceDomain is NOT accepted from the caller either: it is always Stellar's own CCTP domain
 * (CCTP_STELLAR[network].domain, currently 27 on both networks), derived server-side the same way
 * registerTransferRoute derives sourceChain's domain from cctpEvmChain rather than trusting a
 * caller-supplied value.
 */
export function registerOutboundTransferBodySchema(network: CctpNetwork): z.ZodObject<{
  transferId: typeof zTransferId;
  sourceTxHash: typeof zStellarTxHash;
  destinationChain: ReturnType<typeof zDestinationChain>;
  rail: typeof zRail;
}> {
  return z.object({
    transferId: zTransferId,
    sourceTxHash: zStellarTxHash,
    destinationChain: zDestinationChain(network),
    rail: zRail,
  });
}

export type RegisterOutboundTransferBody = z.infer<
  ReturnType<typeof registerOutboundTransferBodySchema>
>;

export const outboundTransferIdParamSchema = z.object({
  id: zTransferId,
});

/** Stellar's own CCTP domain — identical on both networks (see @ferryline/sdk's CCTP_STELLAR). Not
 *  re-derived per call; both testnet and mainnet entries agree, but reading it live from the
 *  relayer's configured network (rather than hardcoding 27 here) means this stays correct even if
 *  that ever changed. */
export function stellarSourceDomain(network: CctpNetwork): number {
  return CCTP_STELLAR[network].domain;
}
