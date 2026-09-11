import { Address, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import type { Account, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

import { simulateView, type StellarRpc } from "../../stellar/rpc.js";

/**
 * Argument order of TokenMessengerMinter.deposit_for_burn on Stellar, verbatim from the mainnet
 * interface dump (packages/core/verified/cctp-token-messenger-minter.mainnet.rs). A test checks this
 * list against that file so the encoder cannot drift from the deployed contract silently.
 */
export const DEPOSIT_FOR_BURN_ARGS = [
  "caller",
  "amount",
  "destination_domain",
  "mint_recipient",
  "burn_token",
  "destination_caller",
  "max_fee",
  "min_finality_threshold",
] as const;

export interface DepositForBurnArgs {
  readonly caller: string;
  /** 7-decimal Stellar units (the contract scales to the message's 6 decimals). */
  readonly amount: bigint;
  readonly destinationDomain: number;
  readonly mintRecipient: Uint8Array;
  readonly burnToken: string;
  readonly destinationCaller: Uint8Array;
  readonly maxFee: bigint;
  readonly minFinalityThreshold: number;
}

export function depositForBurnScVals(a: DepositForBurnArgs): xdr.ScVal[] {
  return [
    new Address(a.caller).toScVal(),
    nativeToScVal(a.amount, { type: "i128" }),
    nativeToScVal(a.destinationDomain, { type: "u32" }),
    nativeToScVal(Buffer.from(a.mintRecipient), { type: "bytes" }),
    new Address(a.burnToken).toScVal(),
    nativeToScVal(Buffer.from(a.destinationCaller), { type: "bytes" }),
    nativeToScVal(a.maxFee, { type: "i128" }),
    nativeToScVal(a.minFinalityThreshold, { type: "u32" }),
  ];
}

/** SAC `approve(from, spender, amount, expiration_ledger)`. */
export function approveScVals(
  from: string,
  spender: string,
  amount: bigint,
  expirationLedger: number,
): xdr.ScVal[] {
  return [
    new Address(from).toScVal(),
    new Address(spender).toScVal(),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(expirationLedger, { type: "u32" }),
  ];
}

interface ViewContext {
  readonly rpc: StellarRpc;
  readonly source: Account;
  readonly networkPassphrase: string;
}

async function view<T>(
  ctx: ViewContext,
  contractId: string,
  fn: string,
  args: xdr.ScVal[],
): Promise<T> {
  const retval = await simulateView({
    rpc: ctx.rpc,
    source: ctx.source,
    networkPassphrase: ctx.networkPassphrase,
    contractId,
    fn,
    args,
  });
  return scValToNative(retval) as T;
}

/** SAC `allowance(from, spender) -> i128`. */
export function sacAllowance(
  ctx: ViewContext,
  sac: string,
  from: string,
  spender: string,
): Promise<bigint> {
  return view<bigint>(ctx, sac, "allowance", [
    new Address(from).toScVal(),
    new Address(spender).toScVal(),
  ]);
}

/** SAC `balance(id) -> i128`. */
export function sacBalance(ctx: ViewContext, sac: string, holder: string): Promise<bigint> {
  return view<bigint>(ctx, sac, "balance", [new Address(holder).toScVal()]);
}

export function contractPaused(ctx: ViewContext, contractId: string): Promise<boolean> {
  return view<boolean>(ctx, contractId, "paused", []);
}

/** TokenMessengerMinter `get_min_fee_amount(burn_token, amount) -> i128`. */
export function minFeeAmount(
  ctx: ViewContext,
  tokenMessengerMinter: string,
  burnToken: string,
  amount: bigint,
): Promise<bigint> {
  return view<bigint>(ctx, tokenMessengerMinter, "get_min_fee_amount", [
    new Address(burnToken).toScVal(),
    nativeToScVal(amount, { type: "i128" }),
  ]);
}

/** MessageTransmitter `is_nonce_used(nonce: BytesN<32>) -> bool`. */
export function nonceUsed(
  ctx: ViewContext,
  messageTransmitter: string,
  nonce: Uint8Array,
): Promise<boolean> {
  return view<boolean>(ctx, messageTransmitter, "is_nonce_used", [
    nativeToScVal(Buffer.from(nonce), { type: "bytes" }),
  ]);
}
