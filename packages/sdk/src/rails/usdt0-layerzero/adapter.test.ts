import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FerrylineError,
  InMemoryTransferStore,
  accountAddressToBytes32,
  isTransferId,
  type TransferRequest,
  type TransferStatus,
} from "@ferryline/core";
import { Address, Memo, MemoText, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

import { Usdt0LayerZeroAdapter } from "./adapter.js";
import { USDT0_STELLAR_MAINNET, evmUsdt0Chain } from "./chains.js";
import { IOFT_ABI, ERC20_ABI } from "./evm.js";
import {
  FakeEvmReader,
  FakeScan,
  FakeStellarRpc,
  scanMessage,
  type Fixture,
} from "./fakes.test-support.js";
import { Client as OftClient } from "./generated/oft.js";
import { stageFromScanStatus } from "./scan.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "__fixtures__", "mainnet-2026-09-11.json"), "utf8"),
) as Fixture;
const SENDER = fixture.sender;
const POLYGON_RECIPIENT = "0xe4b5fcce3cfbc86fdbb9fae472b14eea68fb301f";
const GUID = "0x123942677aa971c08c27ceffd86f20d0eb13dc7f559fc642fefcde266296cb3f";
const C_ADDRESS = "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T";

const outbound: TransferRequest = {
  asset: "USDT0",
  from: { chain: "stellar", address: SENDER },
  to: { chain: "polygon", address: POLYGON_RECIPIENT },
  amount: "1.2345678",
};

interface Harness {
  adapter: Usdt0LayerZeroAdapter;
  rpc: FakeStellarRpc;
  store: InMemoryTransferStore;
  clock: { now: number };
}

function harness(
  opts: {
    withoutTrustline?: boolean;
    txStatus?: "SUCCESS" | "NOT_FOUND" | "FAILED";
    scan?: FakeScan;
    evm?: FakeEvmReader;
  } = {},
): Harness {
  const rpc = new FakeStellarRpc(fixture, {
    ...(opts.withoutTrustline ? { withoutTrustline: true } : {}),
    ...(opts.txStatus ? { txStatus: opts.txStatus } : {}),
  });
  const store = new InMemoryTransferStore();
  const clock = { now: 1_700_000_000_000 };
  const adapter = new Usdt0LayerZeroAdapter({
    network: "mainnet",
    stellarRpc: rpc,
    store,
    scan: opts.scan ?? new FakeScan([[scanMessage(GUID, "DELIVERED", "0xdest")]]),
    evmReaders: {
      polygon: opts.evm ?? new FakeEvmReader(),
      ethereum: opts.evm ?? new FakeEvmReader(),
    },
    pollIntervalMs: 0,
    now: () => clock.now,
  });
  return { adapter, rpc, store, clock };
}

async function expectCode(promise: Promise<unknown>, code: FerrylineError["code"]): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FerrylineError);
  expect((caught as FerrylineError).code).toBe(code);
}

describe("routing", () => {
  it("serves USDT0 between Stellar and known EVM chains only", () => {
    const { adapter } = harness();
    expect(adapter.supports(outbound)).toBe(true);
    expect(adapter.supports({ ...outbound, from: outbound.to, to: outbound.from })).toBe(true);
    expect(adapter.supports({ ...outbound, asset: "USDC" })).toBe(false);
    expect(
      adapter.supports({ ...outbound, to: { chain: "bsc", address: POLYGON_RECIPIENT } }),
    ).toBe(false);
    expect(evmUsdt0Chain("polygon")?.eid).toBe(30109);
  });

  it("refuses to be constructed for testnet, where USDT0 does not exist", () => {
    expect(
      () =>
        new Usdt0LayerZeroAdapter({
          network: "testnet" as "mainnet",
          stellarRpc: new FakeStellarRpc(fixture),
          store: new InMemoryTransferStore(),
        }),
    ).toThrowError(/testnet/);
  });
});

describe("outbound quote (Stellar -> Polygon) against recorded mainnet responses", () => {
  it("floors the 7th decimal as dust and quotes the recorded LayerZero fee", async () => {
    const { adapter } = harness();
    const quote = await adapter.quote(outbound);
    expect(quote.debit).toEqual({ value: 12345670n, decimals: 7 });
    expect(quote.credit).toEqual({ value: 1234567n, decimals: 6 });
    expect(quote.dust).toEqual({ value: 8n, decimals: 7 });
    expect(quote.fees[0]).toEqual({
      label: "LayerZero messaging fee",
      amount: { value: 3558611n, decimals: 7 },
      symbol: "XLM",
    });
    expect(quote.refundAddress).toBe(SENDER);
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
  });

  it("calls quote_oft before quote_send (two-call pattern)", async () => {
    const { adapter, rpc } = harness();
    await adapter.quote(outbound);
    const order = rpc.calls.filter((c) => c.startsWith("quote_"));
    expect(order).toEqual(["quote_oft@CBOW", "quote_send@CBOW"]);
  });

  it("rejects an EVM recipient with a broken checksum, even though it's the right length/hex (real bug: a corrupted-case address passes a plain format regex but is not the real address)", async () => {
    const { adapter } = harness();
    // POLYGON_RECIPIENT correctly checksummed is 0xE4b5FcCE3CFBc86FDBb9FaE472B14EEA68fB301F;
    // flipping the first hex character's case (e -> E) keeps it 0x + 40 valid hex chars.
    const badChecksum = "0xE4b5FcCE3CFBc86FDBb9FaE472B14EEA68fB301f";
    const quote = await adapter.quote({
      ...outbound,
      to: { chain: "polygon", address: badChecksum },
    });
    const recipientCheck = quote.checks.find((c) => c.id === "recipient-format");
    expect(recipientCheck?.ok).toBe(false);
    expect(recipientCheck?.message).toContain("checksum");
  });

  it("fails the sender-trustline check when the sender holds no USDT0 trustline", async () => {
    const { adapter } = harness({ withoutTrustline: true });
    const quote = await adapter.quote(outbound);
    const trustline = quote.checks.find((c) => c.id === "sender-trustline");
    expect(trustline?.ok).toBe(false);
    expect(trustline?.remedy).toEqual({ kind: "add-trustline", asset: "USDT0" });
  });

  it("rejects malformed and muxed refund addresses at quote time", async () => {
    const { adapter } = harness();
    await expectCode(adapter.quote({ ...outbound, refundAddress: "" }), "REFUND_ADDRESS_INVALID");
    await expectCode(
      adapter.quote({
        ...outbound,
        refundAddress: "MATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJGAAAAAAAAAAAAEZQ6",
      }),
      "REFUND_ADDRESS_INVALID",
    );
    const withContractRefund = await adapter.quote({ ...outbound, refundAddress: C_ADDRESS });
    expect(withContractRefund.refundAddress).toBe(C_ADDRESS);
  });
});

describe("outbound build", () => {
  it("produces an unsigned send with the recorded fee, the left-padded EVM recipient, and NO memo", async () => {
    const { adapter, store } = harness();
    const built = await adapter.build(await adapter.quote(outbound));
    expect(isTransferId(built.transferId)).toBe(true);
    const send = built.steps[built.steps.length - 1];
    if (send?.kind !== "stellar-transaction") {
      throw new Error("expected a Stellar step");
    }
    const tx = TransactionBuilder.fromXDR(send.xdr, USDT0_STELLAR_MAINNET.networkPassphrase);
    if (!("memo" in tx)) {
      throw new Error("expected a plain transaction");
    }
    // REGRESSION GUARD (widget-phase STEP 1 seam-proofing found this as a real bug, confirmed
    // against a real testnet RPC rejection: "Transaction contains a memo. Soroban transactions do
    // not support memos."): `send` is a Soroban InvokeHostFunctionOp and can NEVER carry a memo —
    // this used to assert MemoText here, which was the bug, not a spec. Must stay MemoNone.
    expect(tx.memo.type).toBe("none");
    expect(tx.source).toBe(SENDER);

    const op = tx.operations[0];
    if (op?.type !== "invokeHostFunction" || op.func.type !== "hostFunctionTypeInvokeContract") {
      throw new Error("expected invokeHostFunction");
    }
    const invoke = op.func.invokeContract;
    expect(Address.fromScAddress(invoke.contractAddress).toString()).toBe(
      USDT0_STELLAR_MAINNET.oft,
    );
    expect(invoke.functionName.toString()).toBe("send");
    const [from, sendParam, fee, refund] = invoke.args.map((a) => scValToNative(a) as unknown) as [
      string,
      Record<string, unknown>,
      Record<string, bigint>,
      string,
    ];
    expect(from).toBe(SENDER);
    expect(refund).toBe(SENDER);
    expect(sendParam["dst_eid"]).toBe(30109);
    expect(sendParam["amount_ld"]).toBe(12345670n);
    expect(sendParam["min_amount_ld"]).toBe(12345670n);
    expect(Buffer.from(sendParam["to"] as Buffer).toString("hex")).toBe(
      `000000000000000000000000${POLYGON_RECIPIENT.slice(2)}`,
    );
    expect(fee["native_fee"]).toBe(3558611n);
    expect(Number(tx.fee)).toBeGreaterThan(
      Number(
        fixture.sendSimulation && "minResourceFee" in fixture.sendSimulation
          ? fixture.sendSimulation.minResourceFee
          : 0,
      ),
    );

    const record = await store.get(built.transferId);
    expect(record?.rail).toBe("usdt0-layerzero");
    expect(record?.railRef).toMatchObject({ direction: "out", srcEid: 30600, dstEid: 30109 });
  });

  it("refuses to build when the trustline preflight failed", async () => {
    const { adapter } = harness({ withoutTrustline: true });
    const quote = await adapter.quote(outbound);
    await expectCode(adapter.build(quote), "PREFLIGHT_FAILED");
  });

  it("refuses to build with a missing or malformed refund address even if the quote was tampered with", async () => {
    const { adapter } = harness();
    const quote = await adapter.quote(outbound);
    await expectCode(adapter.build({ ...quote, refundAddress: "" }), "ROUTE_UNSUPPORTED"); // a copied quote is not ours
    Object.assign(quote, { refundAddress: "" });
    await expectCode(adapter.build(quote), "REFUND_ADDRESS_INVALID");
    Object.assign(quote, {
      refundAddress: "GBBFBZR6OSK5RPZMOMRIODZH6TKOKEIENFBD54DB66G2UWAJOTSAZS3A",
    });
    await expectCode(adapter.build(quote), "REFUND_ADDRESS_INVALID");
  });

  it("refuses to build an expired quote", async () => {
    const { adapter, clock } = harness();
    const quote = await adapter.quote(outbound);
    clock.now = quote.expiresAt + 1;
    await expectCode(adapter.build(quote), "QUOTE_EXPIRED");
  });

  it("requires a fee source account for a C-address sender", async () => {
    const { adapter } = harness();
    const quote = await adapter.quote({
      ...outbound,
      from: { chain: "stellar", address: C_ADDRESS },
    });
    expect(quote.checks.find((c) => c.id === "sender-native-balance")?.ok).toBe(false);
    await expectCode(adapter.build(quote), "PREFLIGHT_FAILED");
  });
});

describe("inbound (EVM -> Stellar)", () => {
  const inbound: TransferRequest = {
    asset: "USDT0",
    from: { chain: "polygon", address: POLYGON_RECIPIENT },
    to: { chain: "stellar", address: SENDER },
    amount: "25.5",
  };

  it("only delivers to G accounts for now: C and M recipients throw UNSUPPORTED_RECIPIENT_KIND", async () => {
    const { adapter } = harness();
    await expectCode(
      adapter.quote({ ...inbound, to: { chain: "stellar", address: C_ADDRESS } }),
      "UNSUPPORTED_RECIPIENT_KIND",
    );
    await expectCode(
      adapter.quote({
        ...inbound,
        to: {
          chain: "stellar",
          address: "MATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJGAAAAAAAAAAAAEZQ6",
        },
      }),
      "UNSUPPORTED_RECIPIENT_KIND",
    );
  });

  it("rejects an EVM sender with a broken checksum via REFUND_ADDRESS_INVALID (resolveEvmRefund defaults refundAddress to request.from.address and throws hard, before quote() returns any soft check)", async () => {
    const { adapter } = harness();
    // Same real-bug class as the outbound recipient-format test above: 0x + 40 valid hex chars,
    // wrong checksum.
    const badChecksum = "0xE4b5FcCE3CFBc86FDBb9FaE472B14EEA68fB301f";
    await expectCode(
      adapter.quote({ ...inbound, from: { chain: "polygon", address: badChecksum } }),
      "REFUND_ADDRESS_INVALID",
    );
  });

  it("quotes at 6 decimals with no dust, credits 7 decimals on Stellar, and encodes the G key as bytes32", async () => {
    const evm = new FakeEvmReader({ nativeFee: 12345n });
    const { adapter } = harness({ evm });
    const quote = await adapter.quote(inbound);
    expect(quote.debit).toEqual({ value: 25_500_000n, decimals: 6 });
    expect(quote.credit).toEqual({ value: 255_000_000n, decimals: 7 });
    expect(quote.dust.value).toBe(0n);
    expect(quote.checks.every((c) => c.ok)).toBe(true);
    expect(evm.calls).toEqual(["quoteOFT", "quoteSend", "balanceOf"]);

    const built = await adapter.build(quote);
    expect(built.steps).toHaveLength(1);
    const step = built.steps[0];
    if (step?.kind !== "evm-transaction") {
      throw new Error("expected an EVM step");
    }
    expect(step.to).toBe(evmUsdt0Chain("polygon")?.oft);
    expect(step.value).toBe(12345n);
    const decoded = decodeFunctionData({ abi: IOFT_ABI, data: step.data });
    expect(decoded.functionName).toBe("send");
    const [sendParam, fee, refund] = decoded.args as unknown as [
      { dstEid: number; to: `0x${string}`; amountLD: bigint; minAmountLD: bigint },
      { nativeFee: bigint },
      string,
    ];
    expect(sendParam.dstEid).toBe(30600);
    expect(sendParam.to).toBe(`0x${Buffer.from(accountAddressToBytes32(SENDER)).toString("hex")}`);
    expect(sendParam.amountLD).toBe(25_500_000n);
    expect(fee.nativeFee).toBe(12345n);
    expect(refund.toLowerCase()).toBe(POLYGON_RECIPIENT);
  });

  it("adds an approve step on chains whose OFT adapter requires it (Ethereum)", async () => {
    const { adapter } = harness();
    const built = await adapter.build(
      await adapter.quote({ ...inbound, from: { chain: "ethereum", address: POLYGON_RECIPIENT } }),
    );
    expect(built.steps).toHaveLength(2);
    const approve = built.steps[0];
    if (approve?.kind !== "evm-transaction") {
      throw new Error("expected an EVM step");
    }
    expect(approve.to).toBe(evmUsdt0Chain("ethereum")?.innerToken);
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data: approve.data });
    expect(decoded.functionName).toBe("approve");
    expect(String(decoded.args?.[0]).toLowerCase()).toBe(evmUsdt0Chain("ethereum")?.oft);
  });

  it("blocks build() when the recipient has no trustline", async () => {
    const { adapter } = harness({ withoutTrustline: true });
    const quote = await adapter.quote(inbound);
    const trustline = quote.checks.find((c) => c.id === "recipient-trustline");
    expect(trustline?.ok).toBe(false);
    expect(trustline?.remedy).toEqual({ kind: "add-trustline", asset: "USDT0" });
    await expectCode(adapter.build(quote), "PREFLIGHT_FAILED");
  });

  it("rejects a non-EVM refund address", async () => {
    const { adapter } = harness();
    await expectCode(
      adapter.quote({ ...inbound, refundAddress: SENDER }),
      "REFUND_ADDRESS_INVALID",
    );
  });
});

describe("track", () => {
  it("reads the GUID from the executed send and follows LayerZero Scan to delivery", async () => {
    const scan = new FakeScan([
      [],
      [scanMessage(GUID, "INFLIGHT")],
      [scanMessage(GUID, "CONFIRMING")],
      [scanMessage(GUID, "DELIVERED", "0xdest")],
    ]);
    const { adapter, store } = harness({ scan });
    const built = await adapter.build(await adapter.quote(outbound));
    await store.markSubmitted(built.transferId, fixture.sentTransaction.hash);
    const seen: string[] = [];
    let last;
    for await (const status of adapter.track(built.transferId)) {
      seen.push(status.stage);
      last = status;
    }
    expect(seen).toEqual(["submitted", "verified", "delivered"]);
    expect(last?.destinationTxHash).toBe("0xdest");
    expect((await store.get(built.transferId))?.railRef).toMatchObject({ guid: GUID });
  });

  it("reports a failed source transaction as terminal", async () => {
    const { adapter, store } = harness({ txStatus: "FAILED" });
    const built = await adapter.build(await adapter.quote(outbound));
    await store.markSubmitted(built.transferId, fixture.sentTransaction.hash);
    const stages: string[] = [];
    for await (const status of adapter.track(built.transferId)) {
      stages.push(status.stage);
    }
    expect(stages).toEqual(["failed"]);
  });

  it("surfaces PAYLOAD_STORED as a retryable failure", async () => {
    const scan = new FakeScan([[scanMessage(GUID, "PAYLOAD_STORED")]]);
    const { adapter, store } = harness({ scan });
    const built = await adapter.build(await adapter.quote(outbound));
    await store.markSubmitted(built.transferId, fixture.sentTransaction.hash);
    let last;
    for await (const status of adapter.track(built.transferId)) {
      last = status;
    }
    expect(last?.stage).toBe("failed");
    expect(last?.failure?.retryable).toBe(true);
  });

  it("yields created and waits when nothing has been submitted yet", async () => {
    const { adapter } = harness();
    const built = await adapter.build(await adapter.quote(outbound));
    const controller = new AbortController();
    const iterator = adapter.track(built.transferId, controller.signal)[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect((first.value as TransferStatus).stage).toBe("created");
    controller.abort();
    await expect(iterator.next()).rejects.toThrow(/aborted/);
  });

  it("maps Scan status names conservatively", () => {
    expect(stageFromScanStatus("DELIVERED")).toEqual({
      stage: "delivered",
      terminal: true,
      retryable: false,
    });
    expect(stageFromScanStatus("SOMETHING_NEW").stage).toBe("submitted");
    expect(stageFromScanStatus("BLOCKED")).toMatchObject({ stage: "failed", retryable: false });
  });
});

describe("recorded fixture sanity", () => {
  it("the recorded send() return value carries the same GUID LayerZero Scan reports for that transaction", () => {
    const spec = new OftClient({
      contractId: USDT0_STELLAR_MAINNET.oft,
      networkPassphrase: USDT0_STELLAR_MAINNET.networkPassphrase,
      rpcUrl: "https://unused.invalid",
    }).spec;
    const returnValue = fixture.sentTransaction.returnValueXdr;
    if (returnValue === undefined) {
      throw new Error("fixture has no return value");
    }
    const [receipt] = spec.funcResToNative("send", returnValue) as [
      { guid: Buffer; nonce: bigint },
      unknown,
    ];
    expect(`0x${Buffer.from(receipt.guid).toString("hex")}`).toBe(GUID);
    expect(Memo.text("01ARZ3NDEKTSV4RRFFQ69G5FAV").type).toBe(MemoText);
  });
});
