# Publishing a package

There is exactly one correct way to publish any of this monorepo's packages to npm. This document
exists because that wasn't always documented anywhere, and the gap had a real, direct consequence
— see [the incident](#the-incident-this-document-exists-because-of) below before you skip ahead.

## The one correct command

From the repo root:

```bash
pnpm run publish:core
pnpm run publish:sdk
pnpm run publish:widget   # once @ferryline/widget has had its first real release — see below
```

Each of these is a thin wrapper around `pnpm --filter <package-name> publish` — nothing more. They
exist so nobody needs to remember (or look up) the right `pnpm --filter ...` invocation by hand.

**Do not run `npm publish` directly, and do not `cd` into a package and run `pnpm publish` without
going through the root wrapper script**, even though the wrapper is "just" that same command. The
reason is explained below — read it once, it's short.

## Why this has to be `pnpm publish`, never `npm publish`

This monorepo's own packages depend on each other using pnpm's `workspace:*` protocol — for
example, `packages/sdk/package.json` declares `"@ferryline/core": "workspace:*"`. That protocol
string only means something _inside_ a pnpm workspace. When pnpm packs or publishes a package, it
rewrites every `workspace:*` dependency to the real, currently-resolved version of that dependency
(e.g. `workspace:*` → `0.1.0`) before the tarball is assembled — this is pnpm's own, standard,
long-established behavior, not something this repo configured.

**Plain `npm publish` does not do this rewrite at all.** It packs and publishes whatever the
`package.json` literally says, including the unresolved `workspace:*` string. A package published
this way ships a dependency requirement that means nothing to npm's own resolver outside this
workspace — installing it fails outright for every real consumer.

## The incident this document exists because of

On 2026-09-15, `@ferryline/sdk@0.1.2` was published via plain `npm publish` (not `pnpm publish`).
The real, live, published package's `dependencies` field read:

```json
{ "@ferryline/core": "workspace:*" }
```

A genuinely clean `npm install @ferryline/sdk` — run outside this monorepo, against the real public
registry, with no local cache or workspace interference — failed immediately:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

Every real attempt to install `@ferryline/sdk@0.1.2` from npm hit this failure, from the moment it
was published. The two earlier releases (`0.1.0`, `0.1.1`) were correct — both were published
before this gap was found, apparently via the right command at the time, but nothing in the repo
enforced that. There was no `PUBLISHING.md`, no CI publish workflow, no check of any kind — the
correctness of every prior release depended entirely on whichever human ran the publish happening
to type the right command that day. `0.1.2` is the day that didn't hold.

The existing `scripts/prepare-publish.mjs` mechanism in each package (wired as `prepack`/`postpack`)
was investigated as a possible cause and ruled out: it only strips non-shippable `scripts` entries
(`build`, `test`, etc.) from what ships — it has no logic touching `dependencies` at all, and never
did. It was never the thing keeping `workspace:*` out of a published package; that was always
implicit in using `pnpm publish` specifically, and that was never enforced.

## What actually stops this from happening again

Every publishable package's `package.json` has a `prepublishOnly` script that runs
[`scripts/assert-pnpm-publish.mjs`](scripts/assert-pnpm-publish.mjs) (one shared file, imported by
relative path from each package rather than duplicated). `prepublishOnly` runs before **both**
`npm publish` and `pnpm publish` — confirmed directly against real npm and pnpm binaries, including
under `--dry-run` — so it fires regardless of which command was actually typed.

The check itself reads `process.env.npm_config_user_agent`, an environment variable set by the
package manager itself (not something a caller sets or could forget to set) — confirmed directly to
start with `pnpm/...` under real pnpm commands and `npm/...` under real npm ones. If it doesn't
start with `pnpm/`, the script hard-fails with a message naming the correct command to run instead,
so the failure itself teaches the fix on the spot rather than just refusing silently.

This was deliberately **not** implemented as "pack the tarball and grep its `package.json` for
`workspace:`" — that approach was tried first and rejected: a pack-based check invoked from inside a
hook that is itself running under plain `npm` would call `npm pack`, not `pnpm pack`, and reproduce
the exact same unrewritten, broken result it's supposed to be checking for. The env-var check has no
such blind spot — it identifies the tool that is _currently running_, not a downstream artifact of
it that could itself be wrong for the same reason.

## Before every real publish

1. Make sure the version in `package.json` is actually new — bump it first, on a branch, with a
   real `CHANGELOG.md` entry (see any existing package's `CHANGELOG.md` for the format), merged to
   `main` before you publish. Once a version is published to npm, it cannot be overwritten or
   deleted (short of npm's own unpublish window, which mostly doesn't apply once a version has real
   time or downloads behind it) — a mistake published as a real version stays that version forever;
   the fix is always a new version, never a correction to the old one.
2. Run the full toolchain clean: build, typecheck, lint, format, the full test suite.
3. Dry run first: `pnpm --filter <package> publish --dry-run`. Then, the real, load-bearing check —
   don't just read the dry-run's own summary, actually unpack the tarball it would produce and read
   the literal `package.json` inside it:
   ```bash
   cd packages/<package>
   pnpm pack --pack-destination /tmp/publish-check
   tar xzf /tmp/publish-check/*.tgz -C /tmp/publish-check
   cat /tmp/publish-check/package/package.json   # confirm every workspace:* is a real version
   ```
4. Only then: `pnpm run publish:<package>` from the repo root.
5. After a real publish, verify it landed correctly on the actual registry, not just locally:
   `npm view @ferryline/<package> version` (registry propagation can take up to a couple of minutes
   — if it still shows the old version, wait and recheck rather than assuming something went wrong),
   then a genuinely clean `npm install @ferryline/<package>` in an empty directory outside this repo,
   to catch exactly the class of failure this document exists because of.
