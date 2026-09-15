import type {
  BuiltTransfer,
  Quote,
  RailAdapter,
  TransferId,
  TransferRequest,
  TransferStatus,
  TransferStep,
  TransferStore,
} from "@ferryline/core";
import { newTransferId } from "@ferryline/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Ferryline, isFinalStep } from "./index.js";
import type { RegisterOutboundTransferResult } from "./index.js";

const request: TransferRequest = {
  asset: "USDT0",
  from: { chain: "stellar", address: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q" },
  to: { chain: "arbitrum", address: "0x0000000000000000000000000000000000000001" },
  amount: "1",
};

class FakeUsdt0Adapter implements RailAdapter {
  readonly rail = "usdt0-layerzero" as const;
  constructor(private readonly store: TransferStore) {}

  supports(r: TransferRequest): boolean {
    return r.asset === "USDT0";
  }

  quote(r: TransferRequest): Promise<Quote> {
    return Promise.resolve({
      rail: this.rail,
      request: r,
      debit: { value: 10_000_000n, decimals: 7 },
      credit: { value: 1_000_000n, decimals: 6 },
      dust: { value: 0n, decimals: 7 },
      fees: [],
      etaSeconds: 60,
      checks: [],
      expiresAt: Number.MAX_SAFE_INTEGER,
      refundAddress: r.from.address,
    });
  }

  async build(quote: Quote): Promise<BuiltTransfer> {
    const transferId = newTransferId();
    await this.store.put({
      transferId,
      rail: this.rail,
      request: quote.request,
      createdAt: 0,
      railRef: { guid: "private-to-this-adapter" },
    });
    return { transferId, rail: this.rail, steps: [] };
  }

  async *track(transferId: TransferId): AsyncIterable<TransferStatus> {
    yield { transferId, stage: "submitted", updatedAt: 1 };
    yield { transferId, stage: "delivered", updatedAt: 2 };
  }
}

describe("Ferryline", () => {
  const make = (): Ferryline => {
    const ferryline = new Ferryline({ network: "testnet", rpcUrl: "http://localhost" });
    ferryline.registerAdapter(new FakeUsdt0Adapter(ferryline.store));
    return ferryline;
  };

  it("routes a request to the adapter that supports it", async () => {
    const ferryline = make();
    const quote = await ferryline.quote(request);
    expect(quote.rail).toBe("usdt0-layerzero");
    expect(ferryline.rails()).toEqual(["usdt0-layerzero"]);
  });

  it("rejects requests no adapter supports", async () => {
    const ferryline = make();
    await expect(ferryline.quote({ ...request, asset: "USDC" })).rejects.toMatchObject({
      code: "ROUTE_UNSUPPORTED",
    });
  });

  it("refuses two adapters for one rail", () => {
    const ferryline = make();
    expect(() => ferryline.registerAdapter(new FakeUsdt0Adapter(ferryline.store))).toThrowError(
      /already registered/,
    );
  });

  it("builds, remembers, and tracks a transfer end to end", async () => {
    const ferryline = make();
    const built = await ferryline.build(await ferryline.quote(request));
    await ferryline.markSubmitted(built.transferId, "deadbeef");
    expect(await ferryline.store.get(built.transferId)).toMatchObject({ sourceTxHash: "deadbeef" });

    const stages: string[] = [];
    for await (const status of ferryline.track(built.transferId)) {
      stages.push(status.stage);
    }
    expect(stages).toEqual(["submitted", "delivered"]);
  });

  it("cannot track a transfer it never built", async () => {
    const ferryline = make();
    const iterate = async (): Promise<void> => {
      for await (const status of ferryline.track(newTransferId())) {
        throw new Error(`unexpected status ${status.stage}`);
      }
    };
    await expect(iterate()).rejects.toMatchObject({ code: "TRANSFER_UNKNOWN" });
  });
});

/**
 * markSubmitted's automatic outbound-relayer registration (registerOutboundTransfer). A fake
 * "usdc-cctp" adapter with from.chain === "stellar" is used here specifically because
 * registerOutboundTransfer's own gate 2 detects "is this an outbound CCTP transfer" using ONLY
 * the rail-agnostic, already-public TransferRecord.rail/request fields (see that method's own doc
 * comment) — this fake exists to produce a record with exactly that real shape, not to exercise
 * any Circle/Iris-specific logic (which lives in UsdcCctpAdapter's own, separately-tested file).
 */
const outboundRequest: TransferRequest = {
  asset: "USDC",
  from: { chain: "stellar", address: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q" },
  to: { chain: "ethereum-sepolia", address: "0x1111111111111111111111111111111111111111" },
  amount: "1",
};

/**
 * `needsApprove` reproduces the REAL two-step shape a real outbound CCTP transfer takes when the
 * sender's existing USDC allowance doesn't already cover the amount (see adapter.ts's own
 * buildOutbound: steps = [approve, burn-deferred] in that case, vs. steps = [burn] when a standing
 * allowance already covers it). This fake exists specifically to reproduce the real double-
 * registration bug this project shipped and fixed: the widget used to call
 * registerOutboundTransfer-equivalent logic from inside markSubmitted itself, which fires once per
 * signed step — for a two-step transfer that meant firing on BOTH the approve step (wrong tx hash)
 * and the burn step (right tx hash), and the relayer's own transferId-primary-key rejected the
 * second, correct call as a duplicate of the first, wrong one.
 */
class FakeOutboundCctpAdapter implements RailAdapter {
  readonly rail = "usdc-cctp" as const;
  needsApprove = false;

  constructor(private readonly store: TransferStore) {}

  supports(r: TransferRequest): boolean {
    return r.asset === "USDC";
  }

  async build(quote: Quote): Promise<BuiltTransfer> {
    const transferId = newTransferId();
    await this.store.put({
      transferId,
      rail: this.rail,
      request: quote.request,
      createdAt: 0,
      railRef: {},
    });
    const steps: TransferStep[] = this.needsApprove
      ? [
          {
            chain: "stellar",
            kind: "stellar-transaction",
            xdr: "approve-xdr",
            description: "Approve the TokenMessengerMinter to spend USDC",
          },
          {
            chain: "stellar",
            kind: "stellar-transaction",
            xdr: "burn-xdr",
            description: "Burn USDC toward ethereum-sepolia via CCTP",
          },
        ]
      : [
          {
            chain: "stellar",
            kind: "stellar-transaction",
            xdr: "burn-xdr",
            description: "Burn USDC toward ethereum-sepolia via CCTP",
          },
        ];
    return { transferId, rail: this.rail, steps };
  }

  quote(r: TransferRequest): Promise<Quote> {
    return Promise.resolve({
      rail: this.rail,
      request: r,
      debit: { value: 1_000_000n, decimals: 6 },
      credit: { value: 1_000_000n, decimals: 6 },
      dust: { value: 0n, decimals: 6 },
      fees: [],
      checks: [],
      expiresAt: Number.MAX_SAFE_INTEGER,
      refundAddress: r.from.address,
    });
  }

  async *track(transferId: TransferId): AsyncIterable<TransferStatus> {
    yield { transferId, stage: "submitted", updatedAt: 1 };
    yield { transferId, stage: "verified", updatedAt: 2 };
    yield { transferId, stage: "delivered", updatedAt: 3 };
  }
}

/** Inbound (EVM -> Stellar) fake, sharing the "usdc-cctp" rail but with from.chain !== "stellar" —
 *  used to prove gate 2 correctly distinguishes direction, not just rail. */
const inboundCctpRequest: TransferRequest = {
  asset: "USDC",
  from: { chain: "ethereum-sepolia", address: "0x2222222222222222222222222222222222222222" },
  to: { chain: "stellar", address: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q" },
  amount: "1",
};

describe("Ferryline.markSubmitted: does NOT trigger relayer registration itself", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it(
    "REQUIRED regression test: markSubmitted alone never calls fetch, even for a real-shaped " +
      "outbound CCTP transfer with a relayer configured — registration is the caller's own, " +
      "separate, explicit responsibility (see registerOutboundTransfer's own doc comment for why)",
    async () => {
      const ferryline = new Ferryline({
        network: "testnet",
        rpcUrl: "http://localhost",
        relayerUrl: "http://relayer.example",
      });
      ferryline.registerAdapter(new FakeOutboundCctpAdapter(ferryline.store));
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const built = await ferryline.build(await ferryline.quote(outboundRequest));
      await ferryline.markSubmitted(built.transferId, "aa".repeat(32));

      expect(fetchSpy).not.toHaveBeenCalled();
      // markSubmitted's own real behavior (recording the hash) is unchanged.
      expect(await ferryline.store.get(built.transferId)).toMatchObject({
        sourceTxHash: "aa".repeat(32),
      });
    },
  );
});

describe("isFinalStep", () => {
  it("is true only for the last index in a steps array", () => {
    const oneStep: Pick<BuiltTransfer, "steps"> = { steps: [{} as TransferStep] };
    expect(isFinalStep(oneStep, 0)).toBe(true);

    const twoSteps: Pick<BuiltTransfer, "steps"> = {
      steps: [{} as TransferStep, {} as TransferStep],
    };
    expect(isFinalStep(twoSteps, 0)).toBe(false);
    expect(isFinalStep(twoSteps, 1)).toBe(true);
  });
});

describe("Ferryline.registerOutboundTransfer: called explicitly, only on the final step", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function makeOutbound(config: { relayerUrl?: string; relayerApiKey?: string } = {}): {
    ferryline: Ferryline;
    adapter: FakeOutboundCctpAdapter;
  } {
    const ferryline = new Ferryline({
      network: "testnet",
      rpcUrl: "http://localhost",
      ...config,
    });
    const adapter = new FakeOutboundCctpAdapter(ferryline.store);
    ferryline.registerAdapter(adapter);
    return { ferryline, adapter };
  }

  /**
   * Drives a full build -> sign-each-step -> (call registerOutboundTransfer only on the final
   * step, using isFinalStep) sequence, mirroring exactly what a real caller (the widget's
   * afterStepSubmitted, or a raw SDK integrator following registerOutboundTransfer's own doc
   * comment) is supposed to do. Returns the ordered list of tx hashes markSubmitted was called
   * with, AND the real RegisterOutboundTransferResult from the one registerOutboundTransfer call
   * (undefined if the built transfer had zero steps, which never happens in practice), so callers
   * can assert on the honest result, not just on fetch having been called the right number of times.
   */
  async function driveAllSteps(
    ferryline: Ferryline,
    built: BuiltTransfer,
    hashFor: (stepIndex: number) => string,
  ): Promise<{
    readonly hashes: string[];
    readonly registrationResult: RegisterOutboundTransferResult | undefined;
  }> {
    const hashes: string[] = [];
    let registrationResult: RegisterOutboundTransferResult | undefined;
    for (let stepIndex = 0; stepIndex < built.steps.length; stepIndex += 1) {
      const hash = hashFor(stepIndex);
      hashes.push(hash);
      await ferryline.markSubmitted(built.transferId, hash);
      if (isFinalStep(built, stepIndex)) {
        registrationResult = await ferryline.registerOutboundTransfer(built.transferId);
      }
    }
    return { hashes, registrationResult };
  }

  it(
    "REQUIRED test: two-step transfer (approve + burn) — registration fires EXACTLY ONCE, with " +
      "the real BURN tx hash, never the approve's",
    async () => {
      const { ferryline, adapter } = makeOutbound({ relayerUrl: "http://relayer.example" });
      adapter.needsApprove = true;
      const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(JSON.stringify({ id: "x", status: "pending" }), { status: 201 }),
        ),
      );
      globalThis.fetch = fetchMock;

      const built = await ferryline.build(await ferryline.quote(outboundRequest));
      expect(built.steps).toHaveLength(2); // real two-step shape: approve (index 0), burn (index 1)

      const approveTxHash = "aa".repeat(32);
      const burnTxHash = "bb".repeat(32);
      const { hashes, registrationResult } = await driveAllSteps(ferryline, built, (i) =>
        i === 0 ? approveTxHash : burnTxHash,
      );
      expect(hashes).toEqual([approveTxHash, burnTxHash]); // both steps really got submitted/recorded
      // The honest result reports real success — not just "fetch was called the right number of
      // times", the actual RegisterOutboundTransferResult a caller like the widget reacts to.
      expect(registrationResult).toEqual({ registered: true });

      // The core assertion: exactly ONE registration call, and it carries the BURN hash — not the
      // approve's. This is the exact scenario the original bug produced two calls for (the wrong
      // one first), which the relayer's own transferId primary key would have then rejected the
      // correct one as a duplicate of.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://relayer.example/outbound-transfers");
      expect(JSON.parse(init!.body as string)).toEqual({
        transferId: built.transferId,
        sourceTxHash: burnTxHash,
        destinationChain: "ethereum-sepolia",
        rail: "usdc-cctp",
      });

      // And the store itself, independently, also shows the final, real burn hash — not the
      // approve's — confirming markSubmitted's own overwrite-on-each-call semantics land correctly
      // by the time registration reads from it.
      expect(await ferryline.store.get(built.transferId)).toMatchObject({
        sourceTxHash: burnTxHash,
      });
    },
  );

  it(
    "one-step transfer (standing allowance, no approve needed) still registers correctly — the " +
      "two-step fix must not break the simpler, more common path",
    async () => {
      const { ferryline, adapter } = makeOutbound({ relayerUrl: "http://relayer.example" });
      adapter.needsApprove = false;
      const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(JSON.stringify({ id: "x", status: "pending" }), { status: 201 }),
        ),
      );
      globalThis.fetch = fetchMock;

      const built = await ferryline.build(await ferryline.quote(outboundRequest));
      expect(built.steps).toHaveLength(1); // real one-step shape: burn only, index 0 is final

      const burnTxHash = "cc".repeat(32);
      const { hashes, registrationResult } = await driveAllSteps(
        ferryline,
        built,
        () => burnTxHash,
      );
      expect(hashes).toEqual([burnTxHash]);
      expect(registrationResult).toEqual({ registered: true });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://relayer.example/outbound-transfers");
      expect(JSON.parse(init!.body as string)).toEqual({
        transferId: built.transferId,
        sourceTxHash: burnTxHash,
        destinationChain: "ethereum-sepolia",
        rail: "usdc-cctp",
      });
    },
  );

  it("does NOT call fetch at all when no relayerUrl is configured (gate 1: silent skip, not an error)", async () => {
    const { ferryline } = makeOutbound(); // no relayerUrl
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const built = await ferryline.build(await ferryline.quote(outboundRequest));

    await ferryline.markSubmitted(built.transferId, "aa".repeat(32));
    // Not-applicable gate: registered: false, no error — see RegisterOutboundTransferResult's own
    // doc comment for why this stays the same silent "nothing to show the user" outcome it always
    // was, not a new caller-facing failure.
    await expect(ferryline.registerOutboundTransfer(built.transferId)).resolves.toEqual({
      registered: false,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT register a transfer whose rail/direction is not outbound CCTP (gate 2: silent skip)", async () => {
    const ferryline = new Ferryline({
      network: "testnet",
      rpcUrl: "http://localhost",
      relayerUrl: "http://relayer.example",
    });
    ferryline.registerAdapter(new FakeOutboundCctpAdapter(ferryline.store));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Register an INBOUND-shaped record directly (bypassing quote/build, which the fake adapter
    // ties to outboundRequest) so this test exercises gate 2's own from.chain check in isolation.
    const transferId = newTransferId();
    await ferryline.store.put({
      transferId,
      rail: "usdc-cctp",
      request: inboundCctpRequest,
      createdAt: 0,
      railRef: {},
    });

    await ferryline.markSubmitted(transferId, "0x" + "bb".repeat(32));
    // Not-applicable gate: registered: false, no error — same silent outcome as gate 1.
    await expect(ferryline.registerOutboundTransfer(transferId)).resolves.toEqual({
      registered: false,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it(
    "REQUIRED test: registration failure (relayer unreachable) does NOT throw, and the " +
      "underlying transfer flow (track()) completes completely normally regardless",
    async () => {
      const { ferryline } = makeOutbound({ relayerUrl: "http://relayer.example" });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      globalThis.fetch = vi.fn(() =>
        Promise.reject(new Error("simulated network failure: relayer unreachable")),
      );

      const built = await ferryline.build(await ferryline.quote(outboundRequest));
      await ferryline.markSubmitted(built.transferId, "dd".repeat(32));

      // The core assertion: registerOutboundTransfer itself must resolve normally, not reject —
      // AND now honestly report the real failure in its result, not silently report success (the
      // real bug a live, misconfigured relayer API key surfaced: the widget's own UI claimed
      // "registered with the configured relayer" for a registration that had actually failed).
      await expect(ferryline.registerOutboundTransfer(built.transferId)).resolves.toEqual({
        registered: false,
        error: expect.stringContaining("simulated network failure") as string,
      });

      // The failure was logged (visible to an operator), not silently swallowed without a trace.
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("registerOutboundTransfer"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("simulated network failure"),
      );

      // And the underlying transfer flow (track()) is completely unaffected by the relayer
      // failure — proving the burn/track() flow the user's own requirement calls out never breaks.
      const stages: string[] = [];
      for await (const status of ferryline.track(built.transferId)) {
        stages.push(status.stage);
      }
      expect(stages).toEqual(["submitted", "verified", "delivered"]);
    },
  );

  it("logs (does not throw) when the relayer responds with a non-201 status", async () => {
    const { ferryline } = makeOutbound({ relayerUrl: "http://relayer.example" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "a transfer for this sourceTxHash already exists" }), {
          status: 409,
        }),
      ),
    );

    const built = await ferryline.build(await ferryline.quote(outboundRequest));
    await ferryline.markSubmitted(built.transferId, "ee".repeat(32));
    await expect(ferryline.registerOutboundTransfer(built.transferId)).resolves.toEqual({
      registered: false,
      error: expect.stringContaining("already exists") as string,
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });
});
