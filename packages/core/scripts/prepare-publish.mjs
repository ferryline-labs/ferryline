#!/usr/bin/env node
// Wired as this package's own `prepack`/`postpack` lifecycle scripts (see package.json) — pnpm
// runs `prepack` right before assembling the tarball (for both `pnpm pack` and `pnpm publish`,
// confirmed directly: a standalone repro showed the hook completing, and a file it wrote, present
// in the resulting tarball, before packing happened) and `postpack` right after. This is NOT a
// build step; it never touches dist/ or anything a consumer imports — it only edits the package's
// own manifest, and only for the few seconds pnpm spends assembling the tarball.
//
// Why this exists: `build`, `typecheck`, `test`, and `clean` are real, working scripts when run
// from this package's own source checkout inside the monorepo (Turbo and this repo's CI genuinely
// invoke them by these exact names — removing them from the SOURCE package.json would break the
// real dev/CI pipeline). But none of them work post-install: the published tarball ships only
// `dist/`, `LICENSE`, and `package.json` — no `tsconfig.json`, no `tsup.config.ts`, no
// `vitest.config.ts`, no `src/`. Verified directly, each one, against a real extracted tarball
// before writing this script:
//   - `build` ("tsup"): fails — tsup isn't a dependency of the published package and its own
//     config file isn't shipped.
//   - `typecheck` ("tsc --noEmit -p tsconfig.json"): fails — no tsconfig.json ships.
//   - `test` ("vitest run"): fails — vitest isn't a dependency and there's nothing to run against.
//   - `clean` ("rm -rf dist .turbo"): the most important one to catch — this one does NOT fail,
//     it actually runs and deletes the installed package's own dist/ directory. Silently
//     destructive if anyone finds it in an installed copy and runs it, not just dead weight.
//   - `prepublishOnly` (see ../../scripts/assert-pnpm-publish.mjs): points at a relative path
//     (`../../scripts/...`) that only resolves from inside this monorepo checkout — meaningless
//     (a broken path, not destructive) in an installed copy, same reasoning as prepack/postpack
//     themselves getting stripped below.
//
// So: real scripts stay untouched in the real source package.json, forever — this only rewrites
// the copy that gets packed, and puts the original back immediately afterward via `postpack`.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const backupPath = `${packageJsonPath}.publish-backup`;

// Every script name in this package's real, current `scripts` block that does NOT work against
// the published tarball as installed. Checked individually, not pattern-matched by name — see the
// file-level comment above for each one's real, confirmed failure mode. `prepack`/`postpack`
// themselves are included here too: they're this exact publish-prep mechanism, meaningful only
// while pnpm is assembling the tarball from the real source checkout — equally dead weight (though
// not destructive) in an installed copy, so they get stripped from what ships the same as the rest.
const NON_SHIPPABLE_SCRIPTS = [
  "build",
  "typecheck",
  "test",
  "clean",
  "prepublishOnly",
  "prepack",
  "postpack",
];

const mode = process.argv[2];
if (mode === "strip") {
  copyFileSync(packageJsonPath, backupPath);
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (pkg.scripts) {
    for (const name of NON_SHIPPABLE_SCRIPTS) {
      delete pkg.scripts[name];
    }
    if (Object.keys(pkg.scripts).length === 0) {
      delete pkg.scripts;
    }
  }
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`prepare-publish.mjs: stripped [${NON_SHIPPABLE_SCRIPTS.join(", ")}] for packing`);
} else if (mode === "restore") {
  copyFileSync(backupPath, packageJsonPath);
  unlinkSync(backupPath);
  console.log("prepare-publish.mjs: restored the real source package.json");
} else {
  throw new Error(
    `prepare-publish.mjs: expected "strip" or "restore", got ${JSON.stringify(mode)}`,
  );
}
