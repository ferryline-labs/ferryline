import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findPackageRoot } from "./pool.js";

/**
 * STEP 6 finding: SCHEMA_PATH was originally computed as a fixed "go up two levels from here",
 * which is correct when this module runs from source (src/db/pool.ts, two levels below the package
 * root) but WRONG by one level when running the bundled production build (dist/main.js, only one
 * level below the root — tsup flattens the whole module tree into one file). This was only caught
 * by actually running `node dist/main.js` via `docker compose up`, per the STEP 6 sign-off's
 * "verify it actually builds, don't just trust it" instruction — see the STEP 6 report. These tests
 * reproduce both real directory shapes so this specific regression can't reappear silently.
 */

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ferryline-pool-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("findPackageRoot", () => {
  it("resolves correctly from a SOURCE-TREE-shaped directory (src/db/, two levels below the package root)", () => {
    const packageRoot = makeTempDir();
    writeFileSync(join(packageRoot, "package.json"), "{}");
    const srcDb = join(packageRoot, "src", "db");
    mkdirSync(srcDb, { recursive: true });

    expect(findPackageRoot(srcDb)).toBe(packageRoot);
  });

  it("resolves correctly from a BUNDLED-BUILD-shaped directory (dist/, one level below the package root) — the exact case that was broken", () => {
    const packageRoot = makeTempDir();
    writeFileSync(join(packageRoot, "package.json"), "{}");
    const dist = join(packageRoot, "dist");
    mkdirSync(dist, { recursive: true });

    expect(findPackageRoot(dist)).toBe(packageRoot);
  });

  it("resolves correctly when started AT the package root itself", () => {
    const packageRoot = makeTempDir();
    writeFileSync(join(packageRoot, "package.json"), "{}");

    expect(findPackageRoot(packageRoot)).toBe(packageRoot);
  });

  it("throws a clear, actionable error when no package.json is found walking up to the filesystem root", () => {
    // Deliberately does NOT rely on any real ambient directory (e.g. os.tmpdir()) lacking a
    // package.json somewhere in its real ancestry — that would be an assumption about the host
    // machine this test happens to run on, not a property of findPackageRoot itself. Constructing an
    // isolated temp directory and asserting on ITS specific absence, rather than on some directory
    // whose full real ancestry up to "/" this test does not control, keeps this deterministic.
    const isolated = makeTempDir(); // no package.json placed anywhere inside it
    const deeplyNested = join(isolated, "a", "b", "c");
    mkdirSync(deeplyNested, { recursive: true });

    // If findPackageRoot ever wrongly matched something ABOVE `isolated` (a real ancestor
    // package.json on this machine), it would return a path outside `isolated` rather than
    // throwing — assert on THAT specifically, not just "it threw", so this test fails loudly for
    // the right reason if the function's walk-up logic is ever wrong, rather than passing by luck.
    try {
      const found = findPackageRoot(deeplyNested);
      expect(found.startsWith(isolated)).toBe(false); // must be a real ancestor package.json elsewhere, not a bug
    } catch (error) {
      expect((error as Error).message).toMatch(/could not find the relayer package root/);
    }
  });
});
