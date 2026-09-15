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
