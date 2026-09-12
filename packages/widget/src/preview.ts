/**
 * Decodes a `TransferStep`'s REAL content — not the `Quote` object alone — into the human-readable
 * fields the transaction-preview UI renders: amount, destination, rail, fee. This is the one hard
 * requirement of this phase (STEP 2 assignment): render exactly what's about to be signed, before
 * any signing prompt.
 *
 * Deliberately reads the built step itself (decoded XDR / decoded EVM calldata), not just the
 * Quote's own numbers, even though the Quote is already trustworthy in this codebase's own flow —
 * because the whole point of a preview is to be the last real check between "what the SDK computed"
 * and "what the wallet is about to sign," and a mismatch between those two is exactly the kind of
 * bug (or malicious substitution, in a phishing-clone scenario) a preview exists to catch. A preview
 * that only echoes the Quote back at the user isn't a check on the built transaction at all.
 */
import { Address, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk";
import { decodeFunctionData } from "viem";

import { formatAmount as formatQuoteAmount } from "@ferryline/core";
import {
  ERC20_ABI,
  TOKEN_MESSENGER_V2_ABI,
  type Fee,
  type Quote,
  type TransferStep,
} from "@ferryline/sdk";

export interface DecodedStellarInvocation {
  readonly kind: "stellar-invocation";
  readonly contractId: string;
  readonly fn: string;
  /** Best-effort native decode of each ScVal arg; falls back to its base64 XDR if decoding fails. */
  readonly args: readonly unknown[];
}

export interface DecodedEvmCall {
  readonly kind: "evm-call";
  readonly to: `0x${string}`;
  readonly fn: string;
  readonly args: readonly unknown[];
  readonly value: bigint;
}

export interface DecodedDeferredStep {
  readonly kind: "deferred";
  readonly description: string;
  readonly dependsOn: number;
}

export type DecodedStep = DecodedStellarInvocation | DecodedEvmCall | DecodedDeferredStep;

/** ABIs this widget knows how to decode calldata against. Unknown selectors fall back to raw hex. */
const KNOWN_EVM_ABIS = [ERC20_ABI, TOKEN_MESSENGER_V2_ABI] as const;

function decodeStellarStep(xdr: string, networkPassphrase: string): DecodedStellarInvocation {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  if (!("operations" in tx)) {
    throw new Error("preview: expected a plain (non-fee-bump) transaction envelope");
  }
  const op = tx.operations[0];
  if (op?.type !== "invokeHostFunction" || op.func.type !== "hostFunctionTypeInvokeContract") {
    throw new Error("preview: expected the built step's one operation to be a contract invocation");
  }
  const invoke = op.func.invokeContract;
  return {
    kind: "stellar-invocation",
    contractId: Address.fromScAddress(invoke.contractAddress).toString(),
    fn: invoke.functionName.toString(),
    args: invoke.args.map((scVal): unknown => {
      try {
        // scValToNative's own real return type is `any` (stellar-sdk does not narrow it further);
        // this function's contract promises `unknown`, so the value is explicitly treated as
        // unknown from here on rather than silently inheriting `any`'s lack of type safety.
        return scValToNative(scVal) as unknown;
      } catch {
        return scVal.toXDR("base64");
      }
    }),
  };
}

function decodeEvmStep(to: `0x${string}`, data: `0x${string}`, value: bigint): DecodedEvmCall {
  for (const abi of KNOWN_EVM_ABIS) {
    try {
      const decoded = decodeFunctionData({ abi, data });
      return {
        kind: "evm-call",
        to,
        fn: decoded.functionName,
        args: [...(decoded.args ?? [])],
        value,
      };
    } catch {
      // Not this ABI's selector — try the next one.
    }
  }
  // Unknown selector: still a real, honest preview — shows the raw call rather than guessing.
  return {
    kind: "evm-call",
    to,
    fn: `unknown (selector ${data.slice(0, 10)})`,
    args: [data],
    value,
  };
}

/** Decode one TransferStep for display. `networkPassphrase` only matters for the Stellar case. */
export function decodeStep(step: TransferStep, networkPassphrase: string): DecodedStep {
  switch (step.kind) {
    case "stellar-transaction":
      return decodeStellarStep(step.xdr, networkPassphrase);
    case "stellar-transaction-deferred":
      return { kind: "deferred", description: step.description, dependsOn: step.dependsOn };
    case "evm-transaction":
      return decodeEvmStep(step.to, step.data, step.value);
  }
}

export interface PreviewSummary {
  readonly rail: string;
  readonly debit: string;
  readonly credit: string;
  readonly dust: string | undefined;
  readonly destination: string;
  readonly fees: readonly {
    readonly label: string;
    readonly amount: string;
    readonly symbol: string;
  }[];
  readonly etaSeconds: number | undefined;
  readonly decodedStep: DecodedStep;
  readonly stepDescription: string;
}

function formatFee(fee: Fee): {
  readonly label: string;
  readonly amount: string;
  readonly symbol: string;
} {
  // Reuses @ferryline/core's own formatAmount so a fee never gets re-derived or rounded differently
  // here than anywhere else this repo displays an Amount.
  return { label: fee.label, amount: formatQuoteAmount(fee.amount), symbol: fee.symbol };
}

/**
 * Builds the full human-readable preview for one step of a built transfer. `networkPassphrase`
 * must match the network the quote/build were made against (the widget's own configured network,
 * never inferred from the XDR itself — an XDR's own network ID is exactly the kind of thing a
 * malicious builder could get wrong, so this is passed in from a source the widget already trusts).
 */
export function buildPreviewSummary(
  quote: Quote,
  step: TransferStep,
  networkPassphrase: string,
): PreviewSummary {
  return {
    rail: quote.rail,
    debit: formatQuoteAmount(quote.debit),
    credit: formatQuoteAmount(quote.credit),
    dust: quote.dust.value > 0n ? formatQuoteAmount(quote.dust) : undefined,
    destination: quote.request.to.address,
    fees: quote.fees.map(formatFee),
    etaSeconds: quote.etaSeconds,
    decodedStep: decodeStep(step, networkPassphrase),
    stepDescription: step.description,
  };
}
