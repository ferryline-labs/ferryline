# Contributing to Ferryline

Thanks for considering this. Ferryline is Apache-2.0 and every piece of it is meant to be
self-hostable and independently verifiable, contributions are welcome, and this document exists so
you don't have to reverse-engineer the project's own standards from its git history.

## What this project actually is right now

Seven real, tested packages: `@ferryline/core`, `@ferryline/sdk`, `ferryline-relayer`,
`@ferryline/widget`, `@ferryline/design-tokens` (shared design-token values, no framework
dependency of its own), `ferryline-router` (a Soroban contract, its own Cargo workspace), and
`@ferryline/site` (the landing page you're probably reading this from a link on). 337 automated
tests currently pass across all seven (305 TypeScript, 32 Rust). `@ferryline/core` and
`@ferryline/sdk` are the only two published to npm so far (both at `0.1.0`, real, live, public).
Nothing is on mainnet yet. See
[README.md](README.md) for what each package does and [ARCHITECTURE.md](ARCHITECTURE.md) for how
they fit together technically.

## The one standard that matters more than any other: verify, don't assume

This project's whole discipline rests on a simple rule: a claim about how Stellar, LayerZero, or
Circle actually behaves is either checked against a real deployed contract or a real transaction,
or it's marked unverified, in the open, in the repo. Not "probably works." Not "the docs say so."
Checked, or flagged.

Concretely, that means:

- [packages/core/VERIFIED.md](packages/core/VERIFIED.md) records every upstream protocol fact the
  code depends on, sourced and dated, with an explicit "not yet verified, do not build on these"
  section for anything still open, and a revision history for anything found wrong after shipping.
- [contracts/router/THREAT_MODEL.md](contracts/router/THREAT_MODEL.md) does the same for the
  router's own security invariants: each one is backed by a specific, real, currently-passing test,
  and several were only closed by real mutation testing, deliberately reintroducing a bug to
  confirm the test suite actually catches it, not just that it currently passes.
- [packages/core/verified/experiments/](packages/core/verified/experiments/) holds dated,
  real-money-or-explicitly-BLOCKED records of every attempt to answer a specific, narrow question
  against live infrastructure. A `BLOCKED` verdict means exactly that, the question genuinely
  wasn't answered, not "probably fine."

If you're adding a rail, a check, or a claim about how something upstream behaves, follow the same
pattern: real evidence, dated, checked in. If you can't get real evidence (no funded account, no
mainnet access), say so explicitly rather than shipping an assumption with a default value baked
in. This project has, more than once, found real bugs specifically because a required parameter
had no default and a caller had to think about it, don't remove that friction to make an API feel
smoother.

## Setting up

```sh
git clone https://github.com/ferryline-labs/ferryline.git
cd ferryline
pnpm install
```

Requirements: Node 22.12+ (CI uses 24), pnpm 11, Rust stable with the `wasm32v1-none` target, and
[stellar-cli](https://github.com/stellar/stellar-cli) 26 for the contract build.

## Running everything

```sh
pnpm build            # turbo: builds every TypeScript package in dependency order
pnpm test             # vitest in every package (305 TypeScript tests as of this writing)
pnpm typecheck
pnpm lint             # eslint, zero errors expected
pnpm format           # prettier --check, zero violations expected

cd contracts/router
cargo fmt --check
cargo clippy --all-targets
cargo test            # 32 tests
stellar contract build
```

**`pnpm lint` and `pnpm format` are both part of this project's real definition of green**, not
optional extras. A change that passes `pnpm test` but fails `pnpm lint` is not done. Run all of
build/typecheck/lint/format/test before opening a PR, the same standard the project's own CI
enforces (`.github/workflows/ci.yml`).

The relayer additionally has real, live-database integration tests that need a running Postgres
instance:

```sh
cd packages/relayer
docker compose up -d postgres
pnpm vitest run --config vitest.integration.config.ts
```

The widget additionally has a real, manual (and semi-scripted) end-to-end test against an actual
installed browser wallet extension, see
[packages/widget/e2e/README.md](packages/widget/e2e/README.md) for how to reproduce it.

To view the landing page locally: `pnpm --filter @ferryline/site dev`.

## Where help is genuinely needed right now

Every item below is a real, currently open gap, not invented busywork, each links to the evidence
behind it. The landing page's own "Open source" section lists these too, kept in sync by hand,
if one of these resolves, it should be updated or removed in both places, the same way this
project's verified-facts files get a dated revision entry rather than a silent edit.

### Outbound CCTP delivery has no relayer (new service, real scope, not started)

Stellar → EVM CCTP transfers need someone to submit the completing `receiveMessage` call on the
destination chain, confirmed directly against Circle's own documentation: an API consumer must
submit the attested message themselves, Circle's infrastructure doesn't do it automatically, on
testnet or mainnet. Nothing in this repo does this automatically today (`packages/relayer/` is
inbound-only, EVM → Stellar). This is explicitly out of scope for the phase that discovered it, not
forgotten, see the risk register in [technical-doc.md](technical-doc.md) and
[ARCHITECTURE.md](ARCHITECTURE.md)'s security-model section for the full write-up. Building a
dedicated outbound relayer, mirroring the existing inbound one, is real, scoped, future work.

### Inbound USDT0 to a Stellar smart-account (C-address) recipient

Whether LayerZero's OFT can deliver USDT0 to a Soroban smart-account recipient at all is genuinely
untested, the SDK currently refuses this (`UNSUPPORTED_RECIPIENT_KIND`) rather than assume it
works. Blocked on a funded mainnet operator and a real Stellar smart account to target, not on
code, see
[packages/core/verified/experiments/2026-09-11-inbound-usdt0-c-address.md](packages/core/verified/experiments/2026-09-11-inbound-usdt0-c-address.md).
The companion question, what happens when USDT0 arrives at an account with no trustline and
whether delivery retries once one is added, is equally open, see the sibling
[...-no-trustline.md](packages/core/verified/experiments/2026-09-11-inbound-usdt0-no-trustline.md)
file. If you can fund a real mainnet operator account and run either experiment for real, that's a
direct, high-value contribution, see each file's own header for exactly what's needed.

### Documentation

The project holds itself to a high evidence bar; if you find a claim in any README, in
`ARCHITECTURE.md`, or in the verified-facts documents that doesn't match the current real code,
that's a real bug in the docs, not a nitpick, please open an issue or a PR. Doc-only PRs that fix a
stale claim are genuinely welcome and don't need to clear the same bar as a code change (though they
should still be accurate).

## Pull requests

- Real merge commits, no squashing, this project's own history is written to reflect what actually
  happened (see `git log` for the pattern: `Merge pull request #N from ...` commits, not rebased
  history).
- A PR that touches money-moving code (the SDK's rail adapters, the relayer, the router) should
  include real test coverage, and if it changes behavior that's actually been verified against
  live infrastructure, update the relevant verified-facts document in the same PR, don't leave the
  docs to catch up later.
- A PR that only touches the landing page (`apps/site`) or documentation doesn't need router/SDK-
  level ceremony, standard web-app testing rigor is the right bar there, see that package's own
  test files for the existing pattern.

## Questions

See [FAQ.md](FAQ.md) for answers to what's likely to come up before you ask. If your question
isn't there, open a discussion or an issue rather than guessing, an incorrect assumption about how
this project's rails behave is exactly the kind of thing this whole document exists to prevent.
