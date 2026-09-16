#!/usr/bin/env node
// Shared by every publishable package's own `prepublishOnly` script (see
// packages/sdk/package.json, packages/core/package.json, packages/widget/package.json) — a single
// file imported by relative path rather than duplicated per package, since the check itself has no
// per-package variation.
//
// Real incident this exists to prevent, documented in full in /PUBLISHING.md: @ferryline/sdk@0.1.2
// was published via plain `npm publish` on 2026-09-15. Unlike `pnpm publish`, plain npm does not
// rewrite the `workspace:*` protocol used for this monorepo's own internal dependencies
// (`"@ferryline/core": "workspace:*"`) to a real, resolvable version — so the published package
// shipped that literal, meaningless-outside-a-workspace string as its own dependency's version
// requirement. Confirmed directly: a real, clean `npm install @ferryline/sdk` outside this monorepo
// failed outright with `EUNSUPPORTEDPROTOCOL`, for every consumer, from the moment 0.1.2 went out.
//
// prepublishOnly runs before BOTH `npm publish` and `pnpm publish` (and their --dry-run forms) —
// confirmed directly against real npm/pnpm binaries before writing this — making it the one hook
// that can structurally block the wrong command regardless of what was actually typed, rather than
// relying on a human remembering to use pnpm (the same reliance that already failed once). It
// checks `npm_config_user_agent`, an environment variable set BY the tool itself (not something a
// caller sets or could forget to set) — confirmed directly to start with `pnpm/...` under real pnpm
// commands and `npm/...` under real npm ones.
//
// Deliberately NOT implemented as "pack the tarball and grep its package.json for workspace:" —
// tested that approach first and rejected it: a pack-based check invoked from inside a hook that is
// itself running under plain npm would call `npm pack`, not `pnpm pack`, and reproduce the exact
// same unrewritten, broken result being checked for — a false negative that would pass every time
// it needs to fail. The env-var check has no such blind spot: it identifies the CURRENTLY RUNNING
// tool directly, not a downstream artifact of it.
//
// SECOND real incident this now also prevents, found the same day the first was fixed:
// @ferryline/widget@0.1.2 was published with a STALE dist/ — the real pollPrepareStep fix was
// merged to main and `git pull`'d locally, but the publisher's own dist/index.js on disk still
// predated that pull (last built before the merge, never rebuilt after), and `pnpm run
// publish:widget` packed whatever was on disk without checking it was current. Confirmed directly:
// the published tarball's dist/index.js still contained the old, already-proven-broken
// POST_APPROVE_BUILD_DELAY_MS fixed timer, not the fix the version bump claimed to ship. Neither
// `core` nor `sdk` had ever guarded against this either — their own prepack scripts (see
// scripts/prepare-publish.mjs) only strip non-shippable script names from the manifest, they never
// touch dist/ at all. This was true of every prior successful publish too: dist/ happened to
// already be fresh by luck/discipline, never by a real guardrail. Fixed below by rebuilding for
// real, from the CURRENT checked-out source, every time, right before packing — this makes "the
// dist/ that gets packed doesn't match the source that was just reviewed/merged" structurally
// impossible, the same way the pnpm-vs-npm check above makes the workspace:* class impossible.
import { execFileSync } from "node:child_process";

const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error(
    [
      "",
      "✖ Refusing to publish: this must be run via pnpm, not npm or yarn.",
      "",
      `  Detected tool: ${userAgent || "(unknown — npm_config_user_agent was not set at all)"}`,
      "",
      "  Plain `npm publish` does not rewrite this monorepo's internal",
      '  "workspace:*" dependency versions to a real, resolvable version before',
      "  packing — the published package ships the literal string",
      '  "workspace:*" as a dependency requirement, which breaks installation',
      "  for every real consumer outside this monorepo (confirmed real incident:",
      "  @ferryline/sdk@0.1.2, see /PUBLISHING.md for the full story).",
      "",
      "  Run this instead, from the repo root:",
      "",
      "    pnpm run publish:sdk      # for packages/sdk",
      "    pnpm run publish:core     # for packages/core",
      "    pnpm run publish:widget   # for packages/widget (once it has its first real release)",
      "",
      "  Or directly: pnpm --filter <package-name> publish",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Rebuilds THIS package (the one whose prepublishOnly invoked this script — cwd is that package's
// own directory, since npm/pnpm run lifecycle scripts from the package root) from the real, current
// checked-out source, every time, right before pnpm assembles the tarball. Uses each package's own
// real "build" script (already proven to work — the same one CI and local development already run),
// not a duplicated build command here, so a future change to how a package builds only needs
// updating in one place.
console.error("📦 Rebuilding from current source before packing (prepublishOnly)…");
try {
  execFileSync("pnpm", ["run", "build"], { stdio: "inherit" });
} catch {
  console.error(
    [
      "",
      "✖ Refusing to publish: the rebuild above failed.",
      "",
      "  Fix the build error and try again. Publishing a package whose dist/ failed",
      "  to build from the current source would ship either stale or broken output —",
      "  neither is acceptable.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
