import { buildInvocation, mintAndForwardScVals } from "@ferryline/sdk";
import {
  BASE_FEE,
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import type { Signer } from "../signer/types.js";
import type { Api, RelayerStellarRpc } from "./stellar-rpc.js";

export class SpendCapExceededError extends Error {
  constructor(
    readonly quotedFeeStroops: bigint,
    readonly capStroops: bigint,
  ) {
    super(
      `fee-bump quote ${quotedFeeStroops.toString()} stroops exceeds the per-transfer cap ` +
        `${capStroops.toString()} stroops (FERRYLINE_MAX_FEE_BUMP_STROOPS)`,
    );
    this.name = "SpendCapExceededError";
  }
}

export interface MintAndForwardInputs {
  readonly forwarderContractId: string;
  readonly message: Uint8Array;
  readonly attestation: Uint8Array;
}

export interface SubmittedMintAndForward {
  readonly hash: string;
  readonly feeBumpFeeStroops: bigint;
}

/**
 * Builds and signs the inner `mint_and_forward` invocation (sponsor as source — the sponsor IS the
 * caller of this contract call, there is no separate end-user transaction here), then wraps it in a
 * fee-bump transaction signed by the same sponsor. The fee-bump's `baseFee` is decided here, AFTER
 * the inner transaction is simulated (so its resource fee is known) and BEFORE anything is signed or
 * broadcast — which is the one place `capStroops` can still stop an overspend before it happens.
 *
 * Returns the signed, ready-to-broadcast fee-bump envelope and its total network fee in stroops;
 * does NOT submit it. Submission (and the "write submitting before broadcast" ordering the crash-
 * recovery contract depends on) is the caller's responsibility — see work/submit-mint.ts.
 */
export async function buildSignedFeeBumpMintAndForward(params: {
  rpc: RelayerStellarRpc;
  signer: Signer;
  networkPassphrase: string;
  sponsorAccount: string;
  inputs: MintAndForwardInputs;
  capStroops: bigint;
}): Promise<{ envelopeXdr: string; feeBumpFeeStroops: bigint }> {
  // NO memo: this is a Soroban InvokeHostFunctionOp, and Soroban transactions can never carry a
  // memo (the SAME real bug, found and fixed independently in the SDK's own two outbound rail
  // builders during widget-phase STEP 1 seam-proofing — confirmed with a real testnet RPC
  // rejection: "Transaction contains a memo. Soroban transactions do not support memos." This
  // third instance was caught by inspection before a real inbound delivery hit it live, while a
  // real end-to-end inbound seam test was in progress). Correlation with `transfer.id` does not
  // need a memo: the relayer's own real Postgres `transfers` table (options.repo) is the actual
  // correlation mechanism — every step here is already keyed by `transfer.id`/`transfer.version`.
  const sourceAccount = await params.rpc.getAccount(params.sponsorAccount);
  const built = await buildInvocation({
    rpc: params.rpc,
    source: sourceAccount,
    networkPassphrase: params.networkPassphrase,
    contractId: params.inputs.forwarderContractId,
    fn: "mint_and_forward",
    args: mintAndForwardScVals({
      message: params.inputs.message,
      attestation: params.inputs.attestation,
    }),
  });

  const innerUnsigned = TransactionBuilder.fromXDR(built.xdr, params.networkPassphrase);
  if (!(innerUnsigned instanceof Transaction)) {
    throw new Error("expected a plain (non-fee-bump) inner transaction");
  }
  const innerSignedXdr = await params.signer.sign(innerUnsigned.toXDR());
  const innerSigned = TransactionBuilder.fromXDR(innerSignedXdr, params.networkPassphrase);
  if (!(innerSigned instanceof Transaction)) {
    throw new Error("signer returned a fee-bump envelope for a plain transaction");
  }

  // The fee-bump's own base fee must be at least the inner transaction's per-operation inclusion
  // fee (SDK enforces this and throws if not); BASE_FEE is the network floor. Real congestion
  // pricing is out of scope for this MVP — an operator who needs a higher floor sets
  // FERRYLINE_MAX_FEE_BUMP_STROOPS accordingly, and a too-low fee simply fails to submit rather
  // than silently overspending.
  const feeBumpBaseFee = BigInt(BASE_FEE);
  const quotedFeeStroops = feeBumpBaseFee * BigInt(innerSigned.operations.length + 1);
  if (quotedFeeStroops > params.capStroops) {
    throw new SpendCapExceededError(quotedFeeStroops, params.capStroops);
  }

  const feeBumpUnsigned = TransactionBuilder.buildFeeBumpTransaction(
    params.sponsorAccount,
    feeBumpBaseFee.toString(),
    innerSigned,
    params.networkPassphrase,
  );
  const feeBumpSignedXdr = await params.signer.sign(feeBumpUnsigned.toXDR());

  return { envelopeXdr: feeBumpSignedXdr, feeBumpFeeStroops: quotedFeeStroops };
}

export interface BroadcastResult {
  readonly hash: string;
  readonly status: Api.SendTransactionStatus;
  /** Present only when status is "ERROR": Circle/Soroban's reason the network refused the transaction. */
  readonly errorDetail?: string;
}

/**
 * Broadcasts an already-signed fee-bump envelope. Returns immediately with the network's synchronous
 * verdict (PENDING/DUPLICATE/TRY_AGAIN_LATER/ERROR) — never waits for confirmation, and never throws
 * on "ERROR": that status means the transaction was rejected before ever entering the network (bad
 * sequence number, insufficient balance, ...), which is meaningfully different from "broadcast,
 * outcome unknown" and the caller (work/submit.ts) needs to see it to classify the failure as
 * retryable rather than assuming the state machine's crash-safety invariants were at risk.
 */
export async function broadcastFeeBump(
  rpc: RelayerStellarRpc,
  networkPassphrase: string,
  signedFeeBumpXdr: string,
): Promise<BroadcastResult> {
  const tx = TransactionBuilder.fromXDR(signedFeeBumpXdr, networkPassphrase);
  if (!(tx instanceof FeeBumpTransaction)) {
    throw new Error("expected a fee-bump transaction envelope");
  }
  const response = await rpc.sendTransaction(tx);
  if (response.status === "ERROR") {
    return {
      hash: response.hash,
      status: response.status,
      errorDetail: response.errorResult ? JSON.stringify(response.errorResult) : "no detail",
    };
  }
  return { hash: response.hash, status: response.status };
}
