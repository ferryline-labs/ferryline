<!--
DRAFT, genuinely complete as of its third revision — every finding below is real, confirmed, and
cited to the same standard. Still NOT POSTED anywhere: ready for review before posting to Stellar's
developer Discord / as a GitHub issue or discussion. This project's own name/identity is
deliberately generic below ("my contract") — nothing here should be posted as-is if it would read
as speaking for a specific project without that being intended.

REVISION NOTE (third revision): adds a third, independent finding (Circle CCTP's off-chain
attestation layer, not Soroban's own authorization framework) discovered separately, about 1.5
hours after this draft's second revision was last edited. Kept in one report rather than split out,
for the same reason the first two were combined: each is self-contained and independently
readable, but a reader deciding whether real testnet/mainnet behavior can diverge from documented
or expected behavior on Stellar-adjacent infrastructure benefits from seeing all three real
examples together. Findings 1 and 2 are Soroban-platform-level (`soroban-env-host`'s own
authorization matching); Finding 3 is a different system entirely (Circle's Iris attestation
service, off-chain, not part of Soroban or the deployed CCTP contracts' own logic) — confirmed
structurally UNRELATED to the first two, included here because it's the same class of lesson
(real, first-party testing found real infrastructure behavior no documentation stated plainly),
not because the underlying mechanisms are related.
-->

# Three real surprises building on Stellar: two Soroban authorization footguns, and one Circle CCTP parameter that's silently reinterpreted, not honored or rejected

## Summary

While building a Soroban router contract that moves funds through a token's `approve` and a
second cross-contract call (in both single-call and batched-multi-leg forms), and while
integrating Circle's CCTP v2 for USDC transfers out of Stellar, three distinct, real, confirmed
surprises turned up — each invisible to local unit tests or published documentation alone, each
only discoverable through real testnet deployment and a real, funded burn:

1. **A `require_auth`-covered argument computed from live ledger state can silently drift between
   simulate-time signing and real apply-time execution**, causing simulation to succeed completely
   while real submission fails reproducibly with `"Unauthorized function call for address"`.
2. **Calling `require_auth()` once per item in a loop, for the same address, within one function,
   never produced the "N independent per-item authorizations" it looked like it did** — every call
   authorized the exact same thing, and only the LAST one mattered; the rest were redundant, and
   depending on how the loop is written, colliding.
3. **Requesting CCTP v2's Fast Transfer (`minFinalityThreshold: 1000`) on a burn FROM Stellar is
   accepted on-chain with no error, but is silently executed at Standard finality (`2000`) instead**
   — not rejected, not honored, and nothing in the real transaction or its real submission response
   signals that the requested behavior didn't happen as asked. Confirmed with a real, funded,
   first-party burn, not inferred from documentation or from observing other operators' transactions.

Findings 1 and 2 are not bugs in Soroban's authorization framework; they're real footguns in how a
contract author can unintentionally construct an authorization-covered value or invocation shape.
Finding 3 is not a bug in Circle's CCTP contracts either — the on-chain call genuinely succeeds; the
silent reinterpretation happens in Circle's own off-chain attestation service, a system this
project doesn't control and can't inspect the internals of, only observe the real, external
behavior of. As far as we could find, none of the three is currently documented anywhere obvious.

---

## Finding 1: a live-state-derived auth argument drifts between simulate and apply

### The mechanism, confirmed

Soroban's authorization-tree matching (`soroban-env-host` 27.0.1, `src/auth.rs`,
`maybe_extend_invocation_match`) requires a live call's FULL arguments — not just the contract
address and function name — to exactly equal what was signed:

```rust
host.compare(&sub_invocation.function, function)?.is_eq()
```

`stellar-cli`'s default flow simulates a transaction to DISCOVER the authorization tree it needs,
then signs that discovered tree, then submits. If a contract computes an authorization-covered
argument from LIVE, time-dependent state (like `env.ledger().sequence()`), that computation runs
TWICE against two different real moments: once during the CLI's internal simulate-and-sign step,
and again when the transaction is actually applied on-chain — normally a few seconds apart, which
on a network with a ~5-second ledger close time is often enough for the underlying ledger sequence
to have advanced by the time of real execution.

The value baked into the SIGNED authorization entry (computed at simulate time) then no longer
matches the value the SAME contract logic computes again at real apply time. The real call's
arguments no longer correspond to ANY node in the signed tree — not a signature-verification
failure, but a plain absence-of-match, which the host reports as
`"Unauthorized function call for address"`.

### How this was confirmed (not by guessing — a real fix, a real retest)

1. Decoded the actual signed transaction envelope (`stellar tx decode`) for a real, failed
   submission: the authorization tree DID contain the correct nested structure (root invocation
   with `credentials: source_account`, a sub-invocation to the token contract's `approve`, a
   sibling sub-invocation to the actual business-logic call) — ruling out a missing-auth-entry bug.
2. Ruled out a stale-simulation/timing race: rebuilt, re-signed, and resubmitted within ~8 seconds
   of the first failure — identical failure.
3. Ruled out an account-level signing problem: an isolated, single-hop call to the SAME token
   contract's `approve`, from the SAME account, submitted for real, succeeded cleanly.
4. Read `soroban-env-host`'s own `auth.rs` directly and found the exact-argument-match requirement
   above — which, combined with (1)–(3), pointed specifically at the contract's own
   `live_until_ledger` computation as the drifting value, not at the platform.
5. **Fixed it**: instead of `env.ledger().sequence() + WINDOW`, rounded the current sequence DOWN
   to a fixed-size bucket (20 ledgers) before adding the window, so the computed value is IDENTICAL
   for any two calls landing in the same bucket — true for any realistic submission delay.
6. **Retested for real**: the exact same call that failed twice before now completes successfully
   on testnet, confirmed via a direct Horizon query (`"successful": true`), the contract's own
   post-call state update, and the real token balance change matching the transfer.

### The lesson

Any argument covered by `require_auth` — directly or as part of a nested sub-invocation's
arguments — must be **stable across a realistic simulate-to-apply time gap**:

- A value with genuine per-call meaning that only the caller can supply (a fee, a threshold)
  should be a **caller-supplied argument**, bound once at the moment of authorization and passed
  through unchanged — never recomputed inside the callee.
- A value with no real per-call variation should be a **fixed constant**.
- A value that needs to be "current, but not TOO precisely current" (an expiration/validity window
  like `live_until_ledger`) can be computed internally, but must be **rounded to a coarse-enough
  bucket** that simulate-time and apply-time computations land on the same result.

What should genuinely never happen: computing a `require_auth`-covered argument as a raw function
of live, unrounded, time-dependent state (`env.ledger().sequence()`, a raw timestamp) inside the
contract that's also being authorized. It will usually work in local unit tests (no real network
round trip means simulated time never advances between "sign" and "apply"), and it will often even
work on a live network if the gap between simulate and submit happens to land within one ledger —
which makes this an intermittent, hard-to-reproduce failure in practice, until a slow submission
hits it.

---

## Finding 2: a same-address `require_auth()` loop never authorized what it looked like it did

### The mechanism, confirmed — including two wrong turns on the way there, corrected before landing on this

A batch function that loops over N items and calls `payer.require_auth()` once per item, on the
belief that this produces N independent, per-item authorizations, hits a real, reproducible
`"frame is already authorized"` (`Error(Auth, ExistingValue)`) error — but ONLY at simulation, never
at apply-time (a useful tell that this is a different mechanism from Finding 1 above).

Plain `require_auth()`'s `AuthorizedFunction` is derived from the CURRENT STACK FRAME's own
invocation — the calling contract's own address, function name, and "all the invocation's own
arguments" (the SDK's own documented behavior of `require_auth()`, as distinct from
`require_auth_for_args`). Every iteration of a flat loop runs inside the SAME frame — the frame
never returns between items, only nested cross-contract calls made DURING an item push and pop
their own frames — and that frame's own arguments (the whole items array) never change across
iterations. Every `require_auth()` call in the loop therefore produces the byte-identical
`AuthorizedFunction`, not merely a similar one — because plain `require_auth()`'s granularity is
"the whole current invocation," not "this specific loop iteration." Calling it the second time asks
the host to record a match for a frame it has already matched — `current_frame_is_already_matched()`
correctly and accurately rejects this attempt during the host's own recording-mode auth-tree
construction, which is exactly what `stellar-cli`'s local simulation runs.

**We initially proposed two fixes to ourselves before finding the one that actually works — both
checked directly against source before committing to either, and both found wrong before ever
touching code:**

- **First idea: switch to `require_auth_for_args` with a distinct args tuple per iteration**
  (reasoning: distinct arguments should mean a distinct `AuthorizedFunction`). Checked directly
  against `current_frame_is_already_matched()`/`maybe_extend_invocation_match` and found wrong:
  both gate on call-stack DEPTH (a slot per real stack frame, changed only by genuine
  cross-contract-call transitions) — UNCONDITIONALLY, before any argument comparison ever runs.
  Varying `args` while still calling it flatly inside the same loop, at the same stack depth,
  changes nothing.
- **Second idea: route each item through a self-call back into the contract's own address**, to
  force a new stack frame. Checked directly against `soroban-env-host`'s `frame.rs`,
  `call_n_internal`, and found impossible on this platform, not merely unverified: Soroban's
  reentry check rejects ANY call where the target contract's id already appears in the current
  call stack, and the default/plain cross-contract-call path always uses
  `ContractReentryMode::Prohibited`. A contract cannot call itself, full stop.
- **The actual, confirmed root cause and fix direction**, found via Stellar's own historical GitHub
  issue and reference implementation, not derived from source alone: `stellar/rs-soroban-env#795`
  (closed) is the issue that produced today's exact behavior — a maintainer's resolution states
  _"we allow duplicate `require_auth` calls each of which has to belong to a **separate authorized
  call tree**"_ (a separate stack frame, not merely separate arguments). Stellar's own official
  `atomic_multiswap` example demonstrates the correct pattern for exactly this "loop over N items,
  same-shaped authorization per item" case: its looping function makes **no `require_auth` call of
  its own at all** — it calls a genuinely separate, already-deployed contract once per item (a REAL
  new stack frame each time), and that separate contract's own `require_auth_for_args` call, once
  per party, naturally lands in its own frame.

**The design decision we actually made**, once it was clear the router's own scope had no separate
contract available to call per item purely for authorization-framing purposes: call
`require_auth()` ONCE, before the loop, authorizing the WHOLE batch as one atomic unit — not a
weakening, but the correct realization of what the mechanism always actually provided. Every "per-
item" call in the original design authorized the exact same thing; collapsing to one call just
stops asking the host to re-confirm an authorization it had already granted.

**Verified directly, not assumed, that this one call still binds to every item's real content, not
just the caller's identity**: mocked a real authorization for a specific multi-leg batch, then
attempted to submit a DIFFERENT batch (one item's value altered after the mock was constructed)
through that same mock, and confirmed rejection. Also mutation-tested: removing the one
`require_auth()` call entirely was NOT caught by the existing test suite until a dedicated test was
added for it — and, while investigating that gap, found genuine platform defense-in-depth
independent of the contract's own check: even a full blanket authorization bypass in a test
harness still refuses to let an unauthorized batch through, because Soroban's own recording-mode
has a SEPARATE safety net that rejects any authorization not tied to the root invocation
("`encountered authorization not tied to the root contract invocation for an address. Use
require_auth() in the top invocation`").

### How this differs from Finding 1

Different failure phase: Finding 1 fails ONLY at real apply-time, after simulation has already
succeeded; Finding 2 fails at SIMULATION itself, before a transaction is ever signed or submitted.
Different mechanism: Finding 1 is a VALUE drifting between two temporally-separated computations of
the conceptually SAME invocation; Finding 2 is a structural IDENTITY collision between two
genuinely DIFFERENT invocations (item 1's authorization request vs. item 2's) that collapse to the
same `AuthorizedFunction`. Fixing one does not touch the other.

### The lesson

If a contract needs the SAME address to authorize N conceptually-distinct actions within ONE
top-level invocation, calling `require_auth()`/`require_auth_for_args()` N times in a flat loop
does NOT produce N distinct authorizations — it produces one authorization, requested N times, and
only the frame-matching logic's OWN duplicate-detection stands between that working (harmlessly
redundant) and erroring (`"frame is already authorized"`), depending on subtle details of how the
loop is shaped. The only way to get N genuinely distinct, separately-inspectable authorizations for
the same address within one transaction is to route each one through a genuinely separate contract
call (a real new stack frame) — which requires a separate, already-deployed contract to call, not
just a different function or a self-call (self-calls are unconditionally prohibited). If no such
separate contract exists for the use case, the honest design is ONE authorization covering the
whole batch as an atomic unit — which, in most batch-processing designs, is what the author actually
wanted anyway, even if the original N-calls code looked like it was doing something more granular.

---

## Finding 3: requesting CCTP Fast Transfer FROM Stellar is silently re-executed as Standard, not rejected or honored

### The mechanism, confirmed

Circle's CCTP v2 exposes `minFinalityThreshold` on `deposit_for_burn` as a caller-chosen value —
`1000` for Fast Transfer (attested before source-chain finality), `2000` for Standard (attested
after). Circle's own published capability table lists Stellar as a source chain with "Standard
Transfer" supported and "Fast Transfer" marked not applicable, but a table entry is a claim about
what's _offered_, not proof of what happens when a caller asks for the unsupported value anyway —
whether the contract call itself would reject `1000` outright, silently ignore it, or accept it and
have some other layer decide what actually happens was not documented anywhere we could find, and
is exactly what a real burn is for.

**Confirmed with two real, first-party burns, submitted for real, not inferred from Circle's own
documentation or from observing other operators' transactions on mainnet:**

- A real `deposit_for_burn` invocation with `min_finality_threshold = 1000`, submitted and
  confirmed successful on Stellar testnet with no error at any stage — not at simulation, not at
  apply. Circle's own Iris attestation for this exact burn reports `minFinalityThreshold: "1000"`
  (what was requested) alongside `finalityThresholdExecuted: "2000"` (what actually happened) in
  the same message.
- A second real burn, identical in every other respect, with `min_finality_threshold = 2000`
  requested: Circle's attestation reports `finalityThresholdExecuted: "2000"` here too — the
  matching, expected case, run specifically to confirm the first result wasn't some unrelated
  fluke of that one burn.
- Both burns' `maxFee`/`feeExecuted` were identical (`"0"`/`"0"`) in both cases, ruling out "the
  1000 request got silently upgraded because Circle charged a fee it couldn't collect" as an
  alternative explanation — there's no fee difference between the two outcomes at all.

The real, precise finding: **the Stellar-source `deposit_for_burn` call itself has no concept of
rejecting an unsupported `min_finality_threshold` value** — it accepts `1000` exactly as readily as
`2000`, produces an identical-looking successful transaction either way, and the actual decision
about which finality threshold the transfer is attested and delivered under is made entirely by
Circle's own off-chain Iris service, invisibly to the chain, the caller, and anyone reading the
submitted transaction's own real result. A caller who only checks "did my transaction succeed" has
no way to learn, from the chain alone, that the finality behavior they asked for was silently
substituted.

### How this differs from Findings 1 and 2

Different system entirely: Findings 1 and 2 are both about Soroban's own on-chain authorization
matching (`soroban-env-host`), confirmed and fixed inside a contract this project controls and can
read the source of. Finding 3 involves no authorization logic at all, and the actual
reinterpretation happens inside Circle's Iris attestation service, off-chain, closed-source from
this project's own vantage point — we can observe its real, external behavior (what a submitted
message reports) but not its internal reasoning (why `1000` becomes `2000` rather than being
rejected). It's included here as the same class of lesson — real, first-party testing surfaced
real infrastructure behavior that neither a capability table nor a contract interface stated
plainly — not because the mechanism is related to Findings 1 or 2.

### The lesson

A capability table that marks a value "not applicable" for a given direction is not the same claim
as "the contract will reject that value if you send it anyway," and a successful on-chain
transaction is not proof that every parameter inside it was honored as requested — some systems in
a cross-chain pipeline sit off-chain, and a chain's own success/failure signal only covers what
that chain's own logic actually checked. Any integration that lets a caller choose
`minFinalityThreshold` (or an equivalent per-transfer behavioral flag on any similar cross-chain
protocol) on a burn FROM Stellar should either surface this real, confirmed behavior in its own
documentation (so a caller asking for Fast Transfer at least knows it will silently become Standard,
not fail loudly) or refuse the unsupported value client-side before ever submitting, rather than
letting a caller believe their explicit choice was respected when it wasn't.

---

## Search performed before writing this up

For Findings 1 and 2: GitHub (`rs-soroban-env`, `soroban-sdk`/`rs-soroban-sdk`, `stellar-cli`,
`soroban-examples`), Stellar's developer Discord (via web-search proxies — message history itself
isn't indexed), Stellar Stack Exchange (partially blocked by a Cloudflare challenge for direct
access; indexed search returned nothing), and general web search were all checked for both exact
error strings and the general scenario before writing either section. Neither finding's exact
scenario is discussed as a question or bug report anywhere in official Stellar channels. What WAS
found and is cited above — `rs-soroban-env#795` and the `atomic_multiswap`/`atomic_swap` reference
implementation — is far more valuable than a forum thread would have been, and Finding 2's
write-up leans on it directly rather than re-deriving the fix from scratch a third time.

For Finding 3: Circle's own published developer documentation (`developers.circle.com/cctp`,
specifically the supported-chains-and-domains capability table and the CCTP technical guide) was
read directly and quoted above; it states Stellar's Fast Transfer support as "not applicable" for
the source-chain direction but does not say what the contract call itself does if a caller sends
`1000` anyway. General web search and Circle's own developer Discord/forum channels (where
accessible) were checked for this exact scenario — a caller-side value being silently
reinterpreted rather than rejected — and nothing describing it was found. This finding rests
entirely on the two real burns described above, not on any third-party report.

## Suggestion for the docs/SDK

The first two lessons could be called out explicitly in Stellar's authorization documentation
and/or the relevant SDK doc comments (`token::Client::approve` for Finding 1; `Address::require_auth`'s
own doc comment, right where it currently says `require_auth()` is useful "when there is only a
single Address that needs to authorize the contract invocation and there are no dynamic arguments
that don't need authorization," for Finding 2 — that phrasing is exactly the boundary a same-address
loop crosses without it being obvious that it does). Neither constraint was written down anywhere
we could find before running into both ourselves; hopefully this write-up saves the next person
either investigation.

For Finding 3: Circle's own capability table (developers.circle.com/cctp/concepts/supported-chains-and-domains)
could state explicitly, next to Stellar's "Fast Transfer: N/A" row, what actually happens if a
caller requests `1000` anyway — accepted-and-silently-reinterpreted is a materially different,
more surprising outcome for an integrator than either "rejected on-chain" or "rejected by Iris" would
be, and none of the three is the default assumption a reader would form from "N/A" alone.
