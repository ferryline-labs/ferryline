import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FerrylineError,
  InMemoryTransferStore,
  contractAddressToBytes32,
  isTransferId,
  type TransferRequest,
  type TransferStatus,
} from "@ferryline/core";
import { Address, MemoText, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

import { HandlerEvmReader } from "../../evm/fake-reader.test-support.js";
import { UsdcCctpAdapter, readCctpParameters } from "./adapter.js";
import { CCTP_STELLAR, cctpEvmChain } from "./chains.js";
import { TOKEN_MESSENGER_V2_ABI } from "./evm.js";
import {
  FREE_FEES,
  FakeCctpRpc,
  FakeIris,
  INBOUND_FEES,
  type CctpFixture,
} from "./fakes.test-support.js";
import type { IrisFeeRow, IrisMessage } from "./iris.js";
import { parseForwarderHookData } from "./message.js";
import {
  DEPOSIT_FOR_BURN_ARGS,
  MINT_AND_FORWARD_ARGS,
  depositForBurnScVals,
  mintAndForwardScVals,
} from "./stellar.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "__fixtures__", "mainnet-2026-09-11.json"), "utf8"),
) as CctpFixture;
const dumps = join(here, "..", "..", "..", "..", "core", "verified");
const MAINNET = CCTP_STELLAR.mainnet;
const SENDER = fixture.sender;
const BASE_RECIPIENT = "0x7be6fa75805d77bc3fe8f004bbec49f7d4f1ac50";
const BURN_HASH = fixture.burnTransaction.hash;
const REAL_AMOUNT7 = 6_458_000_000n;
const irisComplete = fixture.iris.messages[0]!;
const PARAMS = { maxFee: "0", minFinalityThreshold: 2000 } as const;
const M_SENDER = "MATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJGAAAAAAAAAAAAEZQ6";

const { parameters: _outboundParams, ...outboundNoParams } = {
  asset: "USDC",
  from: { chain: "stellar", address: SENDER },
  to: { chain: "base", address: BASE_RECIPIENT },
  amount: "645.8",
  parameters: PARAMS,
} satisfies TransferRequest;
const { parameters: _inboundParams, ...inboundNoParams } = {
  asset: "USDC",
  from: { chain: "ethereum", address: BASE_RECIPIENT },
  to: { chain: "stellar", address: SENDER },
  amount: "100",
  parameters: PARAMS,
} satisfies TransferRequest;
const outbound: TransferRequest = {
  asset: "USDC",
  from: { chain: "stellar", address: SENDER },
  to: { chain: "base", address: BASE_RECIPIENT },
  amount: "645.8",
  parameters: PARAMS,
};
const inbound: TransferRequest = {
  asset: "USDC",
  from: { chain: "ethereum", address: BASE_RECIPIENT },
  to: { chain: "stellar", address: SENDER },
  amount: "100",
  parameters: PARAMS,
};

interface HarnessOptions {
  allowance?: bigint;
  withoutTrustline?: boolean;
  txStatus?: "SUCCESS" | "NOT_FOUND" | "FAILED";
  nonceUsed?: boolean;
  fees?: readonly IrisFeeRow[];
  irisMessages?: readonly (readonly IrisMessage[])[];
  evm?: HandlerEvmReader;
  noEvm?: boolean;
  network?: "mainnet" | "testnet";
  /** Record every sleep() delay instead of actually waiting; read back via the returned `sleeps` array. */
  recordSleeps?: boolean;
  pollIntervalMs?: number;
  pollMaxIntervalMs?: number;
}

function evmReader(): HandlerEvmReader {
  return new HandlerEvmReader({
    balanceOf: () => 1_000_000_000_000n,
    allowance: () => 0n,
    usedNonces: () => 0n,
  });
}

function harness(o: HarnessOptions = {}) {
  const rpc = new FakeCctpRpc(fixture, {
    ...(o.allowance === undefined ? {} : { allowance: o.allowance }),
    ...(o.withoutTrustline ? { withoutTrustline: true } : {}),
    ...(o.txStatus ? { txStatus: o.txStatus } : {}),
    ...(o.nonceUsed === undefined ? {} : { nonceUsed: o.nonceUsed }),
  });
  const iris = new FakeIris(o.fees ?? FREE_FEES, o.irisMessages ?? [[irisComplete]]);
  const evm = o.evm ?? evmReader();
  const store = new InMemoryTransferStore();
  const clock = { now: 1_700_000_000_000 };
  const sleeps: number[] = [];
  const adapter = new UsdcCctpAdapter({
    network: o.network ?? "mainnet",
    stellarRpc: rpc,
    store,
    iris,
    ...(o.noEvm ? {} : { evmReaders: { base: evm, ethereum: evm, "base-sepolia": evm } }),
    pollIntervalMs: o.pollIntervalMs ?? 0,
    ...(o.pollMaxIntervalMs === undefined ? {} : { pollMaxIntervalMs: o.pollMaxIntervalMs }),
    ...(o.recordSleeps
      ? {
          sleep: (ms: number, signal?: AbortSignal) => {
            sleeps.push(ms);
            if (signal?.aborted) {
              return Promise.reject(new Error("aborted"));
            }
            return Promise.resolve();
          },
        }
      : {}),
    now: () => clock.now,
  });
  return { adapter, rpc, iris, evm, store, clock, sleeps };
}

async function expectCode(
  promise: Promise<unknown>,
  code: FerrylineError["code"],
): Promise<FerrylineError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FerrylineError);
  expect((caught as FerrylineError).code).toBe(code);
  return caught as FerrylineError;
}

function decodeStellarStep(xdr: string) {
  const tx = TransactionBuilder.fromXDR(xdr, MAINNET.networkPassphrase);
  if (!("memo" in tx)) {
    throw new Error("expected a plain transaction");
  }
  const op = tx.operations[0];
  if (op?.type !== "invokeHostFunction" || op.func.type !== "hostFunctionTypeInvokeContract") {
    throw new Error("expected invokeHostFunction");
  }
  const invoke = op.func.invokeContract;
  return {
    tx,
    contractId: Address.fromScAddress(invoke.contractAddress).toString(),
    fn: invoke.functionName.toString(),
    argsXdr: invoke.args.map((a) => a.toXDR("base64")),
    args: invoke.args.map((a) => scValToNative(a) as unknown),
  };
}

async function collect(
  adapter: UsdcCctpAdapter,
  id: Parameters<UsdcCctpAdapter["track"]>[0],
): Promise<TransferStatus[]> {
  const out: TransferStatus[] = [];
  for await (const status of adapter.track(id)) {
    out.push(status);
  }
  return out;
}

describe("routing and required parameters", () => {
  it("serves USDC between Stellar and the network's CCTP chains only", () => {
    const { adapter } = harness();
    expect(adapter.supports(outbound)).toBe(true);
    expect(adapter.supports(inbound)).toBe(true);
    expect(adapter.supports({ ...outbound, asset: "USDT0" })).toBe(false);
    expect(adapter.supports({ ...outbound, to: { chain: "bsc", address: BASE_RECIPIENT } })).toBe(
      false,
    );
    expect(
      adapter.supports({ ...outbound, to: { chain: "base-sepolia", address: BASE_RECIPIENT } }),
    ).toBe(false);
    expect(
      harness({ network: "testnet" }).adapter.supports({
        ...outbound,
        to: { chain: "base-sepolia", address: BASE_RECIPIENT },
      }),
    ).toBe(true);
  });

  it("refuses to quote without maxFee and minFinalityThreshold and names the two blocked experiments", async () => {
    const { adapter } = harness();
    const error = await expectCode(adapter.quote(outboundNoParams), "PARAMETER_REQUIRED");
    expect(error.message).toContain("2026-09-11-cctp-burn-max-fee-zero.md");
    expect(error.message).toContain("2026-09-11-cctp-finality-threshold.md");
    await expectCode(
      adapter.quote({ ...outbound, parameters: { maxFee: "0" } }),
      "PARAMETER_REQUIRED",
    );
    await expectCode(
      adapter.quote({ ...outbound, parameters: { minFinalityThreshold: 2000 } }),
      "PARAMETER_REQUIRED",
    );
    await expectCode(adapter.quote(inboundNoParams), "PARAMETER_REQUIRED");
  });

  it("rejects out-of-vocabulary parameter values", async () => {
    const { adapter } = harness();
    await expectCode(
      adapter.quote({ ...outbound, parameters: { maxFee: "0", minFinalityThreshold: 1500 } }),
      "PARAMETER_INVALID",
    );
    await expectCode(
      adapter.quote({ ...outbound, parameters: { maxFee: 0, minFinalityThreshold: 2000 } }),
      "PARAMETER_INVALID",
    );
    await expectCode(
      adapter.quote({ ...outbound, parameters: { maxFee: "abc", minFinalityThreshold: 2000 } }),
      "PARAMETER_INVALID",
    );
    await expectCode(
      adapter.quote({
        ...outbound,
        parameters: { maxFee: "0.1234567", minFinalityThreshold: 2000 },
      }),
      "PARAMETER_INVALID",
    );
    expect(readCctpParameters(outbound)).toEqual({
      maxFee: { value: 0n, decimals: 6 },
      minFinalityThreshold: 2000,
    });
  });

  it("build() throws if the parameters were stripped after quoting", async () => {
    const { adapter } = harness({ allowance: REAL_AMOUNT7 });
    const quote = await adapter.quote(outbound);
    Object.assign(quote, { request: outboundNoParams });
    await expectCode(adapter.build(quote), "PARAMETER_REQUIRED");
  });
});

describe("outbound quote (Stellar -> Base) against recorded mainnet responses", () => {
  it("quotes the real burn's amounts with a zero Circle fee and all checks passing", async () => {
    const { adapter, rpc, iris } = harness();
    const quote = await adapter.quote(outbound);
    expect(quote.debit).toEqual({ value: REAL_AMOUNT7, decimals: 7 });
    expect(quote.credit).toEqual({ value: 645_800_000n, decimals: 6 });
    expect(quote.dust.value).toBe(0n);
    expect(quote.fees[0]?.amount).toEqual({ value: 0n, decimals: 6 });
    expect(quote.etaSeconds).toBeUndefined();
    expect(quote.checks.every((c) => c.ok)).toBe(true);
    expect(quote.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        "sender-format",
        "recipient-format",
        "rail-paused",
        "route-limits",
        "sender-trustline",
        "sender-asset-balance",
        "sender-native-balance",
      ]),
    );
    expect(rpc.calls).toEqual(
      expect.arrayContaining([
        "paused@CAE2",
        "paused@CACM",
        "get_min_fee_amount@CAE2",
        "allowance@CCW6",
      ]),
    );
    expect(iris.calls).toContain("fees:27->6");
  });

  it("floors the 7th decimal as dust", async () => {
    const { adapter } = harness();
    const quote = await adapter.quote({ ...outbound, amount: "1.2345678" });
    expect(quote.debit).toEqual({ value: 12_345_670n, decimals: 7 });
    expect(quote.credit).toEqual({ value: 1_234_567n, decimals: 6 });
    expect(quote.dust).toEqual({ value: 8n, decimals: 7 });
  });

  it("fails route-limits when maxFee is below Circle's minimum for the chosen threshold, and build refuses", async () => {
    const paidFast: IrisFeeRow[] = [
      { finalityThreshold: 1000, minimumFee: 1.3 },
      { finalityThreshold: 2000, minimumFee: 0 },
    ];
    const { adapter } = harness({ fees: paidFast });
    const tooLow = await adapter.quote({
      ...outbound,
      parameters: { maxFee: "0", minFinalityThreshold: 1000 },
    });
    expect(tooLow.checks.find((c) => c.id === "route-limits")?.ok).toBe(false);
    await expectCode(adapter.build(tooLow), "PREFLIGHT_FAILED");
    const enough = await adapter.quote({
      ...outbound,
      parameters: { maxFee: "0.09", minFinalityThreshold: 1000 },
    });
    expect(enough.checks.find((c) => c.id === "route-limits")?.ok).toBe(true);
    expect(enough.fees[0]?.amount).toEqual({ value: 83_954n, decimals: 6 });
    expect(enough.credit).toEqual({ value: 645_800_000n - 83_954n, decimals: 6 });
  });

  it("fails route-limits when Circle lists no fee row for the requested threshold", async () => {
    const { adapter } = harness({ fees: [{ finalityThreshold: 2000, minimumFee: 0 }] });
    const quote = await adapter.quote({
      ...outbound,
      parameters: { maxFee: "0", minFinalityThreshold: 1000 },
    });
    expect(quote.checks.find((c) => c.id === "route-limits")?.ok).toBe(false);
  });

  it("blocks build() when the sender has no USDC trustline", async () => {
    const { adapter } = harness({ withoutTrustline: true });
    const quote = await adapter.quote(outbound);
    expect(quote.checks.find((c) => c.id === "sender-trustline")?.ok).toBe(false);
    await expectCode(adapter.build(quote), "PREFLIGHT_FAILED");
  });

  it("requires a fee source for a C-address sender", async () => {
    const { adapter } = harness();
    const quote = await adapter.quote({
      ...outbound,
      from: { chain: "stellar", address: MAINNET.cctpForwarder },
    });
    expect(quote.checks.find((c) => c.id === "sender-native-balance")?.ok).toBe(false);
    await expectCode(adapter.build(quote), "PREFLIGHT_FAILED");
  });

  it("rejects a muxed sender at the check level", async () => {
    const { adapter } = harness();
    const quote = await adapter.quote({
      ...outbound,
      from: { chain: "stellar", address: M_SENDER },
    });
    expect(quote.checks.find((c) => c.id === "sender-format")?.ok).toBe(false);
  });
});

describe("outbound build: approve first, then deposit_for_burn", () => {
  it("with no standing allowance, builds the approve now and defers the burn", async () => {
    const { adapter, store } = harness();
    const built = await adapter.build(await adapter.quote(outbound));
    expect(isTransferId(built.transferId)).toBe(true);
    expect(built.steps).toHaveLength(2);
    const [approve, burn] = built.steps;
    if (approve?.kind !== "stellar-transaction") {
      throw new Error("expected the approve to be signable now");
    }
    const decoded = decodeStellarStep(approve.xdr);
    expect(decoded.contractId).toBe(MAINNET.usdcSac);
    expect(decoded.fn).toBe("approve");
    expect(decoded.args).toEqual([
      SENDER,
      MAINNET.tokenMessengerMinter,
      REAL_AMOUNT7,
      fixture.latestLedger + 1000,
    ]);
    expect(burn).toMatchObject({
      chain: "stellar",
      kind: "stellar-transaction-deferred",
      dependsOn: 0,
    });
    expect(burn?.description).toContain("Burn");
    expect((await store.get(built.transferId))?.railRef).toMatchObject({
      direction: "out",
      sourceDomain: 27,
      destinationDomain: 6,
      burn: { stepIndex: 1, maxFee7: "0", minFinalityThreshold: 2000 },
    });
  });

  it("refuses to prepare the burn while the allowance is short, with a clear error instead of Soroban's", async () => {
    const { adapter, rpc } = harness();
    const built = await adapter.build(await adapter.quote(outbound));
    const error = await expectCode(
      adapter.prepareStep(built.transferId, 1),
      "ALLOWANCE_INSUFFICIENT",
    );
    expect(error.message).toMatch(/approve step/);
    expect(error.message).toContain("645.8000000");
    expect(error.message).not.toMatch(/Error\(Contract|not enough allowance to spend|escalating/);
    expect(rpc.calls.filter((c) => c.startsWith("deposit_for_burn"))).toHaveLength(0);
  });

  it("once the allowance exists, prepares a burn that is byte-identical to the real mainnet invocation and carries the transfer id as MEMO_TEXT", async () => {
    const { adapter, rpc } = harness();
    const built = await adapter.build(await adapter.quote(outbound));
    rpc.setAllowance(REAL_AMOUNT7);
    const step = await adapter.prepareStep(built.transferId, 1);
    if (step.kind !== "stellar-transaction") {
      throw new Error("expected a signable step");
    }
    const decoded = decodeStellarStep(step.xdr);
    expect(decoded.contractId).toBe(MAINNET.tokenMessengerMinter);
    expect(decoded.fn).toBe("deposit_for_burn");
    expect(decoded.argsXdr).toEqual(fixture.burnTransaction.args);
    expect(decoded.tx.source).toBe(SENDER);
    expect(decoded.tx.memo.type).toBe(MemoText);
    expect(Buffer.from(decoded.tx.memo.value as Buffer).toString("utf8")).toBe(built.transferId);
  });

  it("with a sufficient standing allowance, builds the burn directly as a single signable step", async () => {
    const { adapter } = harness({ allowance: 10_000_000_000n });
    const built = await adapter.build(await adapter.quote(outbound));
    expect(built.steps).toHaveLength(1);
    const step = built.steps[0];
    if (step?.kind !== "stellar-transaction") {
      throw new Error("expected a signable step");
    }
    const decoded = decodeStellarStep(step.xdr);
    expect(decoded.fn).toBe("deposit_for_burn");
    expect(decoded.argsXdr).toEqual(fixture.burnTransaction.args);
  });

  it("prepareStep refuses indices that are not the deferred burn and unknown transfers", async () => {
    const { adapter } = harness();
    const built = await adapter.build(await adapter.quote(outbound));
    await expectCode(adapter.prepareStep(built.transferId, 0), "STEP_NOT_READY");
    await expectCode(
      adapter.prepareStep("01ARZ3NDEKTSV4RRFFQ69G5FAV" as typeof built.transferId, 1),
      "TRANSFER_UNKNOWN",
    );
  });
});

describe("encoder conformance with the recorded mainnet interfaces", () => {
  function params(dump: string, fn: string): string[] {
    const source = readFileSync(join(dumps, dump), "utf8");
    const match = new RegExp(`fn ${fn}\\(([^)]*)\\)`, "s").exec(source);
    if (!match) {
      throw new Error(`${fn} not in ${dump}`);
    }
    return match[1]!
      .split(",")
      .map((p) => p.trim().split(":")[0]!.trim())
      .filter((name) => name.length > 0 && name !== "env");
  }

  it("deposit_for_burn argument order matches the TokenMessengerMinter deployed on mainnet", () => {
    expect(params("cctp-token-messenger-minter.mainnet.rs", "deposit_for_burn")).toEqual([
      ...DEPOSIT_FOR_BURN_ARGS,
    ]);
    expect(params("cctp-token-messenger-minter.mainnet.rs", "deposit_for_burn_with_hook")).toEqual([
      ...DEPOSIT_FOR_BURN_ARGS,
      "hook_data",
    ]);
  });

  it("the forwarder and transmitter entry points the relayer will call have the expected parameters", () => {
    expect(params("cctp-forwarder.mainnet.rs", "mint_and_forward")).toEqual([
      ...MINT_AND_FORWARD_ARGS,
    ]);
    expect(params("cctp-message-transmitter.mainnet.rs", "is_nonce_used")).toEqual(["nonce"]);
  });

  it("encodes the real burn's arguments byte for byte", () => {
    const encoded = depositForBurnScVals({
      caller: SENDER,
      amount: REAL_AMOUNT7,
      destinationDomain: 6,
      mintRecipient: new Uint8Array(
        Buffer.from(`000000000000000000000000${BASE_RECIPIENT.slice(2)}`, "hex"),
      ),
      burnToken: MAINNET.usdcSac,
      destinationCaller: new Uint8Array(32),
      maxFee: 0n,
      minFinalityThreshold: 2000,
    }).map((v) => v.toXDR("base64"));
    expect(encoded).toEqual(fixture.burnTransaction.args);
  });

  it("encodes mint_and_forward with a real observed Iris message and attestation, in the right order", () => {
    const messageBytes = new Uint8Array(Buffer.from(irisComplete.message.slice(2), "hex"));
    const attestationBytes = new Uint8Array(Buffer.from(irisComplete.attestation.slice(2), "hex"));
    const [messageArg, attestationArg] = mintAndForwardScVals({
      message: messageBytes,
      attestation: attestationBytes,
    });
    expect(scValToNative(messageArg!) as Uint8Array).toEqual(messageBytes);
    expect(scValToNative(attestationArg!) as Uint8Array).toEqual(attestationBytes);
    // Positional order matters: message first, attestation second, matching the deployed signature.
    expect(
      mintAndForwardScVals({ message: messageBytes, attestation: attestationBytes }),
    ).toHaveLength(2);
  });
});

describe("inbound step builder (EVM -> Stellar via CctpForwarder)", () => {
  it("quotes at 6 decimals, credits 7 decimals on Stellar, and checks the recipient's trustline", async () => {
    const { adapter } = harness({ fees: INBOUND_FEES });
    const quote = await adapter.quote(inbound);
    expect(quote.debit).toEqual({ value: 100_000_000n, decimals: 6 });
    expect(quote.credit).toEqual({ value: 1_000_000_000n, decimals: 7 });
    expect(quote.checks.every((c) => c.ok)).toBe(true);
    expect(quote.checks.map((c) => c.id)).toContain("recipient-trustline");
    const fast = await adapter.quote({
      ...inbound,
      parameters: { maxFee: "1", minFinalityThreshold: 1000 },
    });
    expect(fast.fees[0]?.amount).toEqual({ value: 13_000n, decimals: 6 });
    expect(fast.credit).toEqual({ value: (100_000_000n - 13_000n) * 10n, decimals: 7 });
    const underpaid = await adapter.quote({
      ...inbound,
      parameters: { maxFee: "0", minFinalityThreshold: 1000 },
    });
    expect(underpaid.checks.find((c) => c.id === "route-limits")?.ok).toBe(false);
  });

  it("always burns toward the CctpForwarder in both fields and carries the recipient in hook data", async () => {
    for (const network of ["mainnet", "testnet"] as const) {
      const forwarder = CCTP_STELLAR[network].cctpForwarder;
      const { adapter } = harness({ network });
      // On testnet the recorded trustline (mainnet USDC) does not apply, so target a contract recipient there.
      const recipient = network === "mainnet" ? SENDER : CCTP_STELLAR.testnet.cctpForwarder;
      const fromChain = network === "mainnet" ? "ethereum" : "base-sepolia";
      const request: TransferRequest = {
        ...inbound,
        from: { chain: fromChain, address: BASE_RECIPIENT },
        to: { chain: "stellar", address: recipient },
      };
      const built = await adapter.build(await adapter.quote(request));
      expect(built.steps).toHaveLength(2);
      const [approve, burn] = built.steps;
      if (approve?.kind !== "evm-transaction" || burn?.kind !== "evm-transaction") {
        throw new Error("expected EVM steps");
      }
      const chain = cctpEvmChain(network, fromChain);
      if (!chain) {
        throw new Error("chain missing");
      }
      expect(approve.to).toBe(chain.usdc);
      expect(burn.to).toBe(chain.tokenMessengerV2);
      const decoded = decodeFunctionData({ abi: TOKEN_MESSENGER_V2_ABI, data: burn.data });
      expect(decoded.functionName).toBe("depositForBurnWithHook");
      const [
        amount,
        domain,
        mintRecipient,
        burnToken,
        destinationCaller,
        maxFee,
        threshold,
        hookData,
      ] = decoded.args as unknown as [
        bigint,
        number,
        string,
        string,
        string,
        bigint,
        number,
        string,
      ];
      const forwarderHex = `0x${Buffer.from(contractAddressToBytes32(forwarder)).toString("hex")}`;
      expect(mintRecipient).toBe(forwarderHex);
      expect(destinationCaller).toBe(forwarderHex);
      expect(domain).toBe(27);
      expect(amount).toBe(100_000_000n);
      expect(maxFee).toBe(0n);
      expect(threshold).toBe(2000);
      expect(burnToken.toLowerCase()).toBe(chain.usdc.toLowerCase());
      expect(
        parseForwarderHookData(new Uint8Array(Buffer.from(hookData.slice(2), "hex")))
          .forwardRecipient,
      ).toBe(recipient);
    }
  });

  it("skips the approve when the allowance already covers the amount", async () => {
    const evm = new HandlerEvmReader({
      balanceOf: () => 10n ** 12n,
      allowance: () => 10n ** 12n,
      usedNonces: () => 0n,
    });
    const { adapter } = harness({ evm });
    const built = await adapter.build(await adapter.quote(inbound));
    expect(built.steps).toHaveLength(1);
  });

  it("accepts C and M recipients (the forwarder resolves them) and blocks G/M recipients without a trustline", async () => {
    const { adapter } = harness();
    const toContract = await adapter.quote({
      ...inbound,
      to: { chain: "stellar", address: MAINNET.cctpForwarder },
    });
    expect(toContract.checks.map((c) => c.id)).not.toContain("recipient-trustline");
    expect(toContract.checks.every((c) => c.ok)).toBe(true);
    const toMuxed = await adapter.quote({
      ...inbound,
      to: { chain: "stellar", address: M_SENDER },
    });
    expect(toMuxed.checks.find((c) => c.id === "recipient-trustline")).toBeDefined();
    const { adapter: noTrust } = harness({ withoutTrustline: true });
    const quote = await noTrust.quote(inbound);
    expect(quote.checks.find((c) => c.id === "recipient-trustline")?.ok).toBe(false);
    await expectCode(noTrust.build(quote), "PREFLIGHT_FAILED");
  });
});

describe("track", () => {
  it("outbound: source tx, Iris attestation, then the destination transmitter consuming the nonce", async () => {
    let usedNoncesCalls = 0;
    const evm = new HandlerEvmReader({
      balanceOf: () => 10n ** 12n,
      allowance: () => 0n,
      usedNonces: () => (usedNoncesCalls++ === 0 ? 0n : 1n),
    });
    const { adapter, store } = harness({
      allowance: REAL_AMOUNT7,
      irisMessages: [[], [irisComplete]],
      evm,
    });
    const built = await adapter.build(await adapter.quote(outbound));
    await store.markSubmitted(built.transferId, BURN_HASH);
    const statuses = await collect(adapter, built.transferId);
    expect(statuses.map((s) => s.stage)).toEqual([
      "submitted",
      "submitted",
      "verified",
      "delivered",
    ]);
    expect(statuses[1]?.detail).toContain("awaiting Circle attestation");
    expect(statuses[2]?.detail).toContain(irisComplete.eventNonce);
    expect((await store.get(built.transferId))?.railRef).toMatchObject({
      nonce: irisComplete.eventNonce,
      attestation: irisComplete.attestation,
    });
  });

  it("outbound: an unobserved Iris status is surfaced verbatim and treated as pending", async () => {
    const pending: IrisMessage = { ...irisComplete, status: "pending_confirmations" };
    const evm = new HandlerEvmReader({
      balanceOf: () => 10n ** 12n,
      allowance: () => 0n,
      usedNonces: () => 1n,
    });
    const { adapter, store } = harness({
      allowance: REAL_AMOUNT7,
      irisMessages: [[pending], [irisComplete]],
      evm,
    });
    const built = await adapter.build(await adapter.quote(outbound));
    await store.markSubmitted(built.transferId, BURN_HASH);
    const statuses = await collect(adapter, built.transferId);
    expect(statuses.map((s) => s.stage)).toEqual([
      "submitted",
      "submitted",
      "verified",
      "delivered",
    ]);
    expect(statuses[1]?.detail).toContain("pending_confirmations");
  });

  it("Iris polling backs off exponentially from pollIntervalMs to pollMaxIntervalMs, not a flat interval", async () => {
    const pending: IrisMessage = { ...irisComplete, status: "pending_confirmations" };
    // Five non-terminal Iris responses before the sixth is complete: attempts 0..4 sleep, attempt 5 exits the loop.
    const irisMessages = [[pending], [pending], [pending], [pending], [pending], [irisComplete]];
    const evm = new HandlerEvmReader({
      balanceOf: () => 10n ** 12n,
      allowance: () => 0n,
      usedNonces: () => 1n,
    });
    const { adapter, store, sleeps } = harness({
      allowance: REAL_AMOUNT7,
      irisMessages,
      evm,
      recordSleeps: true,
      pollIntervalMs: 5_000,
      pollMaxIntervalMs: 60_000,
    });
    const built = await adapter.build(await adapter.quote(outbound));
    await store.markSubmitted(built.transferId, BURN_HASH);
    await collect(adapter, built.transferId);
    // The first two recorded sleeps are the (zero-length in this harness) store-wait and source-tx-confirmation
    // waits, which use the flat pollMs(); the Iris loop's backoff sleeps follow.
    const irisSleeps = sleeps.slice(-5);
    expect(irisSleeps).toEqual([5_000, 10_000, 20_000, 40_000, 60_000]);
  });

  it("outbound: stops at verified when no EVM reader can confirm the mint", async () => {
    const { adapter, store } = harness({ allowance: REAL_AMOUNT7, noEvm: true });
    const built = await adapter.build(await adapter.quote(outbound));
    await store.markSubmitted(built.transferId, BURN_HASH);
    const statuses = await collect(adapter, built.transferId);
    expect(statuses.map((s) => s.stage)).toEqual(["submitted", "verified", "verified"]);
    expect(statuses[2]?.detail).toContain("no EVM reader");
  });

  it("outbound: a failed burn transaction is terminal", async () => {
    const { adapter, store } = harness({ allowance: REAL_AMOUNT7, txStatus: "FAILED" });
    const built = await adapter.build(await adapter.quote(outbound));
    await store.markSubmitted(built.transferId, BURN_HASH);
    const statuses = await collect(adapter, built.transferId);
    expect(statuses.map((s) => s.stage)).toEqual(["failed"]);
    expect(statuses[0]?.failure?.retryable).toBe(false);
  });

  it("inbound: Iris attestation, then Stellar's transmitter reporting the nonce used", async () => {
    const { adapter, store } = harness({ nonceUsed: true });
    const built = await adapter.build(await adapter.quote(inbound));
    await store.markSubmitted(
      built.transferId,
      "0xbb9f25802189fb7a82e1b36b346f1d79cdbbb4c1aaad03f69dedf2c8263b8c08",
    );
    const statuses = await collect(adapter, built.transferId);
    expect(statuses.map((s) => s.stage)).toEqual(["submitted", "verified", "delivered"]);
    expect(statuses[2]?.detail).toContain("mint_and_forward");
  });

  it("yields created and waits when nothing has been submitted yet", async () => {
    const { adapter } = harness({ allowance: REAL_AMOUNT7 });
    const built = await adapter.build(await adapter.quote(outbound));
    const controller = new AbortController();
    const iterator = adapter.track(built.transferId, controller.signal)[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect((first.value as TransferStatus).stage).toBe("created");
    controller.abort();
    await expect(iterator.next()).rejects.toThrow(/aborted/);
  });
});
