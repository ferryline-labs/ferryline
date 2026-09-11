import { describe, expect, it } from "vitest";

import type { FerrylineError } from "./errors.js";
import type { TransferRecord } from "./store.js";
import { InMemoryTransferStore } from "./store.js";
import { newTransferId } from "./transfer-id.js";

function record(): TransferRecord {
  return {
    transferId: newTransferId(),
    rail: "usdt0-layerzero",
    request: {
      asset: "USDT0",
      from: { chain: "stellar", address: "G..." },
      to: { chain: "arbitrum", address: "0x..." },
      amount: "1",
    },
    createdAt: 0,
    railRef: { anything: "the adapter wants" },
  };
}

describe("InMemoryTransferStore", () => {
  it("stores and returns records by id", async () => {
    const store = new InMemoryTransferStore();
    const r = record();
    await store.put(r);
    expect(await store.get(r.transferId)).toEqual(r);
    expect(await store.get(newTransferId())).toBeUndefined();
  });

  it("marks a transfer submitted without touching the rest of the record", async () => {
    const store = new InMemoryTransferStore();
    const r = record();
    await store.put(r);
    await store.markSubmitted(r.transferId, "abc123");
    expect(await store.get(r.transferId)).toEqual({ ...r, sourceTxHash: "abc123" });
  });

  it("refuses to mark an unknown transfer", async () => {
    const store = new InMemoryTransferStore();
    await expect(store.markSubmitted(newTransferId(), "x")).rejects.toMatchObject({
      code: "TRANSFER_UNKNOWN",
    } satisfies Partial<FerrylineError>);
  });
});
