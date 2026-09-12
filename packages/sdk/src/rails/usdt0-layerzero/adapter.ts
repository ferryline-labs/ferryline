import {
  FerrylineError,
  SHARED_DECIMALS,
  STELLAR_DECIMALS,
  accountAddressToBytes32,
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
  type TransferRequest,
  type TransferStatus,
  type TransferStep,
  type TransferStore,
} from "@ferryline/core";
import { Address, Asset, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import type { Account } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { Api } from "@stellar/stellar-sdk/rpc";
import type { Spec } from "@stellar/stellar-sdk/contract";

import { USDT0_STELLAR_MAINNET, evmUsdt0Chain, type EvmUsdt0Chain } from "./chains.js";
import {
  ERC20_ABI,
  EVM_ADDRESS,
  encodeApprove,
  encodeSend,
  quoteOftOnEvm,
  quoteSendOnEvm,
  type EvmReader,
} from "./evm.js";
import {
  Client as OftClient,
  type MessagingFee,
  type OFTFeeDetail,
  type OFTLimit,
  type OFTReceipt,
  type SendParam,
} from "./generated/oft.js";
import { createScanClient, stageFromScanStatus, type ScanClient } from "./scan.js";
import {
  buildInvocation,
  getNativeBalance,
  getTrustline,
  simulateView,
  type StellarRpc,
} from "../../stellar/rpc.js";

export interface Usdt0AdapterOptions {
  /** USDT0 exists on Stellar mainnet only (checked 2026-09-11). */
  readonly network: "mainnet";
  readonly stellarRpc: StellarRpc;
  readonly store: TransferStore;
  /** Needed for inbound (EVM -> Stellar) quotes and builds, keyed by chain slug. */
  readonly evmReaders?: Readonly<Partial<Record<string, EvmReader>>>;
  readonly scan?: ScanClient;
  /**
   * G account used as the transaction source for read-only simulations when the sender is a
   * C-address smart account (a contract cannot be a transaction source). Defaults to the USDT0 issuer.
   */
  readonly simulationSourceAccount?: string;
  /** G account that pays fees and sequences the transaction when the sender is a C address. */
  readonly feeSourceAccount?: string;
  readonly quoteTtlMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly newTransferId?: () => TransferId;
}

interface OutboundPrivate {
  readonly direction: "out";
  readonly sender: string;
  readonly senderKind: "account" | "contract";
  readonly dest: EvmUsdt0Chain;
  readonly sendParam: SendParam;
  readonly fee: MessagingFee;
  readonly approvalRequired: boolean;
}

interface InboundPrivate {
  readonly direction: "in";
  readonly source: EvmUsdt0Chain;
  readonly sender: `0x${string}`;
  readonly recipient: string;
  readonly sendParam: { dstEid: number; to: `0x${string}`; amountLD: bigint; minAmountLD: bigint };
  readonly fee: { nativeFee: bigint; lzTokenFee: bigint };
}

type PrivateQuote = OutboundPrivate | InboundPrivate;

interface RailRef {
  readonly direction: "in" | "out";
  readonly srcEid: number;
  readonly dstEid: number;
  /** LayerZero message GUID (0x hex), known once the source transaction has executed. */
  readonly guid?: string;
}

/**
 * Observed on mainnet 2026-09-04: two Stellar -> Polygon sends took 1834 s and 1838 s from source
 * ledger close to executor confirmation (packages/core/verified/experiments/evidence/layerzero-scan.*.json).
 */
const OBSERVED_ETA_SECONDS = 1900;
/** XLM kept aside for the Soroban transaction fee on top of the LayerZero native fee. */
const NATIVE_FEE_HEADROOM_STROOPS = 1_000_000n;
const APPROVE_LEDGER_WINDOW = 1_000;
const DEFAULT_QUOTE_TTL_MS = 60_000;
const DEFAULT_POLL_MS = 5_000;

function check(
  id: PreflightCheck["id"],
  ok: boolean,
  message: string,
  remedy?: PreflightCheck["remedy"],
): PreflightCheck {
  return remedy === undefined ? { id, ok, message } : { id, ok, message, remedy };
}

function xlm(stroops: bigint): Amount {
  return { value: stroops, decimals: STELLAR_DECIMALS };
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

export class Usdt0LayerZeroAdapter implements RailAdapter {
  readonly rail = "usdt0-layerzero" as const;
  private readonly options: Usdt0AdapterOptions;
  private readonly spec: Spec;
  private readonly scan: ScanClient;
  private readonly asset: Asset;
  private readonly quotes = new WeakMap<Quote, PrivateQuote>();

  constructor(options: Usdt0AdapterOptions) {
    if (options.network !== "mainnet") {
      throw new FerrylineError(
        "ROUTE_UNSUPPORTED",
        "USDT0 has no Stellar testnet deployment (checked 2026-09-11)",
      );
    }
    this.options = options;
    this.spec = new OftClient({
      contractId: USDT0_STELLAR_MAINNET.oft,
      networkPassphrase: USDT0_STELLAR_MAINNET.networkPassphrase,
      rpcUrl: "https://unused.invalid",
    }).spec;
    this.scan = options.scan ?? createScanClient();
    this.asset = new Asset(USDT0_STELLAR_MAINNET.assetCode, USDT0_STELLAR_MAINNET.issuer);
  }

  supports(request: TransferRequest): boolean {
    if (request.asset !== "USDT0") {
      return false;
    }
    const out = request.from.chain === "stellar" && evmUsdt0Chain(request.to.chain) !== undefined;
    const inbound =
      request.to.chain === "stellar" && evmUsdt0Chain(request.from.chain) !== undefined;
    return out || inbound;
  }

  async quote(request: TransferRequest): Promise<Quote> {
    if (!this.supports(request)) {
      throw new FerrylineError(
        "ROUTE_UNSUPPORTED",
        `usdt0-layerzero does not serve ${request.from.chain} -> ${request.to.chain}`,
      );
    }
    return request.from.chain === "stellar"
      ? this.quoteOutbound(request)
      : this.quoteInbound(request);
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
    return priv.direction === "out"
      ? this.buildOutbound(quote, priv)
      : this.buildInbound(quote, priv);
  }

  async *track(transferId: TransferId, signal?: AbortSignal): AsyncIterable<TransferStatus> {
    const record = await this.options.store.get(transferId);
    if (record?.rail !== this.rail) {
      throw new FerrylineError(
        "TRANSFER_UNKNOWN",
        `no usdt0-layerzero transfer with id ${transferId}`,
      );
    }
    const ref = record.railRef as RailRef;
    let sourceTxHash = record.sourceTxHash;
    if (sourceTxHash === undefined) {
      yield { transferId, stage: "created", updatedAt: this.now() };
      while (sourceTxHash === undefined) {
        await sleep(this.pollMs(), signal);
        sourceTxHash = (await this.options.store.get(transferId))?.sourceTxHash;
      }
    }

    let guid = ref.guid;
    if (ref.direction === "out") {
      // Wait for the Stellar transaction, then read the GUID out of send()'s return value.
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
              message: "Stellar transaction failed",
              retryable: false,
            },
          };
          return;
        }
        if (tx.status === Api.GetTransactionStatus.SUCCESS) {
          if (tx.returnValue) {
            const [receipt] = this.spec.funcResToNative("send", tx.returnValue) as [
              { guid: Buffer },
              OFTReceipt,
            ];
            guid = bytesToHex(receipt.guid);
            await this.options.store.put({ ...record, sourceTxHash, railRef: { ...ref, guid } });
          }
          break;
        }
        await sleep(this.pollMs(), signal);
      }
    }
    yield {
      transferId,
      stage: "submitted",
      updatedAt: this.now(),
      sourceTxHash,
      ...(guid === undefined ? {} : { detail: `LayerZero GUID ${guid}` }),
    };

    let last: TransferStatus["stage"] = "submitted";
    for (;;) {
      const messages = await this.scan.messagesByTx(sourceTxHash);
      const wanted = guid?.toLowerCase();
      const message =
        wanted === undefined
          ? messages[0]
          : (messages.find((m) => m.guid.toLowerCase() === wanted) ?? messages[0]);
      if (message) {
        const mapped = stageFromScanStatus(message.status.name);
        const destinationTxHash = message.destination?.tx?.txHash;
        if (mapped.stage !== last || mapped.terminal) {
          last = mapped.stage;
          yield {
            transferId,
            stage: mapped.stage,
            updatedAt: this.now(),
            sourceTxHash,
            detail: `LayerZero Scan: ${message.status.name}${message.status.message ? ` (${message.status.message})` : ""}`,
            ...(destinationTxHash === undefined ? {} : { destinationTxHash }),
            ...(mapped.stage === "failed"
              ? {
                  failure: {
                    code: `LAYERZERO_${message.status.name}`,
                    message: message.status.message ?? message.status.name,
                    retryable: mapped.retryable,
                  },
                }
              : {}),
          };
        }
        if (mapped.terminal) {
          return;
        }
      }
      await sleep(this.pollMs(), signal);
    }
  }

  // ---------------------------------------------------------------- outbound: Stellar -> EVM

  private async quoteOutbound(request: TransferRequest): Promise<Quote> {
    const dest = evmUsdt0Chain(request.to.chain);
    if (!dest) {
      throw new FerrylineError(
        "ROUTE_UNSUPPORTED",
        `no USDT0 deployment known for ${request.to.chain}`,
      );
    }
    const checks: PreflightCheck[] = [];
    const sender = parseStellarAddress(request.from.address);
    if (sender.kind === "muxed") {
      checks.push(
        check(
          "sender-format",
          false,
          "a muxed (M…) address cannot sign; use the underlying G account",
        ),
      );
    } else {
      checks.push(check("sender-format", true, `${sender.kind} sender`));
    }
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
    const { amount: shared, dust } = toSharedDecimals(requested);
    const amountLd = scaleUp(shared, STELLAR_DECIMALS).value;
    const sendParamForQuote: SendParam = {
      amount_ld: amountLd,
      compose_msg: Buffer.alloc(0),
      dst_eid: dest.eid,
      extra_options: Buffer.alloc(0),
      min_amount_ld: 0n,
      oft_cmd: Buffer.alloc(0),
      to: Buffer.from(recipientOk ? evmAddressToBytes32(request.to.address) : new Uint8Array(32)),
    };

    const source = await this.simulationSource(
      sender.kind === "account" ? request.from.address : undefined,
    );
    const view = <T>(fn: string, args: Record<string, unknown>): Promise<T> =>
      this.oftView<T>(source, fn, args);

    const paused = await view<boolean>("is_paused", {});
    checks.push(
      check(
        "rail-paused",
        !paused,
        paused ? "the USDT0 OFT on Stellar is paused" : "OFT not paused",
      ),
    );
    const peer = await view<Buffer | null | undefined>("peer", { eid: dest.eid });
    const hasPeer = peer !== null && peer !== undefined;
    const approvalRequired = await view<boolean>("approval_required", {});

    let quoted:
      | { limit: OFTLimit; feeDetails: OFTFeeDetail[]; receipt: OFTReceipt; fee: MessagingFee }
      | undefined;
    if (hasPeer && sender.kind !== "muxed") {
      const [limit, feeDetails, receipt] = await view<[OFTLimit, OFTFeeDetail[], OFTReceipt]>(
        "quote_oft",
        {
          from: request.from.address,
          send_param: sendParamForQuote,
        },
      );
      const withinLimits = amountLd >= limit.min_amount_ld && amountLd <= limit.max_amount_ld;
      checks.push(
        check(
          "route-limits",
          withinLimits,
          withinLimits
            ? "within the route's min/max"
            : `amount must be between ${formatAmount(xlm(limit.min_amount_ld))} and ${formatAmount(xlm(limit.max_amount_ld))} USDT0 for this route`,
        ),
      );
      const fee = await view<MessagingFee>("quote_send", {
        from: request.from.address,
        send_param: { ...sendParamForQuote, min_amount_ld: receipt.amount_received_ld },
        pay_in_zro: false,
      });
      quoted = { limit, feeDetails, receipt, fee };
    } else {
      checks.push(
        check(
          "route-limits",
          false,
          hasPeer
            ? "sender cannot sign"
            : `no LayerZero peer configured for eid ${String(dest.eid)}`,
        ),
      );
    }

    const receipt: OFTReceipt = quoted?.receipt ?? {
      amount_sent_ld: amountLd,
      amount_received_ld: amountLd,
    };
    const fee: MessagingFee = quoted?.fee ?? { native_fee: 0n, zro_fee: 0n };
    const feeDetails: OFTFeeDetail[] = quoted?.feeDetails ?? [];

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
          trustline ? "USDT0 trustline present" : "sender holds no USDT0 trustline",
          trustline ? undefined : { kind: "add-trustline", asset: "USDT0" },
        ),
      );
      const balance = trustline?.balance ?? 0n;
      checks.push(
        check(
          "sender-asset-balance",
          balance >= amountLd,
          `USDT0 balance ${formatAmount(xlm(balance))}`,
        ),
      );
      const native = (await getNativeBalance(this.options.stellarRpc, request.from.address)) ?? 0n;
      const needed = fee.native_fee + NATIVE_FEE_HEADROOM_STROOPS;
      checks.push(
        check(
          "sender-native-balance",
          native >= needed,
          `XLM balance ${formatAmount(xlm(native))}, need at least ${formatAmount(xlm(needed))} for the LayerZero fee plus headroom`,
          native >= needed
            ? undefined
            : { kind: "fund-native", minimum: xlm(needed - native), symbol: "XLM" },
        ),
      );
    } else if (sender.kind === "contract") {
      const sacBalance = await this.sacBalance(source, request.from.address);
      checks.push(
        check(
          "sender-asset-balance",
          sacBalance >= amountLd,
          `USDT0 balance ${formatAmount(xlm(sacBalance))}`,
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

    const fees: Fee[] = [
      { label: "LayerZero messaging fee", amount: xlm(fee.native_fee), symbol: "XLM" },
    ];
    for (const detail of feeDetails) {
      fees.push({
        label: Buffer.from(detail.description).toString("utf8") || "OFT fee",
        amount: xlm(detail.fee_amount_ld),
        symbol: "USDT0",
      });
    }
    const quote: Quote = {
      rail: this.rail,
      request,
      debit: xlm(amountLd),
      credit: { value: receipt.amount_received_ld / 10n, decimals: SHARED_DECIMALS },
      dust,
      fees,
      etaSeconds: OBSERVED_ETA_SECONDS,
      checks,
      expiresAt: this.now() + (this.options.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS),
      refundAddress,
    };
    if (sender.kind !== "muxed") {
      this.quotes.set(quote, {
        direction: "out",
        sender: request.from.address,
        senderKind: sender.kind,
        dest,
        sendParam: { ...sendParamForQuote, min_amount_ld: receipt.amount_received_ld },
        fee,
        approvalRequired,
      });
    }
    return quote;
  }

  private async buildOutbound(quote: Quote, priv: OutboundPrivate): Promise<BuiltTransfer> {
    const refundAddress = this.assertStellarRefund(quote.refundAddress);
    const transferId = this.newTransferId();
    let source: Account;
    if (priv.senderKind === "account") {
      source = await this.options.stellarRpc.getAccount(priv.sender);
    } else {
      const feeSource = this.options.feeSourceAccount;
      if (feeSource === undefined) {
        throw new FerrylineError(
          "FEE_SOURCE_REQUIRED",
          "a C-address sender needs feeSourceAccount to sequence and pay for the transaction",
        );
      }
      source = await this.options.stellarRpc.getAccount(feeSource);
    }
    const steps: TransferStep[] = [];
    if (priv.approvalRequired) {
      const latest = await this.options.stellarRpc.getLatestLedger();
      const approve = await buildInvocation({
        rpc: this.options.stellarRpc,
        source,
        networkPassphrase: USDT0_STELLAR_MAINNET.networkPassphrase,
        contractId: USDT0_STELLAR_MAINNET.sac,
        fn: "approve",
        args: [
          new Address(priv.sender).toScVal(),
          new Address(USDT0_STELLAR_MAINNET.oft).toScVal(),
          nativeToScVal(priv.sendParam.amount_ld, { type: "i128" }),
          nativeToScVal(latest.sequence + APPROVE_LEDGER_WINDOW, { type: "u32" }),
        ],
      });
      steps.push({
        chain: "stellar",
        kind: "stellar-transaction",
        xdr: approve.xdr,
        description: "Approve the USDT0 OFT to spend the amount",
      });
      // The approve step consumes one sequence number; the send that follows needs the next one.
      source.incrementSequenceNumber();
    }
    // NO memo: this is a Soroban InvokeHostFunctionOp, and Soroban transactions can never carry a
    // memo (confirmed with a real testnet RPC rejection during widget-phase STEP 1 seam-proofing,
    // against the identical bug in the CCTP rail's own outbound burn — "Transaction contains a
    // memo. Soroban transactions do not support memos."). This USED to carry `transferId` in
    // MEMO_TEXT for correlation, which — as the comment this replaces already anticipated for a
    // DIFFERENT reason (custodial senders needing their own memo) — was never actually necessary:
    // `track()` above already implements memo-less correlation, by `sourceTxHash` (populated via
    // `Ferryline.markSubmitted`) as the primary key and the LayerZero GUID (read from `send()`'s own
    // real return value after the fact) for scan-lookup precision. Nothing reads the memo back.
    const send = await buildInvocation({
      rpc: this.options.stellarRpc,
      source,
      networkPassphrase: USDT0_STELLAR_MAINNET.networkPassphrase,
      contractId: USDT0_STELLAR_MAINNET.oft,
      fn: "send",
      args: this.spec.funcArgsToScVals("send", {
        from: priv.sender,
        send_param: priv.sendParam,
        fee: priv.fee,
        refund_address: refundAddress,
      }),
    });
    steps.push({
      chain: "stellar",
      kind: "stellar-transaction",
      xdr: send.xdr,
      description: `Send ${formatAmount(quote.debit)} USDT0 to ${priv.dest.chain} via LayerZero`,
    });
    const railRef: RailRef = {
      direction: "out",
      srcEid: USDT0_STELLAR_MAINNET.eid,
      dstEid: priv.dest.eid,
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

  // ---------------------------------------------------------------- inbound: EVM -> Stellar

  private async quoteInbound(request: TransferRequest): Promise<Quote> {
    const source = evmUsdt0Chain(request.from.chain);
    if (!source) {
      throw new FerrylineError(
        "ROUTE_UNSUPPORTED",
        `no USDT0 deployment known for ${request.from.chain}`,
      );
    }
    const recipient = parseStellarAddress(request.to.address);
    if (recipient.kind !== "account") {
      // Sign-off 2026-09-11: G recipients only until experiments/inbound-usdt0-c-address.ts has an
      // answer AND the lead has reviewed it. Do not lift this because a single test passed.
      throw new FerrylineError(
        "UNSUPPORTED_RECIPIENT_KIND",
        `inbound USDT0 can only be delivered to a G… account for now; got a ${recipient.kind} address`,
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
    const senderOk = EVM_ADDRESS.test(request.from.address);
    checks.push(
      check(
        "sender-format",
        senderOk,
        senderOk ? "EVM address" : "sender must be a 0x-prefixed 20-byte hex address",
      ),
    );
    checks.push(check("recipient-format", true, "G account"));
    const refundAddress = this.resolveEvmRefund(request);

    const trustline = await getTrustline(this.options.stellarRpc, request.to.address, this.asset);
    checks.push(
      check(
        "recipient-trustline",
        trustline !== undefined,
        trustline
          ? "recipient holds a USDT0 trustline"
          : "recipient has no USDT0 trustline; delivery would fail with op_no_trust",
        trustline ? undefined : { kind: "add-trustline", asset: "USDT0" },
      ),
    );

    const amount = parseAmount(request.amount, source.localDecimals);
    const sendParam = {
      dstEid: USDT0_STELLAR_MAINNET.eid,
      to: bytesToHex(accountAddressToBytes32(request.to.address)),
      amountLD: amount.value,
      minAmountLD: 0n,
    };
    const oft = await quoteOftOnEvm(reader, source, sendParam);
    const withinLimits = amount.value >= oft.minAmountLD && amount.value <= oft.maxAmountLD;
    checks.push(
      check(
        "route-limits",
        withinLimits,
        withinLimits ? "within the route's min/max" : "amount outside the route's min/max",
      ),
    );
    const fee = await quoteSendOnEvm(reader, source, {
      ...sendParam,
      minAmountLD: oft.amountReceivedLD,
    });

    if (senderOk) {
      const sender = request.from.address as `0x${string}`;
      const balance = (await reader.readContract({
        address: source.innerToken,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [sender],
      })) as bigint;
      checks.push(
        check(
          "sender-asset-balance",
          balance >= amount.value,
          `USDT0 balance ${formatAmount({ value: balance, decimals: source.localDecimals })}`,
        ),
      );
      const native = await reader.getBalance({ address: sender });
      checks.push(
        check(
          "sender-native-balance",
          native >= fee.nativeFee,
          `native balance ${native.toString()} wei, LayerZero fee ${fee.nativeFee.toString()} wei`,
        ),
      );
    }

    const quote: Quote = {
      rail: this.rail,
      request,
      debit: amount,
      credit: { value: oft.amountReceivedLD * 10n, decimals: STELLAR_DECIMALS },
      dust: { value: 0n, decimals: source.localDecimals },
      fees: [
        {
          label: "LayerZero messaging fee",
          amount: { value: fee.nativeFee, decimals: 18 },
          symbol: "native",
        },
      ],
      etaSeconds: OBSERVED_ETA_SECONDS,
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
        sendParam: { ...sendParam, minAmountLD: oft.amountReceivedLD },
        fee,
      });
    }
    return quote;
  }

  private async buildInbound(quote: Quote, priv: InboundPrivate): Promise<BuiltTransfer> {
    if (!EVM_ADDRESS.test(quote.refundAddress)) {
      throw new FerrylineError(
        "REFUND_ADDRESS_INVALID",
        "refund address must be an EVM address for an EVM-originated transfer",
      );
    }
    const transferId = this.newTransferId();
    const steps: TransferStep[] = [];
    if (priv.source.approvalRequired) {
      steps.push({
        chain: priv.source.chain,
        kind: "evm-transaction",
        to: priv.source.innerToken,
        data: encodeApprove(priv.source.oft, priv.sendParam.amountLD),
        value: 0n,
        description: "Approve the USDT0 OFT adapter to spend the amount",
      });
    }
    steps.push({
      chain: priv.source.chain,
      kind: "evm-transaction",
      to: priv.source.oft,
      data: encodeSend(priv.sendParam, priv.fee, quote.refundAddress as `0x${string}`),
      value: priv.fee.nativeFee,
      description: `Send ${formatAmount(quote.debit)} USDT0 to Stellar via LayerZero`,
    });
    const railRef: RailRef = {
      direction: "in",
      srcEid: priv.source.eid,
      dstEid: USDT0_STELLAR_MAINNET.eid,
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

  private resolveStellarRefund(request: TransferRequest): string {
    const sender = parseStellarAddress(request.from.address);
    // A muxed sender cannot sign (its check fails), but its refunds belong to the underlying account.
    const defaultRefund =
      sender.kind === "muxed"
        ? formatStellarAddress({ kind: "account", key: sender.key })
        : request.from.address;
    return this.assertStellarRefund(request.refundAddress ?? defaultRefund);
  }

  private assertStellarRefund(candidate: string): string {
    let parsed: ReturnType<typeof parseStellarAddress>;
    try {
      parsed = parseStellarAddress(candidate);
    } catch (error) {
      throw new FerrylineError(
        "REFUND_ADDRESS_INVALID",
        `refund address is not a valid Stellar address`,
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

  private async simulationSource(preferred: string | undefined): Promise<Account> {
    return this.options.stellarRpc.getAccount(
      preferred ?? this.options.simulationSourceAccount ?? USDT0_STELLAR_MAINNET.issuer,
    );
  }

  private async oftView<T>(source: Account, fn: string, args: Record<string, unknown>): Promise<T> {
    const retval = await simulateView({
      rpc: this.options.stellarRpc,
      source,
      networkPassphrase: USDT0_STELLAR_MAINNET.networkPassphrase,
      contractId: USDT0_STELLAR_MAINNET.oft,
      fn,
      args: this.spec.funcArgsToScVals(fn, args),
    });
    return this.spec.funcResToNative(fn, retval) as T;
  }

  private async sacBalance(source: Account, holder: string): Promise<bigint> {
    const retval = await simulateView({
      rpc: this.options.stellarRpc,
      source,
      networkPassphrase: USDT0_STELLAR_MAINNET.networkPassphrase,
      contractId: USDT0_STELLAR_MAINNET.sac,
      fn: "balance",
      args: [new Address(holder).toScVal()],
    });
    return scValToNative(retval) as bigint;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private pollMs(): number {
    return this.options.pollIntervalMs ?? DEFAULT_POLL_MS;
  }

  private newTransferId(): TransferId {
    return (this.options.newTransferId ?? newTransferId)();
  }
}

export type { RailRef as Usdt0RailRef };
