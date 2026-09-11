import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FERRYLINE_SDK_USER_AGENT, SDK_VERSION } from "./version.js";

describe("SDK version", () => {
  it("matches package.json", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version: string;
    };
    expect(SDK_VERSION).toBe(pkg.version);
    expect(FERRYLINE_SDK_USER_AGENT).toBe(`ferryline-sdk/${pkg.version}`);
  });
});
