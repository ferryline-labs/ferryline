//! Ferryline router.
//!
//! STEP 2: `send_cross_chain` and the batch function, implemented invariant-by-invariant against
//! the STEP 1 scaffold (see THREAT_MODEL.md and this crate's STEP 2 report for exactly which
//! implementation slice satisfies which invariant, and `src/invariants.rs` for the tests proving
//! it). Nothing beyond the six invariants and the two entry points is implemented — no
//! admin/upgrade path, no pause switch, no isolated-per-leg batch mode (all explicitly out of
//! scope per SCOPE.md).
//!
//! STEP 4: STEP 3's real testnet deployment found that `dispatch_one_leg` built the wrong
//! argument shape for both rail calls — verified against `packages/core/verified/*.rs`, not
//! against memory or assumption, as the STEP 1 sign-off's post-mortem requires (see
//! THREAT_MODEL.md's STEP 3 section and `TESTNET_DEPLOYMENT.md` for the original finding). This
//! module now builds each rail call from the real, verified interface: CCTP's
//! `deposit_for_burn` (all 8 real arguments; STEP 5 switched off the `_with_hook` variant — see the CCTP arm's own doc comment) and the OFT's `send` (a real `SendParam`/
//! `MessagingFee`, quoted on-chain via a real `quote_send` call first, not a caller-guessed fee).
//! Both legs also now `approve` the rail contract to move the payer's token before invoking it —
//! a second gap STEP 3's failure never got far enough to surface, found by reading
//! `packages/core/verified/experiments/2026-09-11-cctp-burn-max-fee-zero.md`'s own "allowance
//! model" finding while building this fix.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Bytes,
    BytesN, Env, IntoVal, Symbol, TryFromVal, Val, Vec,
};

/// Bumped on every incompatible change to the router's public interface.
pub const INTERFACE_VERSION: u32 = 1;

/// Instance storage keys. A small, FIXED set — see Dos.2: the volume footprint is exactly one
/// entry per `Rail` variant (2 for v1), never one entry per transfer or per caller.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    /// The router-owned, constructor-set contract address for Rail::Usdc's TokenMessengerMinter.
    UsdcContract,
    /// The router-owned, constructor-set contract address for Rail::Usdt0's OFT contract.
    Usdt0Contract,
    /// The router-owned, constructor-set address of the USDC Stellar Asset Contract itself — the
    /// real `deposit_for_burn` call needs this as its `burn_token` argument (STEP 4),
    /// and the router needs it separately to call that token's own `approve` before invoking
    /// CCTP. Distinct from `UsdcContract` (the TokenMessengerMinter, which moves the token but is
    /// not the token).
    UsdcSac,
    /// The router-owned, constructor-set address of the USDT0 Stellar Asset Contract — same
    /// reasoning as `UsdcSac`, for the OFT's `approve` step.
    Usdt0Sac,
    /// Cumulative volume moved through one rail, in that rail's own native units. Exactly one
    /// entry per `Rail` variant — see Dos.2.
    Volume(Rail),
}

/// Which already-deployed rail contract `send_cross_chain` dispatches to. Exactly two rails for
/// v1 (SCOPE.md: "No generic 'any rail' extensibility") — the contract ADDRESS for each is set
/// ONCE at construction (see `__constructor` below) and read from instance storage, never a
/// per-call parameter (THREAT_MODEL.md/Spoof.1; `send_cross_chain`'s own signature has no
/// parameter of type `Address` used as an invocation target, only `payer`, which is a data value).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Rail {
    Usdc,
    Usdt0,
}

/// Real, verified layout of LayerZero's `SendParam`, field-for-field and named identically to
/// `packages/core/verified/usdt0-oft.mainnet.rs`'s own definition. `#[contracttype]` structs
/// encode as a name-keyed, alphabetically-sorted map on Soroban (not a positional tuple), so
/// field NAMES — not the order they're written in this source file — are what has to match the
/// real contract; they are still written in the source's own order here so a future diff against
/// that file reads as a direct comparison, not a puzzle.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SendParam {
    pub amount_ld: i128,
    pub compose_msg: Bytes,
    pub dst_eid: u32,
    pub extra_options: Bytes,
    pub min_amount_ld: i128,
    pub oft_cmd: Bytes,
    pub to: BytesN<32>,
}

/// Real, verified layout of LayerZero's `MessagingFee` — see `SendParam`'s doc comment for why
/// field order in this source doesn't need to match the dump, only field names do.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessagingFee {
    pub native_fee: i128,
    pub zro_fee: i128,
}

/// Destination for a `send_cross_chain` call. `recipient` is always a fixed 32-byte destination
/// address, using Soroban's own `BytesN<32>` (the same fixed-size byte type the real deployed CCTP/
/// OFT contracts use for `mint_recipient`/`destination_caller`/`to` — see
/// `packages/core/verified/cctp-token-messenger-minter.mainnet.rs` and
/// `packages/core/verified/usdt0-oft.mainnet.rs`). THREAT_MODEL.md's Info.1/Tamper.1: the router
/// validates length/format before forwarding (see `pack_destination`), it does not perform
/// decimal-scaling or strkey-checksum logic (that stays in `@ferryline/core`, off-chain).
///
/// STEP 4: each variant now carries every REAL argument its rail's call needs that cannot have a
/// safe universal default — see this module's top doc comment. `max_fee` and
/// `min_finality_threshold` are deliberately caller-supplied, not router-chosen constants: the
/// SDK's own `usdc-cctp` adapter (`packages/sdk/src/rails/usdc-cctp/adapter.ts`) requires both
/// from its own caller for the identical reason recorded in
/// `packages/core/verified/experiments/2026-09-11-cctp-burn-max-fee-zero.md` and
/// `.../2026-09-11-cctp-finality-threshold.md` — Stellar's TokenMessengerMinter's exact
/// unit/threshold behavior for these two fields is UNVERIFIED end-to-end, so shipping a default
/// here would repeat this exact bug class one level up (an assumed value standing in for a
/// verified one) rather than fix it. `refund_address` is similarly caller-supplied for LayerZero:
/// there is no universal correct refund destination, only the one this specific payer wants.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Dest {
    /// CCTP: (destination_domain, mint_recipient, max_fee, min_finality_threshold).
    /// `destination_caller` is NOT here — see `CCTP_DESTINATION_CALLER_NONE`/`dispatch_one_leg`'s
    /// CCTP arm for why it's safe to fix rather than plumb through. STEP 5: the router calls plain
    /// `deposit_for_burn` (not `_with_hook`), so there is no `hook_data` field to plumb through at
    /// all — see `RAIL_FN_CCTP`'s doc comment for why.
    Cctp(u32, BytesN<32>, i128, u32),
    /// LayerZero: (destination_eid, to, refund_address).
    LayerZero(u32, BytesN<32>, Address),
}

#[contracterror]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
#[repr(u32)]
pub enum RouterError {
    /// `pack_destination` was given something other than exactly 32 bytes — rejected, never
    /// silently truncated or zero-padded (THREAT_MODEL.md, Info.1).
    InvalidDestinationLength = 1,
}

/// Repud.1's remediation (`Repud.1.R.1` in THREAT_MODEL.md): a structured event emitted per
/// successful leg, so a disputed transfer has an independent, on-chain record of what actually
/// executed, separate from and in addition to the aggregate `Volume` counter (Dos.2) — that
/// counter can attest total volume moved, but nothing about any ONE transfer.
///
/// Fields are exactly the ones `Repud.1.R.1` names — payer, rail, destination, amount — and
/// nothing else. "The exact args passed to `require_auth`" (the row's fourth requirement) is NOT
/// a separate field: `send_cross_chain`/`send_cross_chain_batch`'s own `require_auth()` call
/// authorizes the CURRENT INVOCATION'S full arguments by construction (see `send_cross_chain`'s
/// own doc comment) — payer, rail, dest, and amount ARE those arguments. Capturing them here a
/// second time as their own field would record the same values twice under a different name, not
/// add a distinct fact.
///
/// `destination` is `BytesN<32>`, not the `Dest` enum itself: `Dest`'s own doc comment already
/// establishes "recipient is always a fixed 32-byte destination address" as the one thing every
/// rail's destination has in common — that's the durable, chain-agnostic value an off-chain
/// indexer or disputed-transfer lookup actually needs, not the routing-internal
/// `Cctp(domain, recipient, max_fee, threshold)`/`LayerZero(eid, to, refund)` shape (which also
/// still contains an `Address`, not encodable as a plain event topic/data value the same way).
/// `dest_recipient` extracts exactly this field from either variant — see that function.
///
/// `payer` and `rail` are `#[topic]` (low-cardinality, exactly what an indexer filters by); struct
/// order otherwise matches `Repud.1.R.1`'s own listed order.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferSent {
    #[topic]
    pub payer: Address,
    #[topic]
    pub rail: Rail,
    pub destination: BytesN<32>,
    pub amount: i128,
}

/// Extracts `Repud.1`'s "destination" field from either `Dest` variant — see `TransferSent`'s own
/// doc comment for why this is the recipient bytes, not the enum itself.
fn dest_recipient(dest: &Dest) -> BytesN<32> {
    match dest {
        Dest::Cctp(_, mint_recipient, _, _) => mint_recipient.clone(),
        Dest::LayerZero(_, to, _) => to.clone(),
    }
}

/// The exact function name every already-deployed rail contract this router calls exposes for
/// "move funds cross-chain", used as the `Symbol` for `atomic_invoke`. Real values, not
/// placeholders — verbatim from `packages/core/verified/cctp-token-messenger-minter.mainnet.rs`
/// (`deposit_for_burn`) and `packages/core/verified/usdt0-oft.mainnet.rs` (`send`,
/// `quote_send`). STEP 2 already had these two names right — the STEP 3 bug was entirely in the
/// ARGUMENTS built for these names, never the names themselves (see THREAT_MODEL.md's STEP 3
/// section for the full root-cause account).
const RAIL_FN_CCTP: &str = "deposit_for_burn";
const RAIL_FN_OFT_SEND: &str = "send";
const RAIL_FN_OFT_QUOTE_SEND: &str = "quote_send";

/// CCTP's protocol-level convention for "any address may complete the mint on the destination
/// chain" — thirty-two zero bytes. This is Circle's own documented convention (consistent across
/// every CCTP deployment, not a Stellar-specific or Ferryline-specific guess), which is why this
/// one field is safe to fix as a router-chosen constant while `max_fee`/`min_finality_threshold`
/// on the same call are NOT (those two have no such cross-chain-standard convention and are
/// separately unverified for Stellar specifically — see `Dest::Cctp`'s doc comment).
const CCTP_DESTINATION_CALLER_NONE: [u8; 32] = [0u8; 32];

/// A CCTP burn ledger window for the router's own `approve` call: how many ledgers the
/// TokenMessengerMinter's allowance stays valid for after this transaction. Generous enough that
/// a slow-to-close transaction doesn't invalidate its own just-issued approval, small enough that
/// a stale, unused approval doesn't linger indefinitely. Matches the SDK's own
/// `APPROVE_LEDGER_WINDOW` convention in spirit (see `packages/sdk/src/rails/usdt0-layerzero/adapter.ts`);
/// this router has its own copy because it has no dependency on `@ferryline/sdk`.
const APPROVE_LEDGER_WINDOW: u32 = 100;

/// STEP 6 fix: how many ledgers wide the rounding bucket is for `approve_live_until_ledger`'s
/// stable computation — see that function's own doc comment for the real testnet bug this closes.
/// Wide enough to comfortably exceed a real simulate-then-submit round trip (STEP 5's own real
/// testnet attempts took roughly two ledgers, ~8 seconds, end to end; Stellar testnet's ledger
/// close time is ~5 seconds) with real margin to spare, narrow enough to stay a small fraction of
/// `APPROVE_LEDGER_WINDOW` so this rounding doesn't meaningfully change how long an approval stays
/// valid in practice (20 ledgers of rounding slop against a 100-ledger validity window).
const APPROVE_LEDGER_ROUNDING_WINDOW: u32 = 20;

/// Computes `approve`'s `live_until_ledger` argument in a way that is STABLE across Soroban's
/// simulate-then-sign-then-submit-then-apply lifecycle, not a raw live ledger read.
///
/// STEP 6 root cause (see THREAT_MODEL.md's STEP 6 section and `EXTERNAL_REPORT_DRAFT.md` for the
/// full investigation): the ORIGINAL version of this computation was
/// `env.ledger().sequence() + APPROVE_LEDGER_WINDOW`, evaluated fresh every time `dispatch_one_leg`
/// executes — including once during `stellar-cli`'s internal simulate-and-sign step, and AGAIN
/// during real on-chain application, moments to seconds later. Soroban's own authorization-tree
/// matching (`soroban-env-host` 27.0.1's `auth.rs`, `maybe_extend_invocation_match`) requires a
/// live call's FULL arguments to exactly equal what was signed; if even one real ledger closes
/// between simulate and apply (ordinary on Stellar testnet's ~5-second ledger close time), the two
/// computed `live_until_ledger` values differ, the real `approve` call's arguments no longer match
/// ANY node in the signed authorization tree, and the host reports exactly the
/// `"Unauthorized function call for address"` class of error a real STEP 5 testnet send hit twice,
/// reproducibly — not a signature failure, an absence-of-match failure.
///
/// The fix: round `env.ledger().sequence()` DOWN to the nearest multiple of
/// `APPROVE_LEDGER_ROUNDING_WINDOW` before adding the real validity window. As long as simulate and
/// apply both happen within the SAME rounding bucket (near-certain for any realistic submission
/// delay — see that constant's own doc comment), this produces the IDENTICAL value both times,
/// closing the drift at its source rather than working around Soroban's matching behavior.
///
/// Kept as an internally-computed value, not a new caller-supplied parameter on `Dest`: unlike
/// `max_fee`/`min_finality_threshold` (real, per-call values with genuine unresolved
/// Stellar-specific unit/semantics questions a caller must decide — see `Dest`'s own doc comment),
/// a caller has no meaningful opinion about the exact ledger number an approval expires at; asking
/// them to supply one would just relocate this exact same drift-prone computation to every call
/// site instead of fixing it once, here.
fn approve_live_until_ledger(env: &Env) -> u32 {
    let current = env.ledger().sequence();
    let rounded_down = (current / APPROVE_LEDGER_ROUNDING_WINDOW) * APPROVE_LEDGER_ROUNDING_WINDOW;
    rounded_down + APPROVE_LEDGER_WINDOW
}

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    /// Sets the router-owned rail contract addresses ONCE, at deployment. THREAT_MODEL.md/Spoof.1:
    /// this is the ONLY place these addresses are ever set — no other function can change them,
    /// and no `send_cross_chain`/batch call ever takes a contract address as an argument.
    ///
    /// STEP 4: two new addresses (`usdc_sac`, `usdt0_sac`) — see `DataKey::UsdcSac`'s doc
    /// comment for why the token contracts themselves are separate from `usdc_contract`/
    /// `usdt0_contract` (the TokenMessengerMinter/OFT that MOVE the token, not the token itself).
    pub fn __constructor(
        env: Env,
        usdc_contract: Address,
        usdt0_contract: Address,
        usdc_sac: Address,
        usdt0_sac: Address,
    ) {
        env.storage()
            .instance()
            .set(&DataKey::UsdcContract, &usdc_contract);
        env.storage()
            .instance()
            .set(&DataKey::Usdt0Contract, &usdt0_contract);
        env.storage().instance().set(&DataKey::UsdcSac, &usdc_sac);
        env.storage().instance().set(&DataKey::Usdt0Sac, &usdt0_sac);
    }

    /// Interface version, so integrators and the SDK can assert compatibility on-chain.
    pub fn version(_env: Env) -> u32 {
        INTERFACE_VERSION
    }

    /// A single-leg cross-chain send. See THREAT_MODEL.md's Elev.1/Tamper.1/Dos.1/Dos.2/Elev.2 and
    /// this crate's STEP 2 report for exactly which line below satisfies which invariant.
    pub fn send_cross_chain(env: Env, payer: Address, rail: Rail, dest: Dest, amount: i128) {
        // Elev.1: authorize for the EXACT (payer, rail, dest, amount) this function is invoked
        // with. `require_auth` (not `require_auth_for_args`) infers "all the invocation arguments"
        // automatically from the current call — see soroban-sdk 27.0.6's own doc comment on
        // `Address::require_auth`. Using the plain form here, rather than
        // `require_auth_for_args(vec![...])` with hand-picked values, removes the exact class of
        // bug THREAT_MODEL.md's Elev.1 warns about by construction: there is no separate list of
        // "authorized values" for a later step to accidentally diverge from, because the SDK reads
        // them directly off this invocation, not off a value this function chose to hand it.
        //
        // STEP 4 note: `Dest` grew new fields (max_fee, min_finality_threshold, refund_address).
        // This line needed NO change for that — `require_auth`'s "all invocation arguments"
        // already covers whatever `dest` contains, so the new fields are authorized by
        // construction the same way the original ones were. Elev.1 is unaffected by STEP 4.
        payer.require_auth();

        Self::dispatch_one_leg(&env, &payer, &rail, &dest, amount);
    }

    /// All-or-nothing batch of several legs (SCOPE.md — isolated-per-leg is explicitly deferred).
    /// See THREAT_MODEL.md's Dos.1: this reuses `dispatch_one_leg` — the SAME function
    /// `send_cross_chain` uses — for every leg, so atomicity is achieved by construction (every
    /// leg goes through `atomic_invoke`'s deliberate non-`try_` path; there is no second code path
    /// that could silently use `try_invoke_contract` instead) rather than by an assumption
    /// re-derived per call site.
    ///
    /// STEP 8: `require_auth()` is called ONCE here, before the loop — NOT once per leg inside it
    /// (that was the original, STEP-2-era design, and it was WRONG, not merely redundant; see
    /// THREAT_MODEL.md's STEP 7 section for the full mechanism). Soroban's authorization model
    /// binds `require_auth()`'s `AuthorizedFunction` to the CURRENT STACK FRAME's own invocation —
    /// this function's own address, name, and full arguments (the whole `legs` vector) — regardless
    /// of how many times it is called from inside that same frame. There was never real, distinct
    /// per-leg authorization available in this design: every "per-leg" `require_auth()` call
    /// authorized the exact same thing (this whole batch invocation), which is why calling it N
    /// times for an N-leg batch produced a real, reproducible testnet failure (STEP 7) rather than
    /// N genuine authorizations. Calling it once, here, is the correct realization of what this
    /// mechanism always actually provided — one signature over the complete `legs` array as a
    /// single atomic unit — not a weakening of a guarantee that never existed. See
    /// `elev_1_batch_authorization_binds_every_legs_amount_and_destination_not_just_payer_identity`
    /// in `src/invariants.rs` for the direct proof that this one signature genuinely covers every
    /// leg's own amount/destination, not merely the payer's identity.
    pub fn send_cross_chain_batch(env: Env, payer: Address, legs: Vec<(Rail, Dest, i128)>) {
        payer.require_auth();
        for (rail, dest, amount) in legs.iter() {
            Self::dispatch_one_leg(&env, &payer, &rail, &dest, amount);
        }
    }

    /// Cumulative volume moved through one rail — the ENTIRE on-chain footprint for measuring
    /// volume (THREAT_MODEL.md/Dos.2). Exactly one storage entry per `Rail` variant, read here,
    /// never a per-transfer or caller-indexed collection.
    pub fn volume(env: Env, rail: Rail) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Volume(rail))
            .unwrap_or(0)
    }

    /// Packs caller-supplied raw bytes into the fixed 32-byte shape every rail contract's
    /// recipient field expects. THREAT_MODEL.md/Info.1: rejects (never silently truncates or
    /// zero-pads) anything that is not EXACTLY 32 bytes — the same class of bug as the phase-3
    /// nonce-length fix in `@ferryline/sdk`, which this project has already been burned by once.
    pub fn pack_destination(env: Env, raw: Bytes) -> Result<BytesN<32>, RouterError> {
        if raw.len() != 32 {
            return Err(RouterError::InvalidDestinationLength);
        }
        // `Bytes::try_into` for a `BytesN<N>` panics-on-mismatch internally in some soroban-sdk
        // versions; the explicit length check above makes this line unreachable on a bad length
        // rather than relying on that internal behavior, so the length check is this function's
        // own visible contract, not an implementation detail of a conversion call.
        let mut array = [0u8; 32];
        raw.copy_into_slice(&mut array);
        Ok(BytesN::from_array(&env, &array))
    }
}

impl Router {
    /// THREAT_MODEL.md/Dos.1's "deliberate, permanent design decision", made visible at every call
    /// site as a NAMED function rather than a comment alone (per the STEP 1 sign-off's explicit
    /// instruction), so the property survives future edits without anyone needing to have read
    /// project history to know it is load-bearing: this ALWAYS uses `env.invoke_contract` (the
    /// platform's default, panic-on-failure path), NEVER `env.try_invoke_contract`. A reviewer
    /// adding a new call site that reaches for `try_invoke_contract` "to add a nicer error
    /// message" has to bypass this function by name to do it — a much louder signal than silently
    /// changing one comment's neighboring code.
    fn atomic_invoke<T: TryFromVal<Env, Val>>(
        env: &Env,
        contract: &Address,
        func: &str,
        args: Vec<Val>,
    ) -> T {
        env.invoke_contract(contract, &Symbol::new(env, func), args)
    }

    /// Elev.2: this function's own ordering IS the invariant. The router's own storage write (the
    /// volume counter) happens strictly AFTER the rail call returns successfully — never before.
    /// If the rail call panics (the rail contract rejected the call), execution never reaches the
    /// `env.storage().instance().update(...)` line below at all, and per THREAT_MODEL.md's Dos.1
    /// finding, the panic unwinds the whole transaction anyway, so there is no path where a leg's
    /// own bookkeeping could be written for a call that did not actually succeed.
    ///
    /// STEP 4: each rail's arm now does real work beyond building one `atomic_invoke` call — an
    /// `approve` first (both rails require it; see this module's top doc comment), and for
    /// LayerZero, a real `quote_send` cross-contract call before `send` (LayerZero's own protocol:
    /// the caller must attach a real, quoted `MessagingFee`, not a guessed one — see
    /// `packages/sdk/src/rails/usdt0-layerzero/adapter.ts`'s identical `quote_send`-then-`send`
    /// sequencing, which this function mirrors on-chain). Elev.2's ordering invariant still holds:
    /// `dispatch_one_leg`'s OWN storage write (`Volume`) is still strictly after the LAST
    /// cross-contract call in each arm, whatever that arm's shape.
    fn dispatch_one_leg(env: &Env, payer: &Address, rail: &Rail, dest: &Dest, amount: i128) {
        // `rail` and `dest` must name the SAME rail — see RouterError::RailDestMismatch's own doc
        // comment for why this is a real (if narrow) instance of Spoof.1's reasoning, not a
        // hypothetical: only `dest`'s own variant is structurally trustworthy for which contract
        // gets called, so an inconsistent `rail` must be rejected, not silently ignored or
        // silently trusted over `dest`.
        let dest_rail = match dest {
            Dest::Cctp(..) => Rail::Usdc,
            Dest::LayerZero(..) => Rail::Usdt0,
        };
        if *rail != dest_rail {
            panic!("rail/dest mismatch: {:?} does not match {:?}", rail, dest);
        }

        match dest {
            Dest::Cctp(destination_domain, mint_recipient, max_fee, min_finality_threshold) => {
                let token_messenger_minter: Address =
                    env.storage().instance().get(&DataKey::UsdcContract).expect(
                        "rail contract address not set — constructor must run before any send",
                    );
                let usdc_sac: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::UsdcSac)
                    .expect("USDC SAC address not set — constructor must run before any send");

                // The allowance model this router calls into: `deposit_for_burn`
                // internally calls USDC.transfer_from(caller=TokenMessengerMinter, from=payer,
                // to=TokenMessengerMinter, amount) — confirmed via a real read-only simulation,
                // recorded in
                // `packages/core/verified/experiments/2026-09-11-cctp-burn-max-fee-zero.md`'s
                // "allowance model" section. Without this `approve`, the burn call traps on "not
                // enough allowance to spend" — a real, distinct bug STEP 3's argument-count trap
                // never got far enough to surface. `token::Client` is `soroban_sdk`'s own typed
                // client for the standard SAC/token interface (not a bespoke one this router needs
                // its own verified dump for — `approve`'s signature is part of the SDK itself).
                let usdc_client = token::Client::new(env, &usdc_sac);
                usdc_client.approve(
                    payer,
                    &token_messenger_minter,
                    &amount,
                    &approve_live_until_ledger(env),
                );

                let burn_token = usdc_sac;
                let destination_caller = BytesN::from_array(env, &CCTP_DESTINATION_CALLER_NONE);

                // Real, verified 8-argument shape for PLAIN `deposit_for_burn` (not
                // `_with_hook`) — see `packages/core/verified/cctp-token-messenger-minter.mainnet.rs`.
                // STEP 5 finding: a real testnet call to `_with_hook` with an empty `hook_data`
                // trapped with the CCTP contract's own `HookDataEmpty = 7107` error — the
                // `_with_hook` variant genuinely requires non-empty hook data, which this router has
                // no real hook payload to provide (SCOPE.md: no hook/forwarding feature exists here).
                // Switched to the plain variant rather than inventing placeholder hook bytes with no
                // real meaning: it is the verified, purpose-built alternative for exactly this case
                // (move funds cross-chain, no hook), one argument simpler, and does not carry a
                // constraint this router has no real value to satisfy.
                let args = soroban_sdk::vec![
                    env,
                    payer.into_val(env),
                    amount.into_val(env),
                    (*destination_domain).into_val(env),
                    mint_recipient.into_val(env),
                    burn_token.into_val(env),
                    destination_caller.into_val(env),
                    (*max_fee).into_val(env),
                    (*min_finality_threshold).into_val(env),
                ];
                // Dos.1: the deliberate, permanent non-`try_` path.
                Self::atomic_invoke::<()>(env, &token_messenger_minter, RAIL_FN_CCTP, args);
            }
            Dest::LayerZero(dst_eid, to, refund_address) => {
                let oft: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Usdt0Contract)
                    .expect("rail contract address not set — constructor must run before any send");
                let usdt0_sac: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Usdt0Sac)
                    .expect("USDT0 SAC address not set — constructor must run before any send");

                // Same allowance requirement as CCTP's, for the OFT — confirmed via
                // `packages/sdk/src/rails/usdt0-layerzero/adapter.ts`'s own `approve`-before-`send`
                // sequencing (search that file for `fn: "approve"` immediately before its `send`
                // invocation).
                let usdt0_client = token::Client::new(env, &usdt0_sac);
                usdt0_client.approve(payer, &oft, &amount, &approve_live_until_ledger(env));

                let send_param = SendParam {
                    amount_ld: amount,
                    compose_msg: Bytes::new(env),
                    dst_eid: *dst_eid,
                    extra_options: Bytes::new(env),
                    min_amount_ld: amount,
                    oft_cmd: Bytes::new(env),
                    to: to.clone(),
                };

                // LayerZero's own protocol requires a REAL, quoted fee attached to `send` — not a
                // caller-guessed one. `quote_send` is itself a real, callable on-chain function of
                // the same OFT contract (verified:
                // `packages/core/verified/usdt0-oft.mainnet.rs`), so the router can call it
                // in-line, in the SAME transaction, as an ordinary cross-contract call — unlike an
                // off-chain client, which needs a separate prior RPC round-trip
                // (`packages/sdk/src/rails/usdt0-layerzero/adapter.ts`'s own `quote_send`-then-
                // `send` two-step, mirrored here as two calls within one atomic transaction
                // instead of two separate ones).
                let quote_args = soroban_sdk::vec![
                    env,
                    payer.into_val(env),
                    send_param.clone().into_val(env),
                    false.into_val(env),
                ];
                let fee: MessagingFee =
                    Self::atomic_invoke(env, &oft, RAIL_FN_OFT_QUOTE_SEND, quote_args);

                let send_args = soroban_sdk::vec![
                    env,
                    payer.into_val(env),
                    send_param.into_val(env),
                    fee.into_val(env),
                    refund_address.into_val(env),
                ];
                // Dos.1: the deliberate, permanent non-`try_` path. `send` returns
                // `(MessagingReceipt, OFTReceipt)`, which this router does not need — `()` here
                // discards it the same way the CCTP arm's `()` does, not because the real return
                // type is `()` (it isn't) but because `atomic_invoke`'s only job is "did this
                // succeed or trap", and a discarded typed return is exactly as informative to that
                // question as no return at all.
                Self::atomic_invoke::<()>(env, &oft, RAIL_FN_OFT_SEND, send_args);
            }
        }

        // Elev.2: only reached if neither arm above panicked. See this function's own doc comment
        // for why that ordering IS the invariant, not merely a convention to remember.
        env.storage()
            .instance()
            .update(&DataKey::Volume(rail.clone()), |current: Option<i128>| {
                current.unwrap_or(0) + amount
            });

        // Repud.1: emitted at the SAME choke point and under the SAME ordering guarantee as the
        // `Volume` write just above — both `send_cross_chain` and `send_cross_chain_batch` funnel
        // every leg through this one function, so one call here covers both, and it is reached
        // only on real success (Elev.2), never for a leg that panicked and rolled back. See
        // `TransferSent`'s own doc comment for the field choices.
        TransferSent {
            payer: payer.clone(),
            rail: rail.clone(),
            destination: dest_recipient(dest),
            amount,
        }
        .publish(env);
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod invariants;

#[cfg(test)]
mod interface_conformance;
