import { FerrylineError } from "@ferryline/core";
import { describe, expect, it } from "vitest";

import { nonceUsed } from "./stellar.js";

/**
 * Discovered while building the relayer's crash-recovery test (phase 3, 2026-09-11): passing a
 * malformed-length nonce to is_nonce_used is not caught client-side and instead reaches Soroban,
 * which traps with an opaque `HostError: Error(WasmVm, InvalidAction)` — confirmed against real
 * mainnet simulation. `nonceUsed` now rejects the wrong length before ever calling simulateTransaction.
 */
describe("nonceUsed", () => {
  it("rejects a nonce that is not exactly 32 bytes before touching the network", async () => {
    const neverCalled = {
      rpc: {
        simulateTransaction: () => {
          throw new Error("simulateTransaction must not be called for a malformed nonce");
        },
        getTransaction: () => Promise.reject(new Error("unused")),
        getLedgerEntries: () => Promise.reject(new Error("unused")),
        getLatestLedger: () => Promise.reject(new Error("unused")),
        getAccount: () => Promise.reject(new Error("unused")),
      },
      source: {
        accountId: () => "G",
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => undefined,
      } as never,
      networkPassphrase: "Test SDF Network ; September 2015",
    };

    let caught31: unknown;
    try {
      await nonceUsed(
        neverCalled,
        "CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV",
        new Uint8Array(31),
      );
    } catch (error) {
      caught31 = error;
    }
    expect(caught31).toBeInstanceOf(FerrylineError);
    expect((caught31 as FerrylineError).code).toBe("PARAMETER_INVALID");
    expect((caught31 as FerrylineError).message).toContain("32-byte");

    let caught33: unknown;
    try {
      await nonceUsed(
        neverCalled,
        "CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV",
        new Uint8Array(33),
      );
    } catch (error) {
      caught33 = error;
    }
    expect(caught33).toBeInstanceOf(FerrylineError);
    expect((caught33 as FerrylineError).code).toBe("PARAMETER_INVALID");
  });
});
