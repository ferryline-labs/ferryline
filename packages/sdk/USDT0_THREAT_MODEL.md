# Ferryline USDT0-over-LayerZero rail (Stellar ↔ EVM) — threat model

Status: **design review, no implementation changes yet.** This document was written to satisfy an
explicit request for a pre-implementation safety review of the already-shipped `usdt0-layerzero`
rail, triggered by a real address-checksum bug (`packages/sdk/src/rails/usdc-cctp/adapter.ts` and
`usdt0-layerzero/adapter.ts`, fixed in commit `bedfaed`, see "Address validation" below) found
while manually double-checking a real mainnet transfer. Every finding below is either (a) already
shipped and cited as closed, (b) a real gap in already-shipped code that has NOT yet been fixed,
recorded here so it is not lost, or (c) an open design question for sign-off before any follow-up
implementation begins. **No code changes accompany this document.**

**Explicit note on the format choice, checked directly rather than assumed**: this document
mirrors `packages/relayer/OUTBOUND_THREAT_MODEL.md`'s three-part shape (`## What are we working
on?` / `## What can go wrong?` / `## What are we going to do about it?`), for the same reason that
document gives for borrowing it from the router's own `THREAT_MODEL.md`: it is a familiar,
already-proven-useful shape for working through a specific set of safety questions in depth, not a
claim that either predecessor document is itself a historically pre-code artifact (both were
checked directly by that document's own author and found to be written after real implementation
work, not before — see that document's own note). Unlike its two predecessors, this document
genuinely IS written before any implementation change to the current adapter code (the checksum fix
already shipped is the one exception, cited as already-closed, not proposed here). Every claim
about existing code below is cited to a real file, function, and line range in the current
`packages/sdk/src/rails/usdt0-layerzero/` and `packages/sdk/src/rails/usdc-cctp/` source, verified
directly against the working tree at commit `bedfaed` while writing this document — not
reconstructed from memory of earlier phases.

See `USDT0_SCOPE.md` (this same directory) for what the current rail does and does not do.

## What are we working on?

A design-review pass over the USDT0-over-LayerZero rail (`Usdt0LayerZeroAdapter`,
`packages/sdk/src/rails/usdt0-layerzero/adapter.ts`) — specifically its **outbound** direction
(Stellar → EVM), which is the only direction with real, first-party, signed-and-submitted mainnet
evidence as of this writing. Two real mainnet sends now exist:

- 2026-09-11 (Stellar → Polygon, third-party transaction, decoded and cross-checked, not signed by
  this project — `packages/core/VERIFIED.md` §2.4).
- **2026-09-14 (Stellar → Arbitrum, first-party — signed, submitted, and independently verified by
  this project):** source burn
  [`e14b5e1314e6a7544a5171f09de0e672a06c99deeb567a52933ec9aa784863f6`](https://stellar.expert/explorer/public/tx/e14b5e1314e6a7544a5171f09de0e672a06c99deeb567a52933ec9aa784863f6)
  on Stellar (Horizon, re-confirmed directly while writing this document: `successful: true`,
  ledger `64424015`), destination mint
  [`0x55821464151eab4f68f143640ee2394c145ed6d9334e9a66b1a801ecf99910c4`](https://arbiscan.io/tx/0x55821464151eab4f68f143640ee2394c145ed6d9334e9a66b1a801ecf99910c4)
  on Arbitrum, re-confirmed directly while writing this document via a fresh `eth_call` to the
  real USDT0 token contract (`0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9`)'s `balanceOf` for the
  real recipient: still exactly `0xf4240` = 1.0 USDT0, matching the amount sent. Full record:
  `packages/core/verified/experiments/2026-09-14-widget-usdt0-mainnet-outbound.md`;
  `packages/core/VERIFIED.md` §2.7.

**Neither of this document's two new findings below (the refund-address gap, the `PAYLOAD_STORED`
retry assumption) affects the validity of the 2026-09-14 Arbitrum send cited above, stated
directly rather than left for the reader to derive: the refund-address gap did not apply to that
send because it never triggered any refund event — no dust refund (1.0 USDT0 divides evenly into
6-decimal shared units with no floored remainder, confirmed: `10000000 % 10 == 0`) and no
failed-send refund (independently re-confirmed directly against Soroban RPC while writing this
document: the one earlier attempt that same day, tx `946dca9c…`, never landed on any ledger at
all — `getTransaction` returns `status: "NOT_FOUND"`, `ledger: 0` — so it never reached the OFT
contract's own execution at all, and never had any refund to trigger; the transaction that DID
execute, `e14b5e13…`, is the one delivery-confirmed above) — and the `PAYLOAD_STORED` assumption
did not apply because it is inbound-only logic (`scan.ts`'s handling of USDT0 arriving AT
Stellar), while the 2026-09-14 send was outbound (Stellar → Arbitrum).**

Unlike the CCTP outbound direction, USDT0-over-LayerZero has **no Ferryline-operated relayer at
all** — confirmed directly, not assumed (see "Ferryline's responsibility boundary" below) — every
transaction on this rail is built by `Usdt0LayerZeroAdapter` as unsigned XDR and signed entirely by
the sender's own wallet. This changes the shape of the safety questions worth asking: there is no
sponsor key to steal, no spend ceiling to bypass in the CCTP relayer's sense — but there is real
Ferryline code (input validation, amount math, address resolution) sitting directly between a
user's wallet and a real, irreversible mainnet transaction, and that code's own correctness is
exactly what this document reviews.

## What can go wrong?

### Address validation — the real bug found, and whether it was the only one

**Found and already fixed, not an open item.** Every EVM address check in both rail adapters
(`usdc-cctp` and `usdt0-layerzero` — 7 call sites total: recipient, sender, and refund-address
resolution in each) validated format only (`0x` + 40 hex characters via a plain regex,
`EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/`, `packages/sdk/src/evm/reader.ts:20`), never the EIP-55
mixed-case checksum. A syntactically valid but genuinely wrong address — a single flipped
letter-case, e.g. `0x7BE6FA75805d77Bc3FE8F004bbEc49f7d4f1AC50` instead of the real
`0x7bE6FA75805d77Bc3FE8F004bbEc49f7d4f1AC50` — passed every check silently, in both directions, on
both rails. Found while manually double-checking a real recipient address before the 2026-09-14
Arbitrum send above; the SDK itself would not have caught a copy-paste checksum error the way that
manual check did.

**Fixed in commit `bedfaed` (`phase-7/usdt0-mainnet-proof`), re-verified directly while writing
this document, not trusted from the earlier chat report:**

```
$ grep -n "isAddress(" packages/sdk/src/rails/usdt0-layerzero/adapter.ts
346:    const recipientOk = isAddress(request.to.address);
637:    const senderOk = isAddress(request.from.address);
740:    if (!isAddress(quote.refundAddress)) {
815:    if (!isAddress(candidate)) {

$ grep -n "EVM_ADDRESS" packages/sdk/src/rails/usdt0-layerzero/adapter.ts
(no matches)
```

All four USDT0 call sites (and the three matching CCTP call sites) now use `viem`'s `isAddress`,
a real EIP-55 checksum validator, not a format-only regex. Four regression tests
(`adapter.test.ts` in both rails) prove the exact same-length, same-hex, wrong-checksum scenario is
now rejected. The public `EVM_ADDRESS` export (`packages/sdk/src/evm/reader.ts`) is intentionally
unchanged — it is public API, and this fix only tightened Ferryline's own internal validation, not
that exported contract.

**Was this the only unvalidated input? Checked explicitly, the same discipline the memo bug's own
CHANGELOG entry held itself to ("confirmed by an exhaustive repo-wide sweep... no fourth instance
exists") — not assumed.** Working through every other input on the outbound path:

- **Amount format** — `parseAmount(request.amount, STELLAR_DECIMALS)`
  (`adapter.ts:358`) rejects anything that isn't a plain, non-negative decimal string matching
  `^(\d+)(?:\.(\d+))?$` (`packages/core/src/amount.ts:64,71-87`) — no sign, no exponent notation,
  no more than 7 fractional digits. This is a real, enforced gate, not a gap.
- **Amount upper bound** — genuinely no Ferryline-side maximum. The only ceiling is the OFT
  contract's own on-chain `min_amount_ld`/`max_amount_ld`, read via the real `quote_oft` simulation
  and enforced as the `"route-limits"` check (`adapter.ts:400-409`). This is a real absence, not a
  bug — see "No spend/rate limits" below for why it is judged acceptable.
- **Destination chain resolution** — `evmUsdt0Chain(request.to.chain)`
  (`chains.ts:161-163`) is a straight `===` match against a hardcoded, compile-time array of 13
  entries (`chains.ts:41-159`). The caller can only supply a `ChainSlug` string (e.g.
  `"arbitrum"`); there is no way for a caller to supply a raw eid, chain id, or contract address
  directly, and each matched `EvmUsdt0Chain` record is one atomic tuple
  `{chain, chainId, eid, oft, innerToken, approvalRequired, localDecimals}` — there is no code path
  that could combine, say, Arbitrum's `eid` with Polygon's `oft` address at runtime. An unresolved
  chain fails immediately and loudly (`ROUTE_UNSUPPORTED`, `adapter.ts:326-332`), never silently.
  **The only way this could be wrong is a source-code typo in the hardcoded array itself — a
  build-time risk, not a runtime one a transfer caller could trigger.**
- **Amount encoding/decimal scaling (7dp Stellar ↔ 6dp shared)** — traced through
  `parseAmount` → `toSharedDecimals` (floors, using bigint truncating division, at
  `packages/core/src/amount.ts:105-120`) → `scaleUp` (exact re-expansion,
  `amount.ts:123-133`). The floored remainder is returned as `dust`, never silently dropped (the
  `ScaledDown` interface's own doc comment, `amount.ts:25-29`, and `Quote.dust`,
  `adapter.ts:505`), and this exact floor-and-refund behavior is independently confirmed as real
  on-chain OFT contract behavior by `VERIFIED.md:238-239`, quoting the USDT0 developer guide
  directly. The signed `amount_ld` value (`adapter.ts:360,518`) is computed once at quote time and
  never recomputed or overridden before `buildOutbound` signs it (`adapter.ts:526-608` uses
  `priv.sendParam` verbatim at line 584) — no code path was found where a bug could cause more to
  be sent than the amount actually quoted and previewed to the sender.
  - **One real, minor inconsistency found, not a safety bug**: the `Quote.credit` display field
    (`adapter.ts:504`, `receipt.amount_received_ld / 10n`) is computed via a hand-inlined `/10n`
    rather than routing through the same `scaleDown`/`toSharedDecimals` helper used everywhere
    else in this file. It happens to be numerically correct today because
    `STELLAR_DECIMALS - SHARED_DECIMALS` is hardcoded to exactly 1 order of magnitude throughout
    this rail, and this field is display-only (it never feeds the actually-signed `amount_ld`) —
    but it is a real code-reuse gap worth closing so a future decimals change can't silently
    diverge between the two call sites. Recorded as a real, small follow-up, not proposed as a
    fix in this document.
- **Refund address — a real, genuine gap, not yet fixed. See its own subsection below.**

### Refund address: caller-controlled, with no ownership check — a real, open gap

**This is a real finding, not a hypothetical.** `TransferRequest.refundAddress` is a public,
optional field (`packages/core/src/rail.ts:30`). On the outbound path,
`resolveStellarRefund` (`adapter.ts:783-791`) resolves it as:

```ts
return this.assertStellarRefund(request.refundAddress ?? defaultRefund);
```

`assertStellarRefund` (`adapter.ts:793-811`) checks only that the supplied value **parses as a
valid, non-muxed Stellar address** — it does not check that it equals the sender, is derived from
the sender's own key, or bears any relationship to `request.from.address` at all. The identical
shape exists on the inbound path (`resolveEvmRefund`, `adapter.ts:813-822`): `request.refundAddress
?? request.from.address`, gated only by the (now-fixed) checksum check, again with no ownership
tie-back. Both paths re-check the same, ownership-blind condition a second time at build (line 527
outbound; `isAddress(quote.refundAddress)` at line 740 inbound) — consistent double-checking of the
wrong property, not a second, independent safeguard.

**Concrete scenario this makes real, not theoretical:** a `TransferRequest` built by a
compromised, buggy, or simply careless integrator's own frontend — not Ferryline's own widget,
which never sets this field at all (confirmed: `grep -rn "refundAddress"
packages/widget/src/*.ts` outside test files returns nothing) — could set `refundAddress` to an
address the sender does not control. If the OFT contract's own dust-refund or a failed/partial
LayerZero send routes funds back through that field, they go to the attacker's address, not the
sender's. **This is not a Ferryline-code fund-loss bug in the CCTP-relayer sense (no key is
stolen, no unbounded amount is at risk — capped by whatever the refund actually is: dust, at most a
few units of the finest Stellar decimal, per §2.4's real observed example, or the LayerZero
`native_fee` itself in a failure case)**, but it is real misdirection of real, if small, funds, and
it is worth closing rather than leaving open because the amounts happen to be small today.

**Not present in the widget's own current usage** (the widget never sets `refundAddress`), so this
is scoped to raw SDK integrators building their own `TransferRequest`, not end users of the
existing, shipped widget UI.

### No spend/rate limits on USDT0 outbound — confirmed true, and the reasoning checked, not assumed

**Confirmed true by an exhaustive negative search, not assumed because it "sounds right":** a
grep for `spend|cap|limit|ceiling|rateLimit|rate_limit` across every hand-written file in
`packages/sdk/src/rails/usdt0-layerzero/` (`adapter.ts`, `chains.ts`, `evm.ts`, `scan.ts`,
excluding tests and the generated OFT client) returns only the OFT contract's own on-chain
`"route-limits"` check (`adapter.ts:390-425`, reading the contract's own `OFTLimit` via
`quote_oft`) and one unrelated UI string (`"Approve the USDT0 OFT to spend the amount"`). No
Ferryline-side per-transfer cap, daily ceiling, or per-recipient rate limit exists anywhere in this
rail's code.

**Is this acceptable? The reasoning given by the person requesting this review — "there's no
relayer/sponsor key in this path, so unlike CCTP's relayer there's no key to protect with a spend
cap" — checked directly against the real code, not accepted on the strength of sounding correct:**

Confirmed true. `buildOutbound` (`adapter.ts:526-608`) only ever produces **unsigned** XDR via
`buildInvocation` (`packages/sdk/src/stellar/rpc.ts`) — nothing in this file holds, reads, or signs
with any private key, Stellar or EVM. Both real costs of an outbound send are paid by the sender's
own signed transaction, not sponsored: the Stellar network fee (implicit in the transaction the
sender's own wallet signs and submits) and the LayerZero `native_fee`
(`adapter.ts:432,458-468,490-491`, checked against the sender's own XLM balance at
`"sender-native-balance"`, then included as the `fee` argument inside the same `send` invocation
the sender signs at `adapter.ts:585`). **Independently corroborated**: the relayer's own
`schemas.ts:10-11` restricts its entire `SUPPORTED_RAILS` to `["usdc-cctp"]`, enforced by
a Zod enum (`zRail`, line 18) that rejects any `usdt0-layerzero` registration attempt with a real
400 — proven by two explicit negative tests, `packages/relayer/src/http/app.test.ts` and
`outbound-app.test.ts`, both titled `"rejects an unsupported rail with 400"`. A full-repo grep of
`packages/relayer/src/**/*.ts` outside tests for `usdt0|USDT0|layerzero|LayerZero` returns exactly
one hit — the same `schemas.ts` comment. **The relayer's spend-safety machinery genuinely does not
apply here because the relayer genuinely never touches this rail at all** — the CCTP-relayer
analogy the request's own reasoning drew is confirmed correct, not just plausible.

**Given that reasoning holds, is there still a distinct, real risk worth its own row — a Ferryline
bug causing unbounded loss even without a key to steal?** Worked through explicitly, per the
request's own framing, rather than dismissed because "no sponsor key" already answered the bigger
question:

- **A wrong-amount bug is bounded by the sender's own balance, not unbounded.** The sender signs
  exactly the transaction the adapter built and the wallet UI previewed; there is no code path
  (confirmed in "Amount encoding/decimal scaling" above) where the signed `amount_ld` differs from
  what was quoted. The worst a bug here could do is send the WRONG amount the sender did sign for
  (e.g., an off-by-one-decimal bug sending 10x or 0.1x intended) — real, worth catching with tests,
  but bounded by the sender's own wallet balance at all times, never by an attacker-controlled or
  unbounded value, since there is no separate pool of funds (a sponsor wallet) for a bug to drain
  beyond what the user themselves is signing away.
- **A wrong-recipient bug is the genuinely severe case, and is the SAME class of bug the checksum
  fix already closed for the address field itself.** The amount is bounded; the destination is
  not, in the sense that a bug sending real funds to an unintended-but-valid address is a real,
  full-value loss, not a capped one. This is exactly why the checksum fix (closed) and the
  refund-address gap (open, above) matter disproportionately more than a hypothetical amount-cap
  gap would: **for a rail with no spend ceiling, address correctness is the primary safety
  control, not a secondary one.**

**Conclusion: the "no sponsor key, so no spend cap needed" reasoning is correct and confirmed, but
it narrows rather than eliminates the safety surface — it means every real risk on this rail is an
address-correctness or user-consent risk, not a custody risk, which is exactly why the
checksum fix and the refund-address gap are this document's two most load-bearing findings, not
incidental ones.**

### Destination chain coverage: one of thirteen chains proven for real

`USDT0_EVM_CHAINS` (`chains.ts:41-159`) lists 13 real, configured destination chains (arbitrum,
bera, ethereum, flare, hyperliquid, ink, mp1, optimism, polygon, rootstock, sei, unichain, xlayer).
Of these, exactly **one** — Arbitrum — has ever been exercised by a real, first-party,
Ferryline-signed transaction (the 2026-09-14 send cited above). Polygon has one real, but
third-party, decoded transaction (§2.4). The other 11 have **zero** real transaction evidence of
any kind from this project.

**Is this a real risk, not just an unfilled checkbox?** Each `EvmUsdt0Chain` record is a static,
hardcoded tuple (chain id, eid, OFT address, inner-token address, `approvalRequired`), sourced from
LayerZero's own published metadata (`chains.ts:34-40`, recorded 2026-09-11). The adapter code
itself treats all 13 identically **except** `approvalRequired` — confirmed directly: only Ethereum
has `approvalRequired: true` (`chains.ts:66`; independently confirmed at `VERIFIED.md:318`), and
that flag is consulted only on the _inbound_ (EVM→Stellar) approval-step decision
(`buildInbound`, `adapter.ts:748-757`) — the outbound direction's own approval decision is instead
read live from the Stellar OFT contract's own `approval_required()` view call
(`adapter.ts:387,520`), not from this static per-chain field. So the real, unverified risk per
untested chain is not "the code branches differently and might be wrong" (it mostly doesn't
branch), but:

- **Gas/fee behavior**: LayerZero's `native_fee` quote (`quote_send`) is chain-specific and
  untested for 12 of 13 chains — a real risk that an untested chain's fee could be
  miscalculated or the sender-balance check could pass/fail incorrectly for reasons specific to
  that chain's own fee market, not caught by the one chain actually proven.
- **Finality/timing characteristics**: the `OBSERVED_ETA_SECONDS = 1900` constant
  (`adapter.ts:113`) is derived from two real Polygon sends (2026-09-04) and now one real Arbitrum
  send — both EVM chains with broadly similar finality assumptions. A chain with meaningfully
  different finality (or one of the less-common chains in this list, e.g. `mp1`, `rootstock`)
  could have a real, untested divergence from this estimate.
- **Address-format assumptions**: all 13 are standard EVM chains using the same 20-byte
  `0x`-address format the now-fixed checksum validation covers uniformly — this specific risk
  category is NOT chain-differentiated, and the checksum fix genuinely covers all 13 equally.

**Recommendation: the "proven" claim should be scoped explicitly to Arbitrum only for v1**,
mirroring the "no default ships" discipline `usdc-cctp`'s own `maxFee`/`minFinalityThreshold`
parameters hold themselves to (`CctpParameters`'s own doc comment,
`packages/sdk/src/rails/usdc-cctp/adapter.ts:71-73`: "Ferryline ships no defaults because neither
has been verified end to end by this repo"). The other 12 chains should be documented as
**configured but unverified** — real, live LayerZero routes that the adapter will attempt exactly
as built, but with no first-party confirmation that the fee math, timing, and delivery mechanics
hold the same way they were proven to on Arbitrum. See `USDT0_SCOPE.md`.

### Inbound USDT0 — still fully blocked, scoped as out-of-scope-and-unverified here, not resolved

Re-confirmed directly against both experiment files while writing this document, not from memory:

- `packages/core/verified/experiments/2026-09-11-inbound-usdt0-c-address.md` — **BLOCKED.**
  Whether inbound USDT0 can be delivered to a Stellar C-address (smart-account) recipient is
  unresolved: `SendParam.to` is a raw `BytesN<32>`, and a G-account key and a C-contract id are
  both exactly 32 bytes — "the bytes alone cannot say which kind the recipient is," and how the
  Stellar OFT resolves that on receive is undocumented in every upstream source checked. The
  adapter's own current behavior (`quoteInbound`, `adapter.ts:610-625`) throws
  `UNSUPPORTED_RECIPIENT_KIND` for anything but a G account — a real, enforced refusal, not a
  silent gap, but the underlying question itself remains unanswered.
- `packages/core/verified/experiments/2026-09-11-inbound-usdt0-no-trustline.md` — **BLOCKED.**
  What happens when USDT0 lands at a Stellar account with no trustline, and whether delivery is
  ever retried after a trustline is added, is unresolved — needs a real mainnet operator this
  project does not yet have.

**A real, previously-uncited gap found while re-verifying these two files for this document**: the
adapter's own `stageFromScanStatus` (`packages/sdk/src/rails/usdt0-layerzero/scan.ts:60-82`)
already encodes an assumption about exactly this unresolved scenario — its `PAYLOAD_STORED` case
carries the comment _"for USDT0 into Stellar, the classic cause is a missing trustline... LayerZero
allows re-execution once the cause is fixed"_ and returns `{ stage: "failed", terminal: true,
retryable: true }`. **This is shipped code encoding a specific retry-behavior claim that the one
experiment designed to empirically test it (`2026-09-11-inbound-usdt0-no-trustline.md`) explicitly
never ran.** Not a bug — `retryable: true` is a reasonable, cited (LayerZero's own documented
re-execution capability) default — but a real, citable instance of the same "verify the comment
against real behavior" discipline this project already applies elsewhere (the memo bug, the CORS
gap) not yet having been applied here. Recorded as an open item, not resolved in this document.

**This document does not attempt to resolve either blocked item.** Both remain scoped, per
`VERIFIED.md` §4's own framing, as real, dated, unresolved facts — not something a threat-model
document should guess at or substitute an assumption for.

### Ferryline's responsibility/liability boundary vs. LayerZero's executor

**Worked through explicitly — a genuinely different trust shape from CCTP's relayer model, not an
assumed parallel.** CCTP's outbound relayer (`packages/relayer/`) is a Ferryline-operated service:
it holds a real EVM signing key, decides when and how to complete a transfer, and its own spend
controls are the thing standing between a bug and real financial loss — Ferryline's
responsibility there is broad and direct (see `OUTBOUND_THREAT_MODEL.md`'s "What does this relayer
hold/control?" section for the fuller reasoning on that path).

USDT0-over-LayerZero has no equivalent. Once the sender's own wallet signs and submits the Stellar
`send()` transaction, **delivery is entirely LayerZero's own protocol's responsibility** — its DVN
network (Decentralized Verifier Network) and executor complete the message, independent of any
Ferryline-operated infrastructure. Confirmed directly against the real 2026-09-14 send: the
message was verified by three real, independent, LayerZero-configured DVNs (LayerZero Labs, USDT0,
Canary — `VERIFIED.md` §2.7's own citation), none of which Ferryline operates, controls, or can
influence.

**So where does Ferryline's real responsibility actually sit?** Narrowly and precisely at the
boundary this document has already been reviewing: **the correctness of the transaction Ferryline's
own code builds, before the sender ever signs it.** Concretely:

- Ferryline is responsible for: quoting the right amount (confirmed correct, above), resolving the
  right destination chain/contract (confirmed correct, above), validating the recipient address is
  well-formed AND checksummed (now fixed), and surfacing an honest preview before signing.
- Ferryline is NOT responsible for, and has no code path that could affect: whether LayerZero's
  DVNs actually verify a message, whether LayerZero's executor actually delivers it, how long that
  takes, or what happens if LayerZero's own infrastructure is degraded or compromised. The
  `OBSERVED_ETA_SECONDS` estimate is exactly that — an estimate from two prior real observations,
  not a guarantee this project's code enforces or could enforce.
- **The one real gray area**: the `refundAddress` gap above sits partially on Ferryline's side of
  this boundary (Ferryline's own code resolves and signs the refund address into the transaction)
  and partially on LayerZero's (LayerZero's own OFT contract decides when and whether to actually
  use it for a dust refund or failed-send refund). Ferryline's responsibility here is real and
  closeable (validate the refund address ties back to the sender); LayerZero's own refund
  mechanics are outside this project's code entirely.

**Conclusion: Ferryline's liability boundary for this rail ends at "the transaction we built and
asked you to sign was correct" — a narrower, more mechanical boundary than CCTP's relayer's "we
hold a key and complete your transfer for you," and this document's findings should be read with
that narrower boundary in mind: every finding above is a pre-signature correctness question, not a
post-signature custody question, because post-signature is not Ferryline's domain on this rail at
all.**

## What are we going to do about it?

Restated as one list per finding, for a reviewer who wants the summary without re-reading each
section's reasoning — no mitigation is implemented by this document itself, all are proposed,
pending sign-off:

- **Address checksums**: already fixed (commit `bedfaed`), re-verified directly while writing this
  document. No further action.
- **Refund address ownership**: a real, open gap. Recommend requiring `refundAddress` (when
  explicitly supplied) to be validated against the resolved sender identity, or requiring explicit,
  documented caller acknowledgment that an unrelated refund address is being knowingly set — exact
  mechanism is an open question below, not decided here.
- **No amount ceiling**: judged acceptable as designed — no sponsor key exists to protect, and the
  sender's own signed balance is the real, sender-controlled bound. No action recommended.
- **Destination-chain scope**: recommend the "proven" claim be scoped explicitly to Arbitrum for
  v1 documentation purposes, with the other 12 configured-but-unverified chains labeled as such —
  see `USDT0_SCOPE.md`.
- **Inbound USDT0**: remains genuinely blocked; no action this document can take beyond citing it
  accurately. The `PAYLOAD_STORED`/`retryable: true` assumption in `scan.ts` should be flagged for
  a future mainnet-operator run of `2026-09-11-inbound-usdt0-no-trustline.md`, not silently trusted
  indefinitely.
- **`Quote.credit` decimal-math inconsistency**: a small, real code-reuse gap (hand-inlined `/10n`
  instead of the shared `scaleDown` helper), not a safety bug. Recommend a follow-up cleanup, not
  urgent.
- **Responsibility boundary**: recommend this boundary (Ferryline owns pre-signature correctness;
  LayerZero owns post-signature delivery) be stated explicitly in developer-facing documentation
  once this rail is documented further, so integrators don't assume Ferryline-operated-relayer-style
  guarantees that don't exist for this rail.

## Open questions needing sign-off before any follow-up implementation begins

1. **Refund-address validation — how strict?**
   - **Option A**: Require `refundAddress`, when explicitly supplied, to structurally match the
     resolved sender (reject if it doesn't — closes the gap completely, but forecloses a
     legitimate use case: a custodial sender routing refunds to a different, sender-controlled
     address).
   - **Option B**: Keep allowing an arbitrary valid address, but require the caller to pass an
     explicit, separate acknowledgment flag/field when `refundAddress` differs from the sender
     (keeps the flexibility, adds friction only when it's actually being used, matches this
     project's general "no silent defaults for risk-bearing choices" discipline used elsewhere,
     e.g. CCTP's `maxFee`/`minFinalityThreshold`).
   - _Implies_: Option A is simpler and closes the gap outright; Option B preserves a real,
     if narrow, legitimate use case at the cost of a new field/flag and slightly more integration
     surface.
   - **My read**: Option B, for consistency with this project's existing "explicit over silent"
     philosophy rather than foreclosing a legitimate custodial use case outright — but this is a
     product-shape decision as much as a safety one, and the requester should decide.

2. **Destination-chain scope labeling — where does it live?**
   - **Option A**: A code-level change (e.g., a runtime warning or an opt-in flag required for the
     12 unverified chains).
   - **Option B**: Documentation-only (this document plus `USDT0_SCOPE.md` plus developer-facing
     docs), no runtime behavior change — the code already fails safely on a genuinely unresolved
     chain (`ROUTE_UNSUPPORTED`), so the only gap is a documentation one, not a code one.
   - **My read**: Option B. The 12 other chains are real, live, correctly-configured LayerZero
     routes — restricting them at runtime would be a real capability regression for a
     documentation-only problem. This matches the request's own framing ("recommend whether v1's
     'proven' claim should be scoped explicitly," a claim being a documentation artifact).

3. **`PAYLOAD_STORED` retry assumption — resolve now or later?**
   - **Option A**: Treat as a real open item, scheduled for the same kind of real mainnet-operator
     run `2026-09-11-inbound-usdt0-no-trustline.md` itself already calls for, whenever inbound
     USDT0 work resumes.
   - **Option B**: Leave as-is indefinitely since inbound USDT0 is already out of scope for the
     proven, shipped (outbound-only) part of this rail.
   - **My read**: Option A in spirit (it should not be forgotten), but not urgent — inbound USDT0
     as a whole is already correctly gated behind `UNSUPPORTED_RECIPIENT_KIND` and the blocked
     experiments, so this specific sub-assumption inherits that same "real, known, not yet
     resolvable without a mainnet operator" status rather than needing separate urgency.
