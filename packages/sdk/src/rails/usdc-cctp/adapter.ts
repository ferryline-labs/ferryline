import {
  FerrylineError,
  SHARED_DECIMALS,
  STELLAR_DECIMALS,
  contractAddressToBytes32,
  evmAddressToBytes32,
  formatAmount,
  formatStellarAddress,
  newTransferId,
  parseAmount,
  parseStellarAddress,
  scaleUp,
  toSharedDecimals,
  type Amount,
  type BuiltTransfer,
  type Fee,
  type PreflightCheck,
  type Quote,
  type RailAdapter,
  type TransferId,
  type TransferRecord,
  type TransferRequest,
  type TransferStatus,
  type TransferStep,
  type TransferStore,
} from "@ferryline/core";
import { Asset, type Account } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import { Buffer } from "buffer";

import { ERC20_ABI, EVM_ADDRESS, type EvmReader } from "../../evm/reader.js";
import { backoffDelay, sleep as defaultSleep, type SleepFn } from "../../util/backoff.js";
import {
  buildInvocation,
  getNativeBalance,
  getTrustline,
  type StellarRpc,
} from "../../stellar/rpc.js";
import {
  CCTP_STELLAR,
  FINALITY_FAST,
  FINALITY_STANDARD,
  cctpEvmChain,
  type CctpEvmChain,
  type CctpNetwork,
} from "./chains.js";
import {
  MESSAGE_TRANSMITTER_V2_ABI,
  encodeDepositForBurnWithHookToStellar,
  encodeErc20Approve,
} from "./evm.js";
import {
  attestationComplete,
  createIrisClient,
  feeFromBps,
  type IrisClient,
  type IrisMessage,
} from "./iris.js";
import { buildForwarderHookData, bytesToHex } from "./message.js";
import {
  approveScVals,
  contractPaused,
  depositForBurnScVals,
  minFeeAmount,
  nonceUsed,
  sacAllowance,
  sacBalance,
} from "./stellar.js";

/**
 * Rail-specific parameters. Both are REQUIRED on every request; Ferryline ships no defaults because
 * neither has been verified end to end by this repo (see the two experiment files named in the error).
 */
export interface CctpParameters {
  /** Maximum fee the sender accepts, as a decimal USDC string (e.g. "0" or "0.25"). */
  readonly maxFee: string;
  /** 1000 = Fast Transfer, 2000 = Standard Transfer. */
  readonly minFinalityThreshold: 1000 | 2000;
}

export const CCTP_PARAMETER_KEYS = ["maxFee", "minFinalityThreshold"] as const;

const MAX_FEE_UNIT_NOTE =
  " The unit of max_fee on the Stellar TokenMessengerMinter is unverified; Ferryline passes 7-decimal " +
  "units, and if that is wrong the burn reverts on Stellar with nothing burned rather than silently overcharging.";

const PARAMETERS_HELP =
  "usdc-cctp requires parameters.maxFee (decimal USDC string) and parameters.minFinalityThreshold (1000 or 2000) on every request. " +
  "Ferryline ships no defaults: neither value is verified end to end by this repo yet. " +
  "See packages/core/verified/experiments/2026-09-11-cctp-burn-max-fee-zero.md and packages/core/verified/experiments/2026-09-11-cctp-finality-threshold.md.";

export function readCctpParameters(request: TransferRequest): {
  maxFee: Amount;
  minFinalityThreshold: number;
} {
  const p = request.parameters;
  if (p?.["maxFee"] === undefined || p["minFinalityThreshold"] === undefined) {
    throw new FerrylineError("PARAMETER_REQUIRED", PARAMETERS_HELP);
  }
  const rawFee = p["maxFee"];
  if (typeof rawFee !== "string") {
    throw new FerrylineError(
      "PARAMETER_INVALID",
      `parameters.maxFee must be a decimal USDC string such as "0" or "0.25".${MAX_FEE_UNIT_NOTE}`,
    );
  }
  let maxFee: Amount;
  try {
    maxFee = parseAmount(rawFee, SHARED_DECIMALS);
  } catch (error) {
    throw new FerrylineError(
      "PARAMETER_INVALID",
      `parameters.maxFee is not a valid USDC amount: ${rawFee}.${MAX_FEE_UNIT_NOTE}`,
      { cause: error },
    );
  }
  const threshold = p["minFinalityThreshold"];
  if (threshold !== FINALITY_FAST && threshold !== FINALITY_STANDARD) {
    throw new FerrylineError(
      "PARAMETER_INVALID",
      `parameters.minFinalityThreshold must be ${String(FINALITY_FAST)} (fast) or ${String(FINALITY_STANDARD)} (standard)`,
    );
  }
  return { maxFee, minFinalityThreshold: threshold };
}

export interface UsdcCctpAdapterOptions {
  readonly network: CctpNetwork;
  readonly stellarRpc: StellarRpc;
  readonly store: TransferStore;
  readonly evmReaders?: Readonly<Partial<Record<string, EvmReader>>>;
  readonly iris?: IrisClient;
  /** G account used as transaction source for read-only simulations when the sender is a C address. Defaults to the USDC issuer. */
  readonly simulationSourceAccount?: string;
  /** G account that pays fees and sequences the transaction when the sender is a C address. */
  readonly feeSourceAccount?: string;
  readonly quoteTtlMs?: number;
  /** First polling delay for Iris and nonce checks; doubles each attempt. Default 5 s. */
  readonly pollIntervalMs?: number;
  /** Ceiling for the backoff. Default 60 s. */
  readonly pollMaxIntervalMs?: number;
  /** Injected in tests to record delays instead of waiting. */
  readonly sleep?: SleepFn;
  readonly now?: () => number;
  readonly newTransferId?: () => TransferId;
}

interface OutboundPrivate {
  readonly direction: "out";
  readonly sender: string;
  readonly senderKind: "account" | "contract";
  readonly dest: CctpEvmChain;
  /** 7-decimal amount actually burned (dust already removed). */
  readonly amount7: bigint;
  readonly maxFee7: bigint;
  readonly minFinalityThreshold: number;
  readonly mintRecipient: Uint8Array;
  readonly needsApprove: boolean;
}

interface InboundPrivate {
  readonly direction: "in";
  readonly source: CctpEvmChain;
  readonly sender: `0x${string}`;
  readonly recipient: string;
  readonly amount6: bigint;
  readonly maxFee6: bigint;
  readonly minFinalityThreshold: number;
  readonly needsApprove: boolean;
}

type PrivateQuote = OutboundPrivate | InboundPrivate;

/** Adapter-private record. Amounts as decimal strings so the record stays JSON-friendly. */
export interface CctpRailRef {
  readonly direction: "in" | "out";
  readonly sourceDomain: number;
  readonly destinationDomain: number;
  readonly sourceChain: string;
  readonly destinationChain: string;
  readonly burn?: {
    readonly caller: string;
    readonly amount7: string;
    readonly maxFee7: string;
    readonly minFinalityThreshold: number;
    readonly mintRecipient: `0x${string}`;
    readonly destinationCaller: `0x${string}`;
    readonly stepIndex: number;
  };
  readonly nonce?: `0x${string}`;
  readonly attestation?: string;
}

/** Anyone may submit receiveMessage on the destination when destinationCaller is all zeros. */
const ANY_CALLER = new Uint8Array(32);
const NATIVE_FEE_HEADROOM_STROOPS = 1_000_000n;
const APPROVE_LEDGER_WINDOW = 1_000;
const DEFAULT_QUOTE_TTL_MS = 60_000;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_POLL_MAX_MS = 60_000;

function check(
  id: PreflightCheck["id"],
  ok: boolean,
  message: string,
  remedy?: PreflightCheck["remedy"],
): PreflightCheck {
  return remedy === undefined ? { id, ok, message } : { id, ok, message, remedy };
}

function usdc7(value: bigint): Amount {
  return { value, decimals: STELLAR_DECIMALS };
}

function usdc6(value: bigint): Amount {
  return { value, decimals: SHARED_DECIMALS };
}

export class UsdcCctpAdapter implements RailAdapter {
  readonly rail = "usdc-cctp" as const;
  private readonly options: UsdcCctpAdapterOptions;
  private readonly cfg: (typeof CCTP_STELLAR)[CctpNetwork];
  private readonly iris: IrisClient;
  private readonly asset: Asset;
  private readonly quotes = new WeakMap<Quote, PrivateQuote>();

  constructor(options: UsdcCctpAdapterOptions) {
    this.options = options;
    this.cfg = CCTP_STELLAR[options.network];
    this.iris = options.iris ?? createIrisClient(this.cfg.irisBaseUrl);
    this.asset = new Asset("USDC", this.cfg.usdcIssuer);
  }

  supports(request: TransferRequest): boolean {
    if (request.asset !== "USDC") {
      return false;
    }
    const out =
      request.from.chain === "stellar" &&
      cctpEvmChain(this.options.network, request.to.chain) !== undefined;
    const inbound =
      request.to.chain === "stellar" &&
      cctpEvmChain(this.options.network, request.from.chain) !== undefined;
    return out || inbound;
  }

  async quote(request: TransferRequest): Promise<Quote> {
    if (!this.supports(request)) {
      throw new FerrylineError(
        "ROUTE_UNSUPPORTED",
        `usdc-cctp (${this.options.network}) does not serve ${request.from.chain} -> ${request.to.chain}`,
      );
    }
    // Required rail parameters are checked before any network call so the caller learns fast.
    const params = readCctpParameters(request);
    return request.from.chain === "stellar"
      ? this.quoteOutbound(request, params)
      : this.quoteInbound(request, params);
  }

  async build(quote: Quote): Promise<BuiltTransfer> {
    const priv = this.quotes.get(quote);
    if (!priv) {
      throw new FerrylineError(
        "ROUTE_UNSUPPORTED",
        "quote was not produced by this adapter instance",
      );
    }
    if (this.now() > quote.expiresAt) {
      throw new FerrylineError("QUOTE_EXPIRED", "quote expired; request a new one");
    }
    const failed = quote.checks.filter((c) => !c.ok).map((c) => c.id);
    if (failed.length > 0) {
      throw new FerrylineError(
        "PREFLIGHT_FAILED",
        `refusing to build: failed checks ${failed.join(", ")}`,
      );
    }
    // Re-validated at build time as well: a tampered quote must not slip a default in.
    readCctpParameters(quote.request);
    return priv.direction === "out"
      ? this.buildOutbound(quote, priv)
      : this.buildInbound(quote, priv);
  }

  async prepareStep(transferId: TransferId, stepIndex: number): Promise<TransferStep> {
    const record = await this.record(transferId);
    const ref = record.railRef as CctpRailRef;
    const burn = ref.direction === "out" ? ref.burn : undefined;
    if (burn?.stepIndex !== stepIndex) {
      throw new FerrylineError(
        "STEP_NOT_READY",
        `step ${String(stepIndex)} of ${transferId} is not a deferred step`,
      );
    }
    const amount7 = BigInt(burn.amount7);
    const source = await this.sourceAccountFor(burn.caller);
    const allowance = await sacAllowance(
      this.ctx(source),
      this.cfg.usdcSac,
      burn.caller,
      this.cfg.tokenMessengerMinter,
    );
    if (allowance < amount7) {
      throw new FerrylineError(
        "ALLOWANCE_INSUFFICIENT",
        `the TokenMessengerMinter may spend ${formatAmount(usdc7(allowance))} USDC of ${burn.caller} but the burn needs ${formatAmount(usdc7(amount7))}; submit the approve step and wait for it to confirm before preparing the burn`,
      );
    }
    return this.buildBurnStep(
      source,
      {
        caller: burn.caller,
        amount: amount7,
        destinationDomain: ref.destinationDomain,
        mintRecipient: new Uint8Array(Buffer.from(burn.mintRecipient.slice(2), "hex")),
        burnToken: this.cfg.usdcSac,
        destinationCaller: new Uint8Array(Buffer.from(burn.destinationCaller.slice(2), "hex")),
        maxFee: BigInt(burn.maxFee7),
        minFinalityThreshold: burn.minFinalityThreshold,
      },
      ref.destinationChain,
    );
  }

  async *track(transferId: TransferId, signal?: AbortSignal): AsyncIterable<TransferStatus> {
    const record = await this.record(transferId);
    const ref = record.railRef as CctpRailRef;
    let sourceTxHash = record.sourceTxHash;
    if (sourceTxHash === undefined) {
      yield { transferId, stage: "created", updatedAt: this.now() };
      while (sourceTxHash === undefined) {
        await this.sleep(this.pollMs(), signal);
        sourceTxHash = (await this.options.store.get(transferId))?.sourceTxHash;
      }
    }
    if (ref.direction === "out") {
      for (;;) {
        const tx = await this.options.stellarRpc.getTransaction(sourceTxHash);
        if (tx.status === Api.GetTransactionStatus.FAILED) {
          yield {
            transferId,
            stage: "failed",
            updatedAt: this.now(),
            sourceTxHash,
            failure: {
              code: "SOURCE_TX_FAILED",
              message: "Stellar burn transaction failed",
              retryable: false,
            },
          };
          return;
        }
        if (tx.status === Api.GetTransactionStatus.SUCCESS) {
          break;
        }
        await this.sleep(this.pollMs(), signal);
      }
    }
    yield {
      transferId,
      stage: "submitted",
      updatedAt: this.now(),
      sourceTxHash,
      detail: "burn submitted; awaiting Circle attestation",
    };

    // Attestation: Iris by source transaction hash. 404 means not indexed yet.
    let message: IrisMessage | undefined;
    let lastDetail = "";
    for (let attempt = 0; ; attempt += 1) {
      const messages = await this.iris.messagesByTx(ref.sourceDomain, sourceTxHash);
      message = messages[0];
      if (message && attestationComplete(message)) {
        break;
      }
      const detail = message
        ? `Iris status: ${message.status}${message.delayReason ? ` (delayReason ${message.delayReason})` : ""}`
        : "awaiting Circle attestation (Iris has not indexed the burn yet)";
      if (detail !== lastDetail) {
        lastDetail = detail;
        yield { transferId, stage: "submitted", updatedAt: this.now(), sourceTxHash, detail };
      }
      await this.sleep(this.backoff(attempt), signal);
    }
    const nonce = message.eventNonce as `0x${string}`;
    await this.options.store.put({
      ...record,
      sourceTxHash,
      railRef: { ...ref, nonce, attestation: message.attestation },
    });
    yield {
      transferId,
      stage: "verified",
      updatedAt: this.now(),
      sourceTxHash,
      detail: `Circle attestation complete for nonce ${nonce}`,
    };

    // Delivery: has the destination MessageTransmitter consumed the nonce?
    if (ref.direction === "out") {
      const dest = cctpEvmChain(this.options.network, ref.destinationChain);
      const reader = dest ? this.options.evmReaders?.[dest.chain] : undefined;
      if (!dest || !reader) {
        yield {
          transferId,
          stage: "verified",
          updatedAt: this.now(),
          sourceTxHash,
          detail: "no EVM reader configured for the destination; cannot confirm the mint",
        };
        return;
      }
      for (let attempt = 0; ; attempt += 1) {
        const used = (await reader.readContract({
          address: dest.messageTransmitterV2,
          abi: MESSAGE_TRANSMITTER_V2_ABI,
          functionName: "usedNonces",
          args: [nonce],
        })) as bigint;
        if (used !== 0n) {
          yield {
            transferId,
            stage: "delivered",
            updatedAt: this.now(),
            sourceTxHash,
            detail: `nonce consumed on ${dest.chain}`,
          };
          return;
        }
        await this.sleep(this.backoff(attempt), signal);
      }
    }
    const source = await this.sourceAccountFor(undefined);
    for (let attempt = 0; ; attempt += 1) {
      const used = await nonceUsed(
        this.ctx(source),
        this.cfg.messageTransmitter,
        new Uint8Array(Buffer.from(nonce.slice(2), "hex")),
      );
      if (used) {
        yield {
          transferId,
          stage: "delivered",
          updatedAt: this.now(),
          sourceTxHash,
          detail: "mint_and_forward executed on Stellar",
        };
        return;
      }
      await this.sleep(this.backoff(attempt), signal);
    }
  }

  // ---------------------------------------------------------------- outbound: Stellar -> EVM

  private async quoteOutbound(
    request: TransferRequest,
    params: { maxFee: Amount; minFinalityThreshold: number },
  ): Promise<Quote> {
    const dest = cctpEvmChain(this.options.network, request.to.chain);
    if (!dest) {
      throw new FerrylineError(
        "ROUTE_UNSUPPORTED",
        `no CCTP deployment known for ${request.to.chain} on ${this.options.network}`,
      );
    }
    const checks: PreflightCheck[] = [];
    const sender = parseStellarAddress(request.from.address);
    checks.push(
      check(
        "sender-format",
        sender.kind !== "muxed",
        sender.kind === "muxed"
          ? "a muxed (M…) address cannot sign; use the underlying G account"
          : `${sender.kind} sender`,
      ),
    );
    const recipientOk = EVM_ADDRESS.test(request.to.address);
    checks.push(
      check(
        "recipient-format",
        recipientOk,
        recipientOk ? "EVM address" : "recipient must be a 0x-prefixed 20-byte hex address",
      ),
    );
    const refundAddress = this.resolveStellarRefund(request);

    const requested = parseAmount(request.amount, STELLAR_DECIMALS);
    const { amount: amount6, dust } = toSharedDecimals(requested);
    const amount7 = scaleUp(amount6, STELLAR_DECIMALS).value;
    const maxFee6 = params.maxFee.value;
    const maxFee7 = scaleUp(params.maxFee, STELLAR_DECIMALS).value;

    const source = await this.sourceAccountFor(
      sender.kind === "account" ? request.from.address : undefined,
    );
    const ctx = this.ctx(source);
    const paused =
      (await contractPaused(ctx, this.cfg.tokenMessengerMinter)) ||
      (await contractPaused(ctx, this.cfg.messageTransmitter));
    checks.push(
      check(
        "rail-paused",
        !paused,
        paused ? "CCTP on Stellar is paused" : "CCTP contracts not paused",
      ),
    );

    const feeRows = await this.iris.fees(this.cfg.domain, dest.domain);
    const row = feeRows.find((r) => r.finalityThreshold === params.minFinalityThreshold);
    const expectedFee6 = row ? feeFromBps(amount6.value, row.minimumFee) : undefined;
    const onChainMinFee7 = await minFeeAmount(
      ctx,
      this.cfg.tokenMessengerMinter,
      this.cfg.usdcSac,
      amount7,
    );
    const feeOk =
      expectedFee6 !== undefined && maxFee6 >= expectedFee6 && maxFee7 >= onChainMinFee7;
    checks.push(
      check(
        "route-limits",
        feeOk,
        row === undefined
          ? `Circle lists no fee row for finality threshold ${String(params.minFinalityThreshold)} on domain ${String(this.cfg.domain)} -> ${String(dest.domain)}`
          : feeOk
            ? `Circle minimum fee ${String(row.minimumFee)} bps = ${formatAmount(usdc6(expectedFee6 ?? 0n))} USDC; on-chain minimum ${formatAmount(usdc7(onChainMinFee7))} USDC; maxFee ${formatAmount(params.maxFee)} covers both`
            : `maxFee ${formatAmount(params.maxFee)} USDC is below the minimum for this route (Circle ${formatAmount(usdc6(expectedFee6 ?? 0n))}, on-chain ${formatAmount(usdc7(onChainMinFee7))})`,
      ),
    );

    let needsApprove = true;
    if (sender.kind === "account") {
      const trustline = await getTrustline(
        this.options.stellarRpc,
        request.from.address,
        this.asset,
      );
      checks.push(
        check(
          "sender-trustline",
          trustline !== undefined,
          trustline ? "USDC trustline present" : "sender holds no USDC trustline",
          trustline ? undefined : { kind: "add-trustline", asset: "USDC" },
        ),
      );
      const balance = trustline?.balance ?? 0n;
      checks.push(
        check(
          "sender-asset-balance",
          balance >= amount7,
          `USDC balance ${formatAmount(usdc7(balance))}`,
        ),
      );
      const native = (await getNativeBalance(this.options.stellarRpc, request.from.address)) ?? 0n;
      checks.push(
        check(
          "sender-native-balance",
          native >= NATIVE_FEE_HEADROOM_STROOPS,
          `XLM balance ${formatAmount({ value: native, decimals: 7 })}; two Soroban transactions need roughly ${formatAmount({ value: NATIVE_FEE_HEADROOM_STROOPS, decimals: 7 })} XLM`,
          native >= NATIVE_FEE_HEADROOM_STROOPS
            ? undefined
            : {
                kind: "fund-native",
                minimum: { value: NATIVE_FEE_HEADROOM_STROOPS - native, decimals: 7 },
                symbol: "XLM",
              },
        ),
      );
    } else if (sender.kind === "contract") {
      const balance = await sacBalance(ctx, this.cfg.usdcSac, request.from.address);
      checks.push(
        check(
          "sender-asset-balance",
          balance >= amount7,
          `USDC balance ${formatAmount(usdc7(balance))}`,
        ),
      );
      const feeSource = this.options.feeSourceAccount;
      checks.push(
        check(
          "sender-native-balance",
          feeSource !== undefined,
          feeSource !== undefined
            ? `fees paid by ${feeSource}`
            : "a C-address sender needs feeSourceAccount configured to pay XLM fees",
        ),
      );
    }
    if (sender.kind !== "muxed") {
      const allowance = await sacAllowance(
        ctx,
        this.cfg.usdcSac,
        request.from.address,
        this.cfg.tokenMessengerMinter,
      );
      needsApprove = allowance < amount7;
    }

    const fees: Fee[] = [
      {
        label: `Circle transfer fee (expected; capped by maxFee ${formatAmount(params.maxFee)})`,
        amount: usdc6(expectedFee6 ?? 0n),
        symbol: "USDC",
      },
    ];
    const quote: Quote = {
      rail: this.rail,
      request,
      debit: usdc7(amount7),
      credit: usdc6(amount6.value - (expectedFee6 ?? 0n)),
      dust,
      fees,
      checks,
      expiresAt: this.now() + (this.options.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS),
      refundAddress,
    };
    if (sender.kind !== "muxed" && recipientOk) {
      this.quotes.set(quote, {
        direction: "out",
        sender: request.from.address,
        senderKind: sender.kind,
        dest,
        amount7,
        maxFee7,
        minFinalityThreshold: params.minFinalityThreshold,
        mintRecipient: evmAddressToBytes32(request.to.address),
        needsApprove,
      });
    }
    return quote;
  }

  private async buildOutbound(quote: Quote, priv: OutboundPrivate): Promise<BuiltTransfer> {
    const transferId = this.newTransferId();
    const source = await this.sourceAccountFor(
      priv.senderKind === "account" ? priv.sender : undefined,
      true,
    );
    const steps: TransferStep[] = [];
    const burnArgs = {
      caller: priv.sender,
      amount: priv.amount7,
      destinationDomain: priv.dest.domain,
      mintRecipient: priv.mintRecipient,
      burnToken: this.cfg.usdcSac,
      destinationCaller: ANY_CALLER,
      maxFee: priv.maxFee7,
      minFinalityThreshold: priv.minFinalityThreshold,
    };
    if (priv.needsApprove) {
      // The burn pulls USDC with transfer_from (VERIFIED.md §3b), so the TokenMessengerMinter needs an
      // allowance first. The burn's own footprint cannot be simulated until that allowance exists on
      // chain, which is why step 1 is deferred and assembled by prepareStep() after step 0 confirms.
      const latest = await this.options.stellarRpc.getLatestLedger();
      const approve = await buildInvocation({
        rpc: this.options.stellarRpc,
        source,
        networkPassphrase: this.cfg.networkPassphrase,
        contractId: this.cfg.usdcSac,
        fn: "approve",
        args: approveScVals(
          priv.sender,
          this.cfg.tokenMessengerMinter,
          priv.amount7,
          latest.sequence + APPROVE_LEDGER_WINDOW,
        ),
      });
      steps.push({
        chain: "stellar",
        kind: "stellar-transaction",
        xdr: approve.xdr,
        description: `Approve the TokenMessengerMinter to spend ${formatAmount(quote.debit)} USDC`,
      });
      steps.push({
        chain: "stellar",
        kind: "stellar-transaction-deferred",
        dependsOn: 0,
        description: `Burn ${formatAmount(quote.debit)} USDC toward ${priv.dest.chain} via CCTP (prepare after the approve confirms)`,
      });
    } else {
      steps.push(await this.buildBurnStep(source, burnArgs, priv.dest.chain));
    }
    const railRef: CctpRailRef = {
      direction: "out",
      sourceDomain: this.cfg.domain,
      destinationDomain: priv.dest.domain,
      sourceChain: "stellar",
      destinationChain: priv.dest.chain,
      burn: {
        caller: priv.sender,
        amount7: priv.amount7.toString(),
        maxFee7: priv.maxFee7.toString(),
        minFinalityThreshold: priv.minFinalityThreshold,
        mintRecipient: bytesToHex(priv.mintRecipient),
        destinationCaller: bytesToHex(ANY_CALLER),
        stepIndex: steps.length - 1,
      },
    };
    await this.options.store.put({
      transferId,
      rail: this.rail,
      request: quote.request,
      createdAt: this.now(),
      railRef,
    });
    return { transferId, rail: this.rail, steps };
  }

  private async buildBurnStep(
    source: Account,
    args: Parameters<typeof depositForBurnScVals>[0],
    destinationChain: string,
  ): Promise<TransferStep> {
    // NO memo: this is a Soroban InvokeHostFunctionOp, and Soroban transactions can never carry a
    // memo (confirmed with a real testnet RPC rejection during widget-phase STEP 1 seam-proofing —
    // "Transaction contains a memo. Soroban transactions do not support memos." — every real
    // outbound burn failed at simulation until this was removed). Correlation with `transferId`
    // does not need a memo: `track()` above reads `sourceTxHash` from `this.options.store`, which
    // the caller populates via `Ferryline.markSubmitted(transferId, sourceTxHash)` after signing
    // and submitting — the real, already-existing mechanism, not the on-chain memo.
    const burn = await buildInvocation({
      rpc: this.options.stellarRpc,
      source,
      networkPassphrase: this.cfg.networkPassphrase,
      contractId: this.cfg.tokenMessengerMinter,
      fn: "deposit_for_burn",
      args: depositForBurnScVals(args),
    });
    return {
      chain: "stellar",
      kind: "stellar-transaction",
      xdr: burn.xdr,
      description: `Burn ${formatAmount(usdc7(args.amount))} USDC toward ${destinationChain} via CCTP`,
    };
  }

  // ---------------------------------------------------------------- inbound: EVM -> Stellar

  private async quoteInbound(
    request: TransferRequest,
    params: { maxFee: Amount; minFinalityThreshold: number },
  ): Promise<Quote> {
    const source = cctpEvmChain(this.options.network, request.from.chain);
    if (!source) {
      throw new FerrylineError(
        "ROUTE_UNSUPPORTED",
        `no CCTP deployment known for ${request.from.chain} on ${this.options.network}`,
      );
    }
    const reader = this.options.evmReaders?.[source.chain];
    if (!reader) {
      throw new FerrylineError(
        "ROUTE_UNSUPPORTED",
        `no EVM reader configured for ${source.chain}; pass evmReaders`,
      );
    }
    const checks: PreflightCheck[] = [];
    // The forwarder delivers to G, C and M recipients (it emits MuxedAddress). G observed on mainnet.
    const recipient = parseStellarAddress(request.to.address);
    checks.push(check("recipient-format", true, `${recipient.kind} recipient via CctpForwarder`));
    const senderOk = EVM_ADDRESS.test(request.from.address);
    checks.push(
      check(
        "sender-format",
        senderOk,
        senderOk ? "EVM address" : "sender must be a 0x-prefixed 20-byte hex address",
      ),
    );
    const refundAddress = this.resolveEvmRefund(request);

    if (recipient.kind !== "contract") {
      // The forwarder's final transfer lands on a classic account, which needs a trustline. A
      // contract recipient holds SAC balances in contract storage and has no trustline to check.
      const accountId =
        recipient.kind === "muxed"
          ? formatStellarAddress({ kind: "account", key: recipient.key })
          : request.to.address;
      const trustline = await getTrustline(this.options.stellarRpc, accountId, this.asset);
      checks.push(
        check(
          "recipient-trustline",
          trustline !== undefined,
          trustline
            ? "recipient holds a USDC trustline"
            : "recipient has no USDC trustline; the forwarder's transfer would fail",
          trustline ? undefined : { kind: "add-trustline", asset: "USDC" },
        ),
      );
    }

    const amount = parseAmount(request.amount, source.decimals);
    const feeRows = await this.iris.fees(source.domain, this.cfg.domain);
    const row = feeRows.find((r) => r.finalityThreshold === params.minFinalityThreshold);
    const expectedFee6 = row ? feeFromBps(amount.value, row.minimumFee) : undefined;
    const feeOk = expectedFee6 !== undefined && params.maxFee.value >= expectedFee6;
    checks.push(
      check(
        "route-limits",
        feeOk,
        row === undefined
          ? `Circle lists no fee row for finality threshold ${String(params.minFinalityThreshold)} on domain ${String(source.domain)} -> ${String(this.cfg.domain)}`
          : feeOk
            ? `Circle minimum fee ${String(row.minimumFee)} bps = ${formatAmount(usdc6(expectedFee6 ?? 0n))} USDC; maxFee ${formatAmount(params.maxFee)} covers it`
            : `maxFee ${formatAmount(params.maxFee)} USDC is below Circle's minimum ${formatAmount(usdc6(expectedFee6 ?? 0n))} for this route`,
      ),
    );

    let needsApprove = true;
    if (senderOk) {
      const sender = request.from.address as `0x${string}`;
      const balance = (await reader.readContract({
        address: source.usdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [sender],
      })) as bigint;
      checks.push(
        check(
          "sender-asset-balance",
          balance >= amount.value,
          `USDC balance ${formatAmount(usdc6(balance))}`,
        ),
      );
      const allowance = (await reader.readContract({
        address: source.usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [sender, source.tokenMessengerV2],
      })) as bigint;
      needsApprove = allowance < amount.value;
      const native = await reader.getBalance({ address: sender });
      checks.push(
        check(
          "sender-native-balance",
          native > 0n,
          native > 0n
            ? `native balance ${native.toString()} wei (gas not estimated)`
            : "sender has no native balance for gas",
        ),
      );
    }

    const quote: Quote = {
      rail: this.rail,
      request,
      debit: amount,
      credit: usdc7((amount.value - (expectedFee6 ?? 0n)) * 10n),
      dust: usdc6(0n),
      fees: [
        {
          label: `Circle transfer fee (expected; capped by maxFee ${formatAmount(params.maxFee)})`,
          amount: usdc6(expectedFee6 ?? 0n),
          symbol: "USDC",
        },
      ],
      checks,
      expiresAt: this.now() + (this.options.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS),
      refundAddress,
    };
    if (senderOk) {
      this.quotes.set(quote, {
        direction: "in",
        source,
        sender: request.from.address as `0x${string}`,
        recipient: request.to.address,
        amount6: amount.value,
        maxFee6: params.maxFee.value,
        minFinalityThreshold: params.minFinalityThreshold,
        needsApprove,
      });
    }
    return quote;
  }

  private async buildInbound(quote: Quote, priv: InboundPrivate): Promise<BuiltTransfer> {
    const transferId = this.newTransferId();
    const forwarder = contractAddressToBytes32(this.cfg.cctpForwarder);
    const steps: TransferStep[] = [];
    if (priv.needsApprove) {
      steps.push({
        chain: priv.source.chain,
        kind: "evm-transaction",
        to: priv.source.usdc,
        data: encodeErc20Approve(priv.source.tokenMessengerV2, priv.amount6),
        value: 0n,
        description: `Approve TokenMessengerV2 to spend ${formatAmount(quote.debit)} USDC`,
      });
    }
    steps.push({
      chain: priv.source.chain,
      kind: "evm-transaction",
      to: priv.source.tokenMessengerV2,
      data: encodeDepositForBurnWithHookToStellar(
        {
          amount: priv.amount6,
          destinationDomain: this.cfg.domain,
          mintRecipient: forwarder,
          burnToken: priv.source.usdc,
          destinationCaller: forwarder,
          maxFee: priv.maxFee6,
          minFinalityThreshold: priv.minFinalityThreshold,
          hookData: buildForwarderHookData(priv.recipient),
        },
        this.cfg.cctpForwarder,
      ),
      value: 0n,
      description: `Burn ${formatAmount(quote.debit)} USDC toward Stellar recipient ${priv.recipient} via CctpForwarder`,
    });
    const railRef: CctpRailRef = {
      direction: "in",
      sourceDomain: priv.source.domain,
      destinationDomain: this.cfg.domain,
      sourceChain: priv.source.chain,
      destinationChain: "stellar",
    };
    await this.options.store.put({
      transferId,
      rail: this.rail,
      request: quote.request,
      createdAt: this.now(),
      railRef,
    });
    return { transferId, rail: this.rail, steps };
  }

  // ---------------------------------------------------------------- helpers

  private async record(transferId: TransferId): Promise<TransferRecord> {
    const record = await this.options.store.get(transferId);
    if (record?.rail !== this.rail) {
      throw new FerrylineError("TRANSFER_UNKNOWN", `no usdc-cctp transfer with id ${transferId}`);
    }
    return record;
  }

  private resolveStellarRefund(request: TransferRequest): string {
    const sender = parseStellarAddress(request.from.address);
    const defaultRefund =
      sender.kind === "muxed"
        ? formatStellarAddress({ kind: "account", key: sender.key })
        : request.from.address;
    const candidate = request.refundAddress ?? defaultRefund;
    let parsed: ReturnType<typeof parseStellarAddress>;
    try {
      parsed = parseStellarAddress(candidate);
    } catch (error) {
      throw new FerrylineError(
        "REFUND_ADDRESS_INVALID",
        "refund address is not a valid Stellar address",
        { cause: error },
      );
    }
    if (parsed.kind === "muxed") {
      throw new FerrylineError(
        "REFUND_ADDRESS_INVALID",
        "refund address must be a G or C address, not a muxed M address",
      );
    }
    return candidate;
  }

  private resolveEvmRefund(request: TransferRequest): string {
    const candidate = request.refundAddress ?? request.from.address;
    if (!EVM_ADDRESS.test(candidate)) {
      throw new FerrylineError(
        "REFUND_ADDRESS_INVALID",
        "refund address must be a 0x-prefixed 20-byte hex address",
      );
    }
    return candidate;
  }

  /**
   * Transaction source for simulations, or for signing when `forBuild` is set. A G sender is its own
   * source. A C sender needs `feeSourceAccount` to build; simulations fall back to a public account.
   */
  private async sourceAccountFor(sender: string | undefined, forBuild = false): Promise<Account> {
    if (sender !== undefined && parseStellarAddress(sender).kind === "account") {
      return this.options.stellarRpc.getAccount(sender);
    }
    if (forBuild) {
      const feeSource = this.options.feeSourceAccount;
      if (feeSource === undefined) {
        throw new FerrylineError(
          "FEE_SOURCE_REQUIRED",
          "a C-address sender needs feeSourceAccount to sequence and pay for the transaction",
        );
      }
      return this.options.stellarRpc.getAccount(feeSource);
    }
    return this.options.stellarRpc.getAccount(
      this.options.simulationSourceAccount ?? this.cfg.usdcIssuer,
    );
  }

  private ctx(source: Account): { rpc: StellarRpc; source: Account; networkPassphrase: string } {
    return { rpc: this.options.stellarRpc, source, networkPassphrase: this.cfg.networkPassphrase };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private pollMs(): number {
    return this.options.pollIntervalMs ?? DEFAULT_POLL_MS;
  }

  private backoff(attempt: number): number {
    return backoffDelay(attempt, {
      initialMs: this.pollMs(),
      maxMs: this.options.pollMaxIntervalMs ?? DEFAULT_POLL_MAX_MS,
    });
  }

  private get sleep(): SleepFn {
    return this.options.sleep ?? defaultSleep;
  }

  private newTransferId(): TransferId {
    return (this.options.newTransferId ?? newTransferId)();
  }
}
