import type {
  BuiltTransfer,
  Quote,
  RailAdapter,
  TransferId,
  TransferRequest,
  TransferStatus,
  TransferStore,
} from "@ferryline/core";
import { newTransferId } from "@ferryline/core";
import { describe, expect, it } from "vitest";

import { Ferryline } from "./index.js";

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
