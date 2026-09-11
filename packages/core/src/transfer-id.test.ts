import { describe, expect, it } from "vitest";

import { FerrylineError } from "./errors.js";
import {
  TRANSFER_ID_LENGTH,
  assertTransferId,
  isTransferId,
  newTransferId,
  transferIdTime,
} from "./transfer-id.js";

const CANONICAL = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

describe("newTransferId", () => {
  it("mints canonical 26-character ULIDs", () => {
    const id = newTransferId();
    expect(id).toHaveLength(TRANSFER_ID_LENGTH);
    expect(id).toMatch(CANONICAL);
    expect(isTransferId(id)).toBe(true);
  });

  it("never repeats", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      ids.add(newTransferId());
    }
    expect(ids.size).toBe(10_000);
  });

  it("sorts in creation order even within one millisecond", () => {
    const seed = 1_700_000_000_000;
    const ids = Array.from({ length: 500 }, () => newTransferId(seed));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("encodes the seed time when the seed is ahead of everything minted so far", () => {
    const seed = Date.now() + 24 * 60 * 60 * 1000;
    expect(transferIdTime(newTransferId(seed))).toBe(seed);
  });

  it("does not travel back in time for an older seed (monotonic)", () => {
    const later = newTransferId(Date.now() + 48 * 60 * 60 * 1000);
    const olderSeed = newTransferId(1_000);
    expect(transferIdTime(olderSeed)).toBeGreaterThanOrEqual(transferIdTime(later));
    expect(olderSeed > later).toBe(true);
  });
});

describe("isTransferId / assertTransferId", () => {
  it.each([
    "",
    "abc",
    "01ARZ3NDEKTSV4RRFFQ69G5FA",
    "01arz3ndektsv4rrffq69g5fav",
    "81ARZ3NDEKTSV4RRFFQ69G5FAV",
    null,
    12,
  ])("rejects %j", (value) => {
    expect(isTransferId(value)).toBe(false);
    let caught: unknown;
    try {
      assertTransferId(value);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FerrylineError);
    expect((caught as FerrylineError).code).toBe("TRANSFER_ID_INVALID");
  });

  it("accepts a canonical ULID", () => {
    expect(isTransferId("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
    expect(assertTransferId("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });
});
