//! STEP 2: real tests for all six invariants (the original five plus Spoof.1, adopted with equal
//! standing by the STEP 1 sign-off), run against the REAL `send_cross_chain`/`send_cross_chain_batch`
//! implementation in `lib.rs` — no `unimplemented!()` remains, and no test here uses
//! `#[should_panic(expected = "not implemented")]` anymore. Where a test's own comment says "this
//! now fails to fail", that documents the STEP 1 -> STEP 2 transition explicitly, per the sign-off's
//! instruction to confirm each scaffold "fails to fail" for the right reason rather than passing by
//! coincidence.
//!
//! `extern crate std;` — see this file's STEP 1 doc comment for why: `#![no_std]` only governs the
//! on-chain WASM build; tests compile and run natively.
extern crate std;

use soroban_sdk::{
    contract, contractimpl,
    testutils::{storage::Instance as _, Address as _, Events as _, Ledger as _},
    testutils::{MockAuth, MockAuthInvoke},
    Address, BytesN, Env, Event as _, IntoVal, Symbol,
};

use crate::{
    Dest, MessagingFee, Rail, Router, RouterClient, RouterError, SendParam, TransferSent,
    APPROVE_LEDGER_WINDOW,
};

/// A test double standing in for BOTH real rail contracts (CCTP's TokenMessengerMinter and the
/// OFT contract) — one stub contract with entry points matching the REAL function names AND real
/// argument shapes the router actually calls (`deposit_for_burn`'s full 8 arguments — STEP 5,
/// `send`'s/`quote_send`'s real `SendParam`/`MessagingFee` structs), rather than two separate
/// fakes, since every invariant this file tests (dispatch correctness, atomicity, write-ordering)
/// is identical regardless of which real rail it stands in for.
///
/// STEP 4: this stub's function signatures were rewritten from the router's OWN (then-incorrect)
/// assumption of each rail's interface to the REAL one in `packages/core/verified/*.rs` — this is
/// itself the fix for the root cause STEP 3 found (see THREAT_MODEL.md's STEP 3 section and this
/// crate's STEP 4 report): a stub built to mirror the code under test, rather than an independent
/// source, can pass while the code is wrong. `src/interface_conformance.rs` now separately checks
/// that the router's OWN call sites match the verified dumps directly, so this stub accepting the
/// right shape and the router sending the right shape are two independent checks, not one relying
/// on the other.
///
/// Rejects a sentinel negative `amount` (a real rail contract would reject a negative amount too)
/// so tests can force a leg to fail deterministically, without needing to fake an entire real
/// contract's validation logic.
#[contract]
struct RailStub;

#[contractimpl]
impl RailStub {
    /// Real, verified 8-argument shape — `packages/core/verified/cctp-token-messenger-minter.mainnet.rs`.
    /// STEP 5: named/shaped for plain `deposit_for_burn`, NOT `deposit_for_burn_with_hook` — the
    /// router switched to the plain variant after a real testnet call to `_with_hook` trapped with
    /// the real contract's own `HookDataEmpty` error (see `RAIL_FN_CCTP`'s doc comment in `lib.rs`).
    #[allow(non_snake_case)]
    #[allow(clippy::too_many_arguments)]
    pub fn deposit_for_burn(
        _env: Env,
        _caller: Address,
        amount: i128,
        _destination_domain: u32,
        _mint_recipient: BytesN<32>,
        _burn_token: Address,
        _destination_caller: BytesN<32>,
        _max_fee: i128,
        _min_finality_threshold: u32,
    ) {
        if amount < 0 {
            panic!("RailStub: rejecting a negative amount (simulates a real rail contract's own validation failing)");
        }
    }

    /// Real, verified shape — `packages/core/verified/usdt0-oft.mainnet.rs`.
    pub fn send(
        _env: Env,
        _from: Address,
        send_param: SendParam,
        _fee: MessagingFee,
        _refund_address: Address,
    ) {
        if send_param.amount_ld < 0 {
            panic!("RailStub: rejecting a negative amount (simulates a real rail contract's own validation failing)");
        }
    }

    /// Real, verified shape — `packages/core/verified/usdt0-oft.mainnet.rs`. The router calls
    /// this BEFORE `send` to get a real fee to attach; this stub returns a fixed, deterministic
    /// fee so tests can assert on it if needed, without needing a real LayerZero fee model.
    pub fn quote_send(
        _env: Env,
        _from: Address,
        _send_param: SendParam,
        _pay_in_zro: bool,
    ) -> MessagingFee {
        MessagingFee {
            native_fee: 100,
            zro_fee: 0,
        }
    }
}

/// A minimal, real Stellar Asset Contract stand-in for both the USDC and USDT0 token slots
/// STEP 4 added to the router's constructor. `dispatch_one_leg` calls `approve` on whichever real
/// SAC address it's given (via `soroban_sdk::token::Client`, the SDK's own standard token client
/// — not a bespoke interface this router needs its own verified dump for), so this stub only
/// needs to accept that one call. Registered as an actual `soroban_sdk::testutils` token contract
/// via `env.register_stellar_asset_contract_v2`, which gives a REAL SAC (not a hand-written fake)
/// with a genuine `approve` — the same function signature and behavior a real deployed SAC has.
fn register_test_sac(env: &Env) -> Address {
    env.register_stellar_asset_contract_v2(Address::generate(env))
        .address()
}

/// A test double that is DELIBERATELY behaviorally distinguishable from `RailStub` and from
/// itself-as-the-other-slot: used ONLY by the Spoof.1 address-resolution tests, to close a real
/// gap this crate's own mutation-testing pass found — see this file's git history. An EARLIER
/// version of the Spoof.1 tests registered the SAME `RailStub` (which implements BOTH
/// `deposit_for_burn` and `send` identically) for both the USDC and USDT0 slots, which
/// made a genuine constructor-argument-order bug (transposing which address maps to which rail)
/// INVISIBLE to those tests: calling the "wrong" contract still succeeded, since both slots
/// responded identically to either function name. Directly testing that (swapping the two
/// `DataKey` variants in `dispatch_one_leg`'s match arms) proved the earlier tests passed
/// regardless — a false sense of security. `UsdcOnlyRailStub`/`Usdt0OnlyRailStub` (below) fix
/// this: each implements ONLY one of the two real function names, so calling the wrong one
/// produces a real "function not found" error instead of a silent success.
#[contract]
struct UsdcOnlyRailStub;

#[contractimpl]
impl UsdcOnlyRailStub {
    /// Real, verified 8-argument shape (STEP 5: plain `deposit_for_burn`) — see `RailStub`'s
    /// identical function for why.
    #[allow(non_snake_case)]
    #[allow(clippy::too_many_arguments)]
    pub fn deposit_for_burn(
        _env: Env,
        _caller: Address,
        _amount: i128,
        _destination_domain: u32,
        _mint_recipient: BytesN<32>,
        _burn_token: Address,
        _destination_caller: BytesN<32>,
        _max_fee: i128,
        _min_finality_threshold: u32,
    ) {
        // Only implemented so a real call succeeds when correctly routed here; deliberately does
        // NOT implement `send`/`quote_send` at all, so a call intended for the OTHER (USDT0) slot
        // that lands here instead fails with a real "function not found" error.
    }
}

#[contract]
struct Usdt0OnlyRailStub;

#[contractimpl]
impl Usdt0OnlyRailStub {
    /// Real, verified shape (STEP 4) — see `RailStub`'s identical function for why.
    pub fn send(
        _env: Env,
        _from: Address,
        _send_param: SendParam,
        _fee: MessagingFee,
        _refund_address: Address,
    ) {
        // Mirror of UsdcOnlyRailStub: implements `send`/`quote_send`, deliberately NOT
        // `deposit_for_burn`, so a routing swap in the other direction is equally
        // catchable.
    }

    pub fn quote_send(
        _env: Env,
        _from: Address,
        _send_param: SendParam,
        _pay_in_zro: bool,
    ) -> MessagingFee {
        MessagingFee {
            native_fee: 100,
            zro_fee: 0,
        }
    }
}

/// A second test double, used ONLY by the Elev.2 regression test below: attempts to call back
/// into the router's OWN `volume()` mid-invocation, simulating a downstream contract (malicious
/// or merely buggy) trying to observe the router's intermediate state during a `send_cross_chain`
/// call. Per the STEP 2 finding (see the Elev.2 section below), this call is REJECTED by
/// Soroban's own reentrancy prohibition before it can complete — so, unlike an earlier design
/// that also RECORDED what the callback observed, there is nothing to record: the call never
/// returns a value to record, it panics. Kept minimal (no storage, no getter) for exactly that
/// reason — see this file's git history for the fuller version that assumed the call would
/// succeed, before that assumption was tested and found wrong.
///
/// `deposit_for_burn`'s signature matches EXACTLY what `dispatch_one_leg` actually calls
/// it with (STEP 5: plain `deposit_for_burn`, not `_with_hook` — see `RAIL_FN_CCTP`'s doc comment
/// in `lib.rs`). The router address to call back into is supplied via this stub's own constructor.
#[contract]
struct CallbackRailStub;

const ROUTER_KEY: &str = "router";

#[contractimpl]
impl CallbackRailStub {
    pub fn __constructor(env: Env, router: Address) {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, ROUTER_KEY), &router);
    }

    /// Real, verified 8-argument shape (STEP 5: plain `deposit_for_burn`) — see `RailStub`'s
    /// identical function for why. This stub is invoked AFTER the router's own `approve` call to
    /// the (separate, real) USDC SAC in `dispatch_one_leg` — the reentrancy attempt below happens
    /// exactly where it always did, one call later in `dispatch_one_leg`'s new sequence.
    #[allow(clippy::too_many_arguments)]
    pub fn deposit_for_burn(
        env: Env,
        _caller: Address,
        _amount: i128,
        _destination_domain: u32,
        _mint_recipient: BytesN<32>,
        _burn_token: Address,
        _destination_caller: BytesN<32>,
        _max_fee: i128,
        _min_finality_threshold: u32,
    ) {
        // Attempts to call back into the SAME router that is currently invoking this function —
        // a genuine reentrant call. Soroban's host rejects this before it returns (see the Elev.2
        // section below for the full finding); this line is never reached to completion.
        let router: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, ROUTER_KEY))
            .unwrap();
        let _ = crate::RouterClient::new(&env, &router).volume(&Rail::Usdc);
    }
}

/// Convenience defaults for `Dest::Cctp`'s two STEP-4-added, caller-supplied fields
/// (`max_fee`, `min_finality_threshold`) — deliberately NOT router-side defaults (see `Dest`'s own
/// doc comment for why those two specifically must stay caller-supplied), but a fixed choice here
/// keeps every test that doesn't care about these two fields' exact values from repeating the same
/// two literals everywhere. `2000` (Standard Transfer) is used, not `1000` (Fast Transfer):
/// `packages/core/verified/experiments/2026-09-11-cctp-finality-threshold.md` records Circle's own
/// supported-chains table showing Stellar's Fast Transfer support as "N/A" — so `2000` is the only
/// value confirmed even POTENTIALLY valid for a Stellar-source burn, real experiment evidence
/// rather than an arbitrary pick between two untested options.
const TEST_CCTP_MAX_FEE: i128 = 0;
const TEST_CCTP_MIN_FINALITY_THRESHOLD: u32 = 2000;

fn setup() -> (Env, Address, Address, RouterClient<'static>) {
    let (env, usdc_contract, usdt0_contract, _usdc_sac, _usdt0_sac, client) = setup_with_sacs();
    (env, usdc_contract, usdt0_contract, client)
}

/// Full-fidelity variant of `setup()` for the (few) tests that also need the two SAC addresses —
/// currently only Elev.1's authorization tests, which must build a `MockAuthInvoke` matching
/// `dispatch_one_leg`'s own STEP-4-added `approve` sub-invoke (see `approve_sub_invoke`'s doc
/// comment). Kept separate from `setup()` rather than widening that function's return tuple, so
/// the ~15 other call sites that don't need the SAC addresses stay unchanged.
fn setup_with_sacs() -> (
    Env,
    Address,
    Address,
    Address,
    Address,
    RouterClient<'static>,
) {
    let env = Env::default();
    let usdc_contract = env.register(RailStub, ());
    let usdt0_contract = env.register(RailStub, ());
    let usdc_sac = register_test_sac(&env);
    let usdt0_sac = register_test_sac(&env);
    let contract_id = env.register(
        Router,
        (
            usdc_contract.clone(),
            usdt0_contract.clone(),
            usdc_sac.clone(),
            usdt0_sac.clone(),
        ),
    );
    let client = RouterClient::new(&env, &contract_id);
    (
        env,
        usdc_contract,
        usdt0_contract,
        usdc_sac,
        usdt0_sac,
        client,
    )
}

/// Shorthand for a CCTP destination in tests that don't care about the exact max_fee/finality
/// values — see `TEST_CCTP_MAX_FEE`/`TEST_CCTP_MIN_FINALITY_THRESHOLD`'s own doc comment.
fn test_cctp_dest(env: &Env, destination_domain: u32, mint_recipient: [u8; 32]) -> Dest {
    Dest::Cctp(
        destination_domain,
        BytesN::from_array(env, &mint_recipient),
        TEST_CCTP_MAX_FEE,
        TEST_CCTP_MIN_FINALITY_THRESHOLD,
    )
}

/// STEP 4: `dispatch_one_leg` now makes its OWN internal, authorization-requiring call —
/// `token::Client::approve(payer, spender, amount, live_until_ledger)` — as a genuine sub-invoke
/// of `payer`'s authorized invocation tree, BEFORE ever reaching the rail contract call. A narrow
/// `mock_auths` grant for `send_cross_chain` alone (with `sub_invokes: &[]`) no longer matches the
/// REAL authorized tree the router asks for, because that tree now has a second node — exactly
/// the "Matching Authorized Invocation Trees" rule THREAT_MODEL.md's Tamper.2 already cites.
/// Builds the exact sub-invoke every send now requires, so Elev.1's tests can grant precisely what
/// the router actually asks `payer` to authorize — not more (that would silently paper over a
/// missing check) and not less (that would fail for a reason unrelated to what these tests mean to
/// prove).
fn approve_sub_invoke<'a>(
    env: &Env,
    sac: &'a Address,
    payer: &Address,
    spender: &Address,
    amount: i128,
) -> MockAuthInvoke<'a> {
    let live_until_ledger = env.ledger().sequence() + APPROVE_LEDGER_WINDOW;
    MockAuthInvoke {
        contract: sac,
        fn_name: "approve",
        // approve(from, spender, amount, live_until_ledger) — real SAC/token::Client signature.
        // CORRECTED (first attempt at this helper wrongly assumed `from` is implicit and omitted
        // it, on a mistaken guess at MockAuthInvoke's convention; a real test run's own diagnostic
        // event log showed the SAC's actual auth check comparing against the FULL 4-argument list
        // including `from`, which is what MockAuthInvoke.args always is — the exact
        // `InvokeContractArgs` for the call, per soroban-sdk 27.0.6's own
        // `From<&MockAuthInvoke> for xdr::SorobanAuthorizedInvocation` — not a shorthand with any
        // argument implied): `from` IS included, explicitly, as the first argument.
        args: (payer.clone(), spender.clone(), amount, live_until_ledger).into_val(env),
        sub_invokes: &[],
    }
}

// ---------------------------------------------------------------------------------------------
// Elev.1 — authorization invariant
// ---------------------------------------------------------------------------------------------

/// STEP 1 -> STEP 2: this test now exercises the REAL `send_cross_chain`, which calls
/// `payer.require_auth()`. Confirms the happy path: an explicit, narrow `mock_auths` grant for
/// exactly (payer, rail, dest, amount) succeeds and the leg's volume is recorded.
///
/// This test deliberately does NOT use `mock_all_auths()` alone — see this test's own STEP 1
/// comment history for why: `mock_all_auths()` would make this pass even if `send_cross_chain`
/// never called `require_auth` at all, an auth-bypass blind spot. This explicit grant, matched
/// against the REAL invocation's args via the client's own auth-matching machinery, is what
/// proves the check is both present and bound to the right values.
#[test]
fn elev_1_authorization_binds_exact_payer_amount_and_destination() {
    let (env, usdc_contract, _usdt0, usdc_sac, _usdt0_sac, client) = setup_with_sacs();
    let payer = Address::generate(&env);
    let dest = test_cctp_dest(&env, 6, [0x11; 32]);
    let amount: i128 = 250_000_000;
    // STEP 4: dispatch_one_leg's own approve() call is now a real sub-invoke of this same
    // authorized tree — see approve_sub_invoke's doc comment.
    let approve = approve_sub_invoke(&env, &usdc_sac, &payer, &usdc_contract, amount);

    client
        .mock_auths(&[MockAuth {
            address: &payer,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "send_cross_chain",
                args: (payer.clone(), Rail::Usdc, dest.clone(), amount).into_val(&env),
                sub_invokes: &[approve],
            },
        }])
        .send_cross_chain(&payer, &Rail::Usdc, &dest, &amount);

    assert_eq!(client.volume(&Rail::Usdc), amount);
}

/// STEP 1 -> STEP 2: "this now fails to fail" — in the STEP 1 scaffold this test's real assertion
/// was commented out (`send_cross_chain` was `unimplemented!()`, so ANY call "failed" for the
/// wrong reason). Now it exercises the actual negative case: `mock_auths` grants authorization to
/// `someone_else`, not `real_payer`, so `real_payer.require_auth()` inside the real
/// `send_cross_chain` has no matching grant and MUST panic with a genuine authorization error —
/// proving the auth check is not merely present but is checked against the CALLING address, not
/// bypassable by a differently-addressed grant existing elsewhere in the same test.
#[test]
#[should_panic]
fn elev_1_unauthorized_payer_cannot_move_funds() {
    let (env, _usdc, _usdt0, client) = setup();
    let real_payer = Address::generate(&env);
    let someone_else = Address::generate(&env);
    let dest = test_cctp_dest(&env, 6, [0x22; 32]);
    let amount: i128 = 100_000_000;

    client
        .mock_auths(&[MockAuth {
            address: &someone_else,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "send_cross_chain",
                args: (real_payer.clone(), Rail::Usdc, dest.clone(), amount).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .send_cross_chain(&real_payer, &Rail::Usdc, &dest, &amount);
}

/// NEW (per the STEP 1 -> STEP 2 sign-off, item "authorized-vs-executed drift test"): attempts to
/// authorize one amount and have a DIFFERENT amount actually reach the rail contract. Since
/// `send_cross_chain`'s real implementation uses plain `require_auth()` (which binds to the
/// CURRENT invocation's actual arguments automatically, per soroban-sdk's own doc comment — see
/// THREAT_MODEL.md's Elev.1), there is no code path inside `send_cross_chain` where a different
/// amount could reach `dispatch_one_leg` than the one `require_auth()` bound to: they are the
/// exact same `amount` parameter, used twice, with no transformation step between. This test
/// proves that structurally: it grants a mock authorization for `amount`, then confirms the
/// value recorded in `volume()` — which can only come from what `dispatch_one_leg` actually
/// dispatched — is `amount`, not any other value. If a future edit introduced a fee-adjustment
/// step between the `require_auth()` call and `dispatch_one_leg` (the exact drift
/// THREAT_MODEL.md's Elev.1 warns about), this assertion would catch the resulting mismatch.
#[test]
fn elev_1_authorized_amount_and_executed_amount_cannot_drift() {
    let (env, usdc_contract, _usdt0, usdc_sac, _usdt0_sac, client) = setup_with_sacs();
    let payer = Address::generate(&env);
    let dest = test_cctp_dest(&env, 6, [0x99; 32]);
    let authorized_amount: i128 = 777_000_000;
    let approve = approve_sub_invoke(&env, &usdc_sac, &payer, &usdc_contract, authorized_amount);

    client
        .mock_auths(&[MockAuth {
            address: &payer,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "send_cross_chain",
                args: (payer.clone(), Rail::Usdc, dest.clone(), authorized_amount).into_val(&env),
                sub_invokes: &[approve],
            },
        }])
        .send_cross_chain(&payer, &Rail::Usdc, &dest, &authorized_amount);

    // The ONLY way volume() could differ from authorized_amount is if dispatch_one_leg received a
    // different value than what require_auth() bound to — which send_cross_chain's own body
    // structurally cannot do (the same `amount` binding is used for both).
    assert_eq!(client.volume(&Rail::Usdc), authorized_amount);
}

/// STEP 8's load-bearing proof, applying the SAME technique as
/// `elev_1_authorized_amount_and_executed_amount_cannot_drift` above to `send_cross_chain_batch`
/// for the first time: `send_cross_chain_batch` now calls `payer.require_auth()` ONCE, before the
/// loop, instead of once per leg (see THREAT_MODEL.md's STEP 7/STEP 8 sections for why the
/// original per-leg calls never provided real per-leg authorization at all — every one of them
/// authorized the exact same whole-invocation `AuthorizedFunction`, which is why calling it N
/// times produced a real, reproducible testnet failure rather than N genuine authorizations).
///
/// The design decision behind collapsing this to one call: since `require_auth()` binds to the
/// CURRENT INVOCATION'S FULL ARGUMENTS automatically (per soroban-sdk's own documented behavior,
/// cited throughout this file), one call at the top of `send_cross_chain_batch` already covers the
/// ENTIRE `legs` vector's exact byte content — every leg's own `(rail, dest, amount)` — not merely
/// the `payer` address's identity. This test proves that claim directly and adversarially, not by
/// assumption: it mocks a real authorization for a SPECIFIC two-leg batch, then attempts to submit
/// a DIFFERENT batch (leg 2's amount altered after the mock was constructed) through that SAME
/// mocked authorization. Since `mock_auths` constructs a real `xdr::SorobanAuthorizationEntry` and
/// exercises the REAL enforcing-mode `AuthorizedFunction`-equality matching (not a test-only
/// shortcut — `MockAuthContract`'s `__check_auth` is a no-op stub, but the invocation-tree matching
/// itself is the same `auth.rs` logic a real signed transaction goes through), a genuine mismatch
/// here proves the one-call design binds to the WHOLE batch's real content, not just its shape or
/// the payer's identity.
#[test]
#[should_panic]
fn elev_1_batch_authorization_binds_every_legs_amount_and_destination_not_just_payer_identity() {
    let (env, usdc_contract, _usdt0, usdc_sac, _usdt0_sac, client) = setup_with_sacs();
    let payer = Address::generate(&env);
    let dest_1 = test_cctp_dest(&env, 6, [0x11; 32]);
    let dest_2 = test_cctp_dest(&env, 6, [0x22; 32]);
    let authorized_amount_1: i128 = 100_000_000;
    let authorized_amount_2: i128 = 200_000_000;

    let authorized_legs = soroban_sdk::vec![
        &env,
        (Rail::Usdc, dest_1.clone(), authorized_amount_1),
        (Rail::Usdc, dest_2.clone(), authorized_amount_2),
    ];
    let approve_1 =
        approve_sub_invoke(&env, &usdc_sac, &payer, &usdc_contract, authorized_amount_1);
    let approve_2 =
        approve_sub_invoke(&env, &usdc_sac, &payer, &usdc_contract, authorized_amount_2);
    let sub_invokes = [approve_1, approve_2];
    let invoke = MockAuthInvoke {
        contract: &client.address,
        fn_name: "send_cross_chain_batch",
        // The mocked authorization is for THIS specific legs content — authorized_amount_2 for leg
        // 2, not a different value.
        args: (payer.clone(), authorized_legs.clone()).into_val(&env),
        sub_invokes: &sub_invokes,
    };

    let auths = [MockAuth {
        address: &payer,
        invoke: &invoke,
    }];
    let mocked = client.mock_auths(&auths);

    // Self-check performed while writing this test (not left implicit): temporarily submitted the
    // UNTAMPERED legs (authorized_amount_2 unchanged) through this exact same mock and confirmed it
    // succeeds cleanly, no panic — proving the panic below is specifically caused by the tampering,
    // not by some unrelated setup mistake (a shape mismatch, a missing sub-invoke, etc.) that would
    // make this test panic unconditionally regardless of what it claims to check.
    //
    // TAMPER: submit a DIFFERENT legs vector through the SAME mocked authorization — leg 2's
    // amount altered from what was actually authorized (300_000_000 instead of 200_000_000). If
    // the one-call-covers-the-whole-batch design genuinely binds to the real content, this MUST
    // panic with a real authorization mismatch — the tampered batch does not correspond to any
    // signed invocation. If it did NOT panic, that would mean the single require_auth() call
    // somehow does not actually cover each leg's real values, which would be exactly the
    // weakening the STEP 8 sign-off explicitly required this test to rule out.
    let tampered_legs = soroban_sdk::vec![
        &env,
        (Rail::Usdc, dest_1, authorized_amount_1),
        (Rail::Usdc, dest_2, 300_000_000i128),
    ];
    mocked.send_cross_chain_batch(&payer, &tampered_legs);
}

/// REAL GAP FOUND during STEP 8's own required mutation-testing pass (per the sign-off's explicit
/// instruction to confirm nothing was weakened, not merely to trust the design reasoning): with
/// `payer.require_auth()` in `send_cross_chain_batch` REMOVED entirely (a real mutation, not
/// hypothetical), ALL 28 pre-existing tests in this crate still passed. Neither
/// `elev_1_unauthorized_payer_cannot_move_funds` (scoped to `send_cross_chain`, not the batch
/// function) nor any Dos.1 atomicity test (all use `client.mock_all_auths()`, a blanket bypass that
/// never distinguishes "authorized" from "unauthorized" in the first place) nor
/// `elev_1_batch_authorization_binds_every_legs_amount_and_destination_not_just_payer_identity`
/// (which relies on a MOCK existing to tamper with — with no `require_auth()` call at all, there is
/// nothing to mock against, so an unmocked call to a function that never checks auth just succeeds
/// trivially) ever exercised "does `send_cross_chain_batch` reject a call with NO authorization at
/// all". This is the batch-scoped mirror of `elev_1_unauthorized_payer_cannot_move_funds` above,
/// closing that real gap directly — mocking authorization to a DIFFERENT address than the real
/// payer, the same technique that test uses for the single-leg case.
///
/// VERIFIED against the REAL code, not assumed, exactly where this panics: the diagnostic event
/// log shows `"Unauthorized function call for address"` fired on `send_cross_chain_batch` ITSELF —
/// the router's own `payer.require_auth()` line rejects the call before `dispatch_one_leg` (and the
/// SAC's own internal `approve` check) is ever reached. Re-running this SAME test against the
/// mutated (require_auth-removed) code, purely as a diagnostic — not the mutation kept in the
/// source — showed the panic still occurs, but from a DIFFERENT, deeper place: the real SAC's own
/// internal `approve(from, ...)` implementation independently requires `from.require_auth()`, and
/// with no grant anywhere for `real_payer`, that also correctly rejects. A separate diagnostic (not
/// committed, run and reverted) confirmed this is genuine defense-in-depth, not a fluke: even
/// `mock_all_auths()` — a full blanket bypass, including the SAC's own internal check — refuses to
/// let an unauthorized batch through when `send_cross_chain_batch`'s own `require_auth()` is
/// missing, because Soroban's own recording-mode safety net separately rejects any authorization
/// not tied to the root invocation ("`encountered authorization not tied to the root contract
/// invocation for an address. Use require_auth() in the top invocation`" — a real, distinct
/// platform protection, not something this router's own code provides). This test still correctly
/// verifies the ROUTER's own check specifically (confirmed above, against real code); the mutation
/// finding is recorded here as informative context, not as a reason to weaken or remove this test.
#[test]
#[should_panic]
fn elev_1_batch_unauthorized_payer_cannot_move_funds() {
    let (env, _usdc, _usdt0, client) = setup();
    let real_payer = Address::generate(&env);
    let someone_else = Address::generate(&env);
    let legs = soroban_sdk::vec![
        &env,
        (
            Rail::Usdc,
            test_cctp_dest(&env, 6, [0x33; 32]),
            100_000_000i128
        ),
    ];

    client
        .mock_auths(&[MockAuth {
            address: &someone_else,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "send_cross_chain_batch",
                args: (real_payer.clone(), legs.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .send_cross_chain_batch(&real_payer, &legs);
}

// ---------------------------------------------------------------------------------------------
// Tamper.1 — no parallel encoding invariant
// ---------------------------------------------------------------------------------------------

#[test]
fn tamper_1_destination_packing_round_trips() {
    use soroban_sdk::Bytes;
    let (env, _usdc, _usdt0, client) = setup();
    let raw = Bytes::from_array(&env, &[0xAB; 32]);
    let packed = client.pack_destination(&raw);
    assert_eq!(packed, BytesN::from_array(&env, &[0xAB; 32]));
}

/// STEP 1 -> STEP 2: the length-rejection half of Info.1, now real. `pack_destination` returns
/// `Err(RouterError::InvalidDestinationLength)` for anything other than exactly 32 bytes — proving
/// it is REJECTED, not silently truncated or zero-padded.
#[test]
fn tamper_1_destination_packing_rejects_wrong_length() {
    use soroban_sdk::Bytes;
    let (env, _usdc, _usdt0, client) = setup();

    let too_short = Bytes::from_array(&env, &[0xCD; 31]);
    let result = client.try_pack_destination(&too_short);
    assert_eq!(result, Err(Ok(RouterError::InvalidDestinationLength)));

    let too_long = Bytes::from_array(&env, &[0xCD; 33]);
    let result = client.try_pack_destination(&too_long);
    assert_eq!(result, Err(Ok(RouterError::InvalidDestinationLength)));
}

// ---------------------------------------------------------------------------------------------
// Dos.1 — batch atomicity invariant
// ---------------------------------------------------------------------------------------------

/// STEP 1 -> STEP 2: this now fails to fail in the STEP 1 sense (it no longer panics on
/// "not implemented") but MUST still panic — this time because the second leg's rail-contract
/// call genuinely fails (a negative amount, rejected by RailStub) and that panic must unwind the
/// WHOLE transaction, per THREAT_MODEL.md's Dos.1. The real assertion (that the router's own
/// volume() for the first, individually-valid leg rolled back too) lives in the companion test
/// below, since a `#[should_panic]` test cannot itself inspect post-panic state within the same
/// Soroban `Env`.
#[test]
#[should_panic]
fn dos_1_one_leg_impossible_rolls_back_the_whole_batch() {
    let (env, _usdc, _usdt0, client) = setup();
    let payer = Address::generate(&env);
    let legs = soroban_sdk::vec![
        &env,
        (
            Rail::Usdc,
            test_cctp_dest(&env, 6, [0x33; 32]),
            100_000_000i128,
        ), // would succeed alone
        (Rail::Usdc, test_cctp_dest(&env, 6, [0x44; 32]), -1i128,), // guaranteed to fail: RailStub rejects negative amounts
    ];

    client
        .mock_all_auths()
        .send_cross_chain_batch(&payer, &legs);
}

/// Companion to the test above, proving the SPECIFIC claim Dos.1 cares about: the first leg's
/// effects — including the router's OWN volume-counter write, not just the rail contract's state
/// — are rolled back along with the whole transaction. Uses `std::panic::catch_unwind` to observe
/// state in the SAME `Env` after the panic, which a `#[should_panic]` test alone cannot do.
#[test]
fn dos_1_one_leg_impossible_rolls_back_router_owned_state_too() {
    let (env, _usdc, _usdt0, client) = setup();
    let payer = Address::generate(&env);
    let legs = soroban_sdk::vec![
        &env,
        (
            Rail::Usdc,
            test_cctp_dest(&env, 6, [0x33; 32]),
            100_000_000i128,
        ),
        (Rail::Usdc, test_cctp_dest(&env, 6, [0x44; 32]), -1i128,),
    ];
    let volume_before = client.volume(&Rail::Usdc);

    let mocked = client.mock_all_auths();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        mocked.send_cross_chain_batch(&payer, &legs);
    }));
    assert!(result.is_err(), "expected the batch to panic");

    // THE assertion: even though the FIRST leg was individually valid and would have recorded
    // 100_000_000 on its own, the router's own volume() is UNCHANGED — proving all-or-nothing
    // extends to the router's own bookkeeping, not merely to the rail contract's state.
    assert_eq!(client.volume(&Rail::Usdc), volume_before);
}

#[test]
fn dos_1_all_legs_impossible_rolls_back_cleanly() {
    let (env, _usdc, _usdt0, client) = setup();
    let payer = Address::generate(&env);
    let legs = soroban_sdk::vec![
        &env,
        (Rail::Usdc, test_cctp_dest(&env, 6, [0x55; 32]), -1i128,),
        (Rail::Usdc, test_cctp_dest(&env, 6, [0x66; 32]), -1i128,),
    ];
    let volume_before = client.volume(&Rail::Usdc);

    let mocked = client.mock_all_auths();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        mocked.send_cross_chain_batch(&payer, &legs);
    }));
    assert!(result.is_err(), "expected the batch to panic");
    assert_eq!(client.volume(&Rail::Usdc), volume_before);
}

/// The structural guard the STEP 1 -> STEP 2 sign-off asked for: a regression test proving
/// `Router::atomic_invoke` is the ONLY place the router ever calls a rail contract, and that it
/// uses `env.invoke_contract`, never `env.try_invoke_contract`. Grep-based, not a soroban-level
/// assertion — this is deliberately a source-level guard (Dos.1's "make this decision visible...
/// so the property survives future edits") that fails loudly and immediately if a future edit adds
/// a SECOND call site or swaps in the `try_` variant, rather than relying on a behavioral test to
/// notice the same thing indirectly.
///
/// STEP 4 mutation-testing finding, corrected rather than silently patched over: the
/// `try_invoke_contract` check below originally matched ONLY the literal substring
/// `"env.try_invoke_contract("` — no turbofish. Directly testing this (adding a real
/// `env.try_invoke_contract::<(), soroban_sdk::Error>(...)` call site to `dispatch_one_leg` — the
/// exact, and actually the MORE COMMON, way to call this generic method when type inference can't
/// resolve it on its own, which is genuinely how a future edit reaching for this method would
/// likely have to write it) proved the ORIGINAL check did NOT catch it: the turbofish
/// (`::<(), soroban_sdk::Error>`) sits between the method name and the opening paren, so the exact
/// substring this test searched for was absent even though a real `try_invoke_contract` call
/// existed. Fixed below by matching the bare method name (with a word-boundary check, so it still
/// does not match this doc comment's own prose mentioning the method by name without calling it).
#[test]
fn dos_1_atomic_invoke_is_the_only_call_site_and_never_uses_try_invoke() {
    let lib_rs = std::include_str!("lib.rs");
    // Matched WITH the opening paren, deliberately: a bare "env.invoke_contract" substring also
    // matches this very doc comment's own prose (which names the method by reference, not as a
    // call) — "(" disambiguates an actual call site from a mention of one.
    let invoke_contract_count = lib_rs.matches("env.invoke_contract(").count();
    // NOT matched with a trailing "(" (see this test's own STEP 4 doc comment above for why: a
    // turbofish'd call has other characters between the method name and "(", so that substring
    // alone would miss it). Instead: find every LINE containing "try_invoke_contract" and count
    // only the ones that are NOT a `//` comment line — a real call site is always executable code,
    // never inside a line whose first non-whitespace characters are `//`. This is robust to future
    // edits adding or removing doc-comment mentions of the method (unlike counting a fixed number
    // of "known" comment mentions, which would silently go stale the next time someone edits a
    // comment without touching any actual code).
    let try_invoke_contract_count = lib_rs
        .lines()
        .filter(|line| line.contains("try_invoke_contract"))
        .filter(|line| !line.trim_start().starts_with("//"))
        .count();

    assert_eq!(
        invoke_contract_count, 1,
        "expected exactly one call to env.invoke_contract (inside atomic_invoke, reused for all \
         cross-contract calls dispatch_one_leg makes) — found {}",
        invoke_contract_count
    );
    assert_eq!(
        try_invoke_contract_count, 0,
        "found {} likely call(s) to env.try_invoke_contract beyond this file's own known doc-comment \
         mentions — the batch atomicity invariant (Dos.1) requires every rail-contract call to go \
         through atomic_invoke's deliberate non-try_ path; if a `try_` \
         variant is genuinely needed for a future feature, that is a decision requiring its own \
         explicit review of THREAT_MODEL.md's Dos.1, not a quiet addition here",
        try_invoke_contract_count
    );
}

// ---------------------------------------------------------------------------------------------
// Dos.2 — no unbounded state growth invariant
// ---------------------------------------------------------------------------------------------

/// STEP 1 -> STEP 2: measures the router's ACTUAL instance-storage entry count before and after
/// many sends, proving it does not grow with transaction count. `env.as_contract(&id, || ...)`
/// reaches into the contract's own storage — the exact mechanism the STEP 1 research confirmed
/// real Soroban test suites use for this class of assertion.
#[test]
fn dos_2_storage_footprint_does_not_grow_with_transaction_count() {
    let (env, usdc_contract, _usdt0, client) = setup();
    let payer = Address::generate(&env);
    let dest = test_cctp_dest(&env, 6, [0x77; 32]);

    let contract_id = client.address.clone();
    let count_entries = |env: &Env| -> u32 {
        env.as_contract(&contract_id, || env.storage().instance().all().len())
    };

    // env.mock_all_auths() (on the raw Env, not client.mock_all_auths()) persists for the rest of
    // this test — the client-level `.mock_all_auths()` used elsewhere in this file is a
    // per-call chained wrapper (see soroban-sdk's own top-level doc example,
    // `client.mock_all_auths().hello(&to)`), scoped to a single subsequent call, which would not
    // cover this test's 50-iteration loop.
    env.mock_all_auths();
    client.send_cross_chain(&payer, &Rail::Usdc, &dest, &1_000_000i128);
    let entries_after_one = count_entries(&env);

    for _ in 0..49 {
        client.send_cross_chain(&payer, &Rail::Usdc, &dest, &1_000_000i128);
    }
    let entries_after_fifty = count_entries(&env);

    assert_eq!(
        entries_after_one, entries_after_fifty,
        "storage entry count grew from {} to {} across 49 additional sends to the SAME rail — \
         the volume footprint must be a fixed-size counter, not one entry per transaction",
        entries_after_one, entries_after_fifty
    );
    // Sanity: the fixed set is small (STEP 4: 4 rail/SAC address entries set at construction —
    // UsdcContract, Usdt0Contract, UsdcSac, Usdt0Sac — + at most 2 volume-counter entries for
    // v1's two rails) — not merely "did not grow on THIS rail" but genuinely bounded.
    assert!(
        entries_after_fifty <= 6,
        "expected at most 6 fixed storage entries (4 constructor-set addresses + 2 volume counters), got {}",
        entries_after_fifty
    );
    assert_eq!(
        client.volume(&Rail::Usdc),
        50_000_000,
        "50 sends of 1_000_000 each should sum correctly even though storage stayed fixed-size"
    );
    let _ = usdc_contract;
}

// ---------------------------------------------------------------------------------------------
// Elev.2 — no reentrancy/callback invariant
// ---------------------------------------------------------------------------------------------
//
// STEP 1 -> STEP 2 finding, per the sign-off: the ORIGINAL plan — a callback stub calling back
// into the router's volume() mid-invocation to observe pre/post-write state — cannot run as
// designed. Attempting it produces a real host rejection: `Error(Context, InvalidAction)`,
// "Contract re-entry is not allowed". This is Soroban's `ContractReentryMode::Prohibited` default,
// confirmed directly against the host source in THREAT_MODEL.md's Elev.2 section, refusing the
// call BEFORE the router's own logic ever runs.
//
// Per the sign-off: this is a platform guarantee STRICTLY STRONGER than what the original test
// design could have proven. A passing callback test would only show "this one attempt failed
// under these specific conditions"; the host's blanket prohibition shows "no attempt of this
// CLASS can succeed, ever, for any contract that has not deliberately opted into a different
// mode" — and soroban_sdk's own public API (checked directly: no `set_reentry_mode`-shaped
// function exists anywhere in it) gives contract authors NO way to opt into that weaker mode
// at all. The router's write-ordering safety margin therefore rests PARTLY on this platform
// default, not solely on `dispatch_one_leg`'s own code — recorded explicitly in THREAT_MODEL.md's
// updated Elev.2 status, per the sign-off's instruction, so an auditor is told this rather than
// left to discover it. What COULD silently erode this margin: a future soroban-sdk/host upgrade
// changing the default (there is no contract-author-facing API to check via a unit test), or a
// future feature needing a genuinely different invocation primitive not present today. The test
// below cannot guard against a host-level default change (nothing in soroban_sdk exposes that
// setting to a contract-level test), but it DOES serve as a regression alarm: if this exact
// scenario ever stops panicking with a reentrancy error, that is the visible signal something
// changed and Elev.2 needs re-review.
//
// Two things are proven instead, exactly as the sign-off directed:

/// PLATFORM GUARANTEE, empirically confirmed (not merely cited from docs): attempting the exact
/// reentrant scenario Elev.2 originally worried about is rejected by the host itself, before the
/// router's own code has any say in the matter. `CallbackRailStub` (built in STEP 2, kept rather
/// than deleted) calls back into the SAME router mid-invocation — this MUST panic with Soroban's
/// reentrancy-prohibited error. If this test ever starts passing (the call succeeds instead of
/// panicking), that is the visible alarm that the platform's default changed and Elev.2's safety
/// margin needs re-review, per THREAT_MODEL.md's updated status for this invariant.
#[test]
#[should_panic]
fn elev_2_platform_reentrancy_prohibition_blocks_the_exact_attack_this_invariant_worries_about() {
    let env = Env::default();
    // Circular dependency, resolved via register_at: the callback stub's constructor needs the
    // router's address, but the router's constructor needs the callback stub's address. Reserve
    // the router's address FIRST (Address::generate — a real, valid Soroban pattern for exactly
    // this situation, confirmed against soroban-sdk's own register_at doc example), register the
    // callback stub with that now-known address, then register the router at its reserved slot.
    let router_slot = Address::generate(&env);
    let callback_contract = env.register(CallbackRailStub, (router_slot.clone(),));
    // Real SAC for the usdc_sac slot — dispatch_one_leg's approve() call on it happens BEFORE the
    // reentrancy attempt below, on the way to it, so it needs to be a real, working token, not the
    // callback stub itself.
    let usdc_sac = register_test_sac(&env);
    let usdt0_sac = register_test_sac(&env);
    // This router's OWN "usdc_contract" IS the callback stub — so calling send_cross_chain's
    // CCTP leg invokes CallbackRailStub, which attempts to read volume() back from THIS SAME
    // router while it is still mid-invocation — a genuine reentrant call.
    env.register_at(
        &router_slot,
        Router,
        (
            callback_contract.clone(),
            callback_contract,
            usdc_sac,
            usdt0_sac,
        ),
    );
    let client = RouterClient::new(&env, &router_slot);
    let payer = Address::generate(&env);
    let dest = test_cctp_dest(&env, 6, [0x88; 32]);

    env.mock_all_auths();
    // MUST panic — the host rejects the callback's reentrant call before it ever returns.
    client.send_cross_chain(&payer, &Rail::Usdc, &dest, &1_000_000i128);
}

/// SOURCE-ORDER PROOF: the volume-counter write AND the `TransferSent` event publish (Repud.1) in
/// `dispatch_one_leg` are both lexically AFTER EVERY `atomic_invoke` call in BOTH rail arms, not
/// before any of them. Combined with the platform guarantee above (nothing can observe an
/// intermediate state from outside), this proves the write-ordering property structurally — for
/// any strategy, not just the one specific reentrant attempt the platform already blocks — rather
/// than relying on a single behavioral test that could pass for the wrong reason.
///
/// STEP 4: `dispatch_one_leg` grew from ONE `atomic_invoke` call site (the original CCTP-shaped
/// call) to THREE across its two arms — CCTP's single real call, and LayerZero's `quote_send` THEN
/// `send`. This test was rewritten to check EVERY real call site by name (not by a single
/// hardcoded call-argument string, which no longer uniquely identifies "the" external call now
/// that there is more than one), rather than narrowing the claim to only the call site that
/// happened to still exist.
///
/// Repud.1: extended to cover `TransferSent`'s publish call too, after a mutation-testing pass
/// found the event's OWN rollback test (`repud_1_a_rolled_back_leg_emits_no_event_...`) does not
/// actually detect a mispositioned publish call — Soroban's own transaction semantics discard a
/// reverted call's events regardless of where in `dispatch_one_leg` they were published, so that
/// behavioral test alone cannot distinguish "correctly placed" from "wrongly placed but rolled
/// back anyway." This structural, source-position check is what actually closes that gap — see
/// `repud_1_a_rolled_back_leg_emits_no_event_...`'s own doc comment for the full finding.
#[test]
fn elev_2_volume_write_is_lexically_after_the_external_call_in_source() {
    let lib_rs = std::include_str!("lib.rs");
    let write_pos = lib_rs
        .find("DataKey::Volume(rail.clone())")
        .expect("volume-counter write not found in dispatch_one_leg");
    // NOT a plain "TransferSent {" search — that also matches the struct's own DEFINITION
    // earlier in this file (confirmed the hard way: an earlier version of this anchor matched
    // the definition, byte position far too early, and made this assertion fail even for the
    // real, correctly-ordered code). `.publish(env)` is unique to the actual call site.
    let event_pos = lib_rs
        .find("destination: dest_recipient(dest),")
        .expect("TransferSent event publish not found in dispatch_one_leg");

    // Every real external-call site `dispatch_one_leg` can reach, named by the rail contract
    // function it invokes (formatting-robust: anchored on the function-name constant, which
    // `cargo fmt` cannot reflow away, rather than a full call-argument string).
    for (label, needle) in [
        ("CCTP deposit_for_burn", "RAIL_FN_CCTP, args"),
        ("OFT quote_send", "RAIL_FN_OFT_QUOTE_SEND, quote_args"),
        ("OFT send", "RAIL_FN_OFT_SEND, send_args"),
    ] {
        let call_pos = lib_rs
            .find(needle)
            .unwrap_or_else(|| panic!("{label}'s call site (`{needle}`) not found in dispatch_one_leg — if this call site was renamed or restructured, update this test's anchor to match, do not just delete the check"));
        assert!(
            write_pos > call_pos,
            "the volume-counter write (byte {}) must appear AFTER {label}'s call (byte {}) in \
             dispatch_one_leg's source — Elev.2 requires router state to finalize only once EVERY \
             external call in the leg has actually returned, and this is a structural guard \
             against a future edit silently reordering the two",
            write_pos,
            call_pos
        );
        assert!(
            event_pos > call_pos,
            "the TransferSent event publish (byte {}) must appear AFTER {label}'s call (byte {}) \
             in dispatch_one_leg's source — Repud.1's event should describe an executed transfer, \
             not an attempted one, and this is a structural guard against a future edit silently \
             moving the publish call earlier",
            event_pos,
            call_pos
        );
    }
}

/// CORRECTED FINDING from this file's own mutation-testing pass (per the STEP 2 sign-off's
/// "briefly comment out the protection and confirm the test catches it" instruction): an EARLIER
/// version of this comment claimed Dos.1's rollback tests
/// (`dos_1_one_leg_impossible_rolls_back_router_owned_state_too`,
/// `dos_1_all_legs_impossible_rolls_back_cleanly`) would ALSO catch a write-before-call ordering
/// bug, on the reasoning that a failed call rolling back state proves the write must come after a
/// SUCCESSFUL call. Directly testing that claim (moving the volume write to before
/// `atomic_invoke` in `dispatch_one_leg` and re-running the suite) proved it FALSE: both Dos.1
/// tests still passed with the write moved earlier, because Soroban's rollback-on-panic undoes a
/// PRIOR write in the same frame identically to a write that never happened — the failure path
/// cannot distinguish "wrote then failed, rolled back" from "never wrote, then failed" at all.
/// `elev_2_volume_write_is_lexically_after_the_external_call_in_source` (the lexical-order test)
/// is therefore the SOLE test that actually catches this specific mutation — confirmed by the
/// same experiment. This function is kept as a named, discoverable pointer to that corrected
/// understanding (not deleted silently), since a review reading only THREAT_MODEL.md's Elev.2
/// entry should see this correction, not the original, now-known-overstated claim.
#[test]
fn elev_2_dos_1_tests_do_not_independently_prove_write_ordering_only_atomicity() {
    // See this test's own doc comment above for the full finding. No new assertion here — this
    // exists purely as a named, discoverable correction to an earlier (wrong) claim.
}

// ---------------------------------------------------------------------------------------------
// STEP 6 — approve()'s live_until_ledger must be stable across simulate and apply
// ---------------------------------------------------------------------------------------------
//
// Real STEP 5 finding, root-caused via a direct re-read of soroban-env-host 27.0.1's own auth.rs
// (see THREAT_MODEL.md's STEP 6 section and EXTERNAL_REPORT_DRAFT.md for the full investigation):
// two real testnet submissions of send_cross_chain's CCTP leg failed, reproducibly, with a real
// "Unauthorized function call for address" error on the nested approve() sub-invocation — despite
// simulation succeeding completely and despite Stellar's own docs stating a single signature
// should cover a same-address nested tree. The actual cause: approve()'s live_until_ledger
// argument was computed as a raw `env.ledger().sequence() + APPROVE_LEDGER_WINDOW` — a value read
// from LIVE ledger state, recomputed fresh both when the CLI's own simulate-and-sign step ran and
// AGAIN when the transaction was actually applied on-chain, moments to seconds later. Soroban's
// authorization-tree matching requires a live call's full arguments to exactly equal what was
// signed; if a real ledger closed between those two moments (ordinary on a ~5-second-ledger-close
// network), the two computed values differed, and the real call's arguments matched no signed
// node at all — not a signature problem, an absence-of-match problem.

/// Direct proof of the fix's core property: two calls to `approve_live_until_ledger` at DIFFERENT
/// real ledger sequences — simulating exactly the simulate-time vs. apply-time gap that caused
/// STEP 5's real failure — must return the SAME value, as long as both sequences fall inside the
/// same `APPROVE_LEDGER_ROUNDING_WINDOW`-wide bucket. This is the property that makes the signed
/// authorization tree's recorded `approve` arguments still match the real, re-executed call's
/// arguments even after real ledgers have advanced in between.
#[test]
fn approve_live_until_ledger_is_stable_across_a_realistic_simulate_to_apply_gap() {
    let env = Env::default();

    // A realistic simulate-time sequence, then an apply-time sequence a few ledgers later — the
    // exact shape of STEP 5's real failure (its own real transactions were included roughly one to
    // two ledgers, a handful of seconds, after being signed).
    env.ledger().set_sequence_number(4_630_700);
    let at_simulate_time = crate::approve_live_until_ledger(&env);

    env.ledger().set_sequence_number(4_630_703);
    let at_apply_time_a_few_ledgers_later = crate::approve_live_until_ledger(&env);

    assert_eq!(
        at_simulate_time, at_apply_time_a_few_ledgers_later,
        "approve_live_until_ledger returned different values ({} vs {}) for two sequence numbers \
         only 3 ledgers apart — this is EXACTLY the drift that caused STEP 5's real testnet \
         failure; a real simulate-then-submit round trip must never see this function's return \
         value change",
        at_simulate_time, at_apply_time_a_few_ledgers_later
    );
}

/// Companion test, proving the fix didn't accidentally freeze the value forever (which would
/// silently reintroduce the ORIGINAL problem this constant's own doc comment warns about — a
/// stale, unused approval lingering indefinitely): once the real ledger sequence advances far
/// enough to cross into the NEXT rounding bucket, the computed value DOES change.
#[test]
fn approve_live_until_ledger_still_advances_once_a_rounding_boundary_is_crossed() {
    let env = Env::default();

    env.ledger().set_sequence_number(4_630_700);
    let before_boundary = crate::approve_live_until_ledger(&env);

    // APPROVE_LEDGER_ROUNDING_WINDOW is 20 — advancing by more than that guarantees crossing into
    // a new rounding bucket regardless of exactly where 4_630_700 sits inside its own bucket.
    env.ledger().set_sequence_number(4_630_700 + 25);
    let after_boundary = crate::approve_live_until_ledger(&env);

    assert!(
        after_boundary > before_boundary,
        "approve_live_until_ledger returned {} both before and after a 25-ledger advance — the \
         rounding fix must not freeze this value forever, only stabilize it across a realistic \
         simulate-to-apply gap",
        before_boundary
    );
}

// ---------------------------------------------------------------------------------------------
// Spoof.1 — rail contract identity must never be caller-suppliable
// ---------------------------------------------------------------------------------------------

/// COVERAGE GAP FOUND during this crate's own 100%-branch-coverage-on-the-authorization-path
/// measurement (per the STEP 2 sign-off's explicit requirement): `dispatch_one_leg`'s
/// `rail`/`dest` consistency panic (the guard against a caller passing e.g. `Rail::Usdc` with a
/// `Dest::LayerZero(..)`) was never exercised by any test — `cargo llvm-cov --branch` reported it
/// as a missed branch. Every other test in this file always passes a matching `rail`/`dest` pair.
/// This test closes that gap directly: an inconsistent pair MUST panic, never silently proceed
/// with whichever of the two the router happens to trust.
#[test]
#[should_panic]
fn spoof_1_rail_dest_mismatch_is_rejected_not_silently_trusted() {
    let (env, _usdc, _usdt0, client) = setup();
    let payer = Address::generate(&env);
    let refund_address = Address::generate(&env);
    // Rail::Usdc paired with a LayerZero (USDT0-shaped) destination — inconsistent.
    let mismatched_dest = Dest::LayerZero(
        30_110,
        BytesN::from_array(&env, &[0x99; 32]),
        refund_address,
    );

    client
        .mock_all_auths()
        .send_cross_chain(&payer, &Rail::Usdc, &mismatched_dest, &1_000_000i128);
}

/// STEP 1 -> STEP 2, now a REAL structural test rather than a compile-time-only shape check:
/// confirms `send_cross_chain`/`send_cross_chain_batch`'s public signatures have no `Address`
/// parameter used as an invocation target (only `payer`, a data value never used as a call
/// target), by source inspection — a caller cannot substitute a rail-contract address through the
/// public API at all, because no such parameter exists to substitute. This is the "hardcoded
/// constant, not a runtime check on a parameter that shouldn't exist as a parameter at all" shape
/// the sign-off asked for: there is nothing to runtime-check, because the parameter itself is
/// structurally absent.
#[test]
fn spoof_1_public_entry_points_have_no_caller_suppliable_contract_address_parameter() {
    let lib_rs = std::include_str!("lib.rs");
    let send_cross_chain_sig = lib_rs
        .lines()
        .find(|l| l.contains("pub fn send_cross_chain(env: Env"))
        .expect("send_cross_chain signature not found");
    let batch_sig = lib_rs
        .lines()
        .find(|l| l.contains("pub fn send_cross_chain_batch(env: Env"))
        .expect("send_cross_chain_batch signature not found");

    for sig in [send_cross_chain_sig, batch_sig] {
        // The only `Address` in either signature must be `payer` — never a second `Address`
        // parameter (which is exactly the shape a "custom rail contract" parameter would take).
        let address_param_count = sig.matches("Address").count();
        assert_eq!(
            address_param_count, 1,
            "expected exactly one Address parameter (payer) in `{}` — found {}; a second Address \
             parameter is exactly the shape THREAT_MODEL.md's Spoof.1 forbids (a caller-suppliable \
             rail-contract address)",
            sig, address_param_count
        );
    }
}

/// Behavioral companion to the structural test above, using GENUINELY DISTINGUISHABLE stubs
/// (`UsdcOnlyRailStub`/`Usdt0OnlyRailStub`, each implementing ONLY one of the two real function
/// names) rather than two instances of the same undifferentiated `RailStub`. This closes a real
/// gap this crate's own mutation-testing pass found: an earlier version of this test used
/// `RailStub` (which implements BOTH function names identically) for both slots, which made a
/// genuine constructor-argument-order bug (transposing which address maps to which rail)
/// completely invisible — the "wrong" contract still responded successfully to either function
/// name, so the test passed regardless of whether routing was actually correct. Confirmed by
/// directly swapping `dispatch_one_leg`'s `DataKey::UsdcContract`/`DataKey::Usdt0Contract` match
/// arms and observing the old test still passed. With genuinely distinguishable stubs, that same
/// swap now fails loudly (see below) instead of silently.
#[test]
fn spoof_1_dispatch_uses_the_constructor_set_address_for_the_matching_rail() {
    let env = Env::default();
    let usdc_contract = env.register(UsdcOnlyRailStub, ());
    let usdt0_contract = env.register(Usdt0OnlyRailStub, ());
    let usdc_sac = register_test_sac(&env);
    let usdt0_sac = register_test_sac(&env);
    let contract_id = env.register(Router, (usdc_contract, usdt0_contract, usdc_sac, usdt0_sac));
    let client = RouterClient::new(&env, &contract_id);
    let payer = Address::generate(&env);
    let dest = test_cctp_dest(&env, 6, [0x11; 32]);

    // If dispatch had (incorrectly) called usdt0_contract for a CCTP leg, this call would panic
    // with a real "function not found" error, since Usdt0OnlyRailStub does not implement
    // deposit_for_burn at all — a genuine, catchable failure, not a silent success.
    client
        .mock_all_auths()
        .send_cross_chain(&payer, &Rail::Usdc, &dest, &1_000_000i128);

    assert_eq!(client.volume(&Rail::Usdc), 1_000_000);
}

/// Pins the constructor's own argument order — `__constructor(usdc_contract, usdt0_contract)` —
/// against accidental transposition, which would silently route USDC sends to the OFT contract's
/// address and vice versa. Uses the same genuinely-distinguishable stubs as the test above, for
/// the same reason (see that test's doc comment for the mutation-testing finding this fixes).
#[test]
fn spoof_1_constructor_argument_order_maps_usdc_and_usdt0_to_the_right_slot() {
    let env = Env::default();
    let usdc_contract = env.register(UsdcOnlyRailStub, ());
    let usdt0_contract = env.register(Usdt0OnlyRailStub, ());
    let usdc_sac = register_test_sac(&env);
    let usdt0_sac = register_test_sac(&env);
    let contract_id = env.register(Router, (usdc_contract, usdt0_contract, usdc_sac, usdt0_sac));
    let client = RouterClient::new(&env, &contract_id);
    let payer = Address::generate(&env);
    let refund_address = Address::generate(&env);

    // If the constructor's arguments were transposed, this Rail::Usdt0 call would try to invoke
    // `send` on what is actually UsdcOnlyRailStub — which does not implement `send` — and panic
    // with a real "function not found" error instead of silently succeeding.
    client.mock_all_auths().send_cross_chain(
        &payer,
        &Rail::Usdt0,
        &Dest::LayerZero(
            30_110,
            BytesN::from_array(&env, &[0x22; 32]),
            refund_address,
        ),
        &2_000_000i128,
    );

    assert_eq!(client.volume(&Rail::Usdt0), 2_000_000);
    // And the USDC counter is untouched by an unrelated USDT0 send — a cross-check that the two
    // rails' bookkeeping (and, by extension, their contract-address resolution) are independent.
    assert_eq!(client.volume(&Rail::Usdc), 0);
}

// ---------------------------------------------------------------------------------------------
// Repud.1 — per-transfer event emission
// ---------------------------------------------------------------------------------------------

/// A single `send_cross_chain` call emits exactly one `TransferSent` event, and its fields are
/// the REAL values from this call — not defaults, not the OTHER leg's values in a later batch
/// test, so a copy/paste bug swapping which value goes where would show up here.
#[test]
fn repud_1_single_send_emits_transfer_sent_with_the_real_call_s_own_values() {
    let (env, _usdc, _usdt0, client) = setup();
    let payer = Address::generate(&env);
    let recipient = [0x77; 32];
    let dest = test_cctp_dest(&env, 6, recipient);
    let amount: i128 = 42_000_000;

    client
        .mock_all_auths()
        .send_cross_chain(&payer, &Rail::Usdc, &dest, &amount);

    let expected = TransferSent {
        payer: payer.clone(),
        rail: Rail::Usdc,
        destination: BytesN::from_array(&env, &recipient),
        amount,
    };
    let expected_xdr = expected.to_xdr(&env, &client.address);

    let events = env.events().all().filter_by_contract(&client.address);
    assert_eq!(events.events(), &[expected_xdr]);
}

/// A batch of TWO legs emits TWO `TransferSent` events, one per leg, each carrying that leg's OWN
/// rail/destination/amount — not one aggregate event for the whole batch, and not one event
/// duplicated for both legs. Directly proves `Repud.1.R.1`'s "per successful leg" wording is what
/// actually happens, not "per top-level call" (a plausible-but-wrong alternative reading this test
/// would catch: `send_cross_chain_batch` calling `dispatch_one_leg` — the one place the event is
/// emitted — for EVERY leg, not once for the whole batch).
#[test]
fn repud_1_batch_emits_one_transfer_sent_per_leg_not_one_per_batch() {
    let (env, _usdc, _usdt0, client) = setup();
    let payer = Address::generate(&env);
    let first_recipient = [0xAA; 32];
    let second_recipient = [0xBB; 32];
    let first_amount: i128 = 10_000_000;
    let second_amount: i128 = 20_000_000;
    let legs = soroban_sdk::vec![
        &env,
        (
            Rail::Usdc,
            test_cctp_dest(&env, 6, first_recipient),
            first_amount,
        ),
        (
            Rail::Usdc,
            test_cctp_dest(&env, 6, second_recipient),
            second_amount,
        ),
    ];

    client
        .mock_all_auths()
        .send_cross_chain_batch(&payer, &legs);

    let first_expected = TransferSent {
        payer: payer.clone(),
        rail: Rail::Usdc,
        destination: BytesN::from_array(&env, &first_recipient),
        amount: first_amount,
    }
    .to_xdr(&env, &client.address);
    let second_expected = TransferSent {
        payer: payer.clone(),
        rail: Rail::Usdc,
        destination: BytesN::from_array(&env, &second_recipient),
        amount: second_amount,
    }
    .to_xdr(&env, &client.address);

    let events = env.events().all().filter_by_contract(&client.address);
    assert_eq!(events.events(), &[first_expected, second_expected]);
}

/// The companion negative case Dos.1/Elev.2 already established for the `Volume` counter, now
/// proven for the event too: a leg that panics and rolls back emits NO event, even though
/// `dispatch_one_leg` had already built and was about to publish one for an EARLIER, individually
/// valid leg in the same batch. Reuses the exact rollback mechanics
/// `dos_1_one_leg_impossible_rolls_back_router_owned_state_too` already proved for `Volume`.
///
/// One real thing this test's own mutation-testing pass found, worth recording rather than
/// leaving as an unstated assumption: Soroban's OWN transaction semantics discard a reverted
/// call's published events, the same way they discard its storage writes — confirmed directly by
/// deliberately moving the event-publish call to the very TOP of `dispatch_one_leg` (before the
/// rail dispatch, unconditionally) and finding this test still passed. That mutation is a real
/// bug (it makes `dispatch_one_leg`'s own code no longer match its doc comment's ordering claim,
/// and produces a genuine DUPLICATE-event bug the batch test above catches instead — two
/// `TransferSent` events per leg, one from each publish site), but it is not what THIS test
/// actually detects; this test's real, narrow claim is platform-level (the host itself never lets
/// a reverted transaction's events survive), not proof of `dispatch_one_leg`'s own code placement.
/// The doc-comment-vs-code-ordering claim (Elev.2) is instead enforced the same way it already is
/// for `Volume`: by `elev_2_volume_write_is_lexically_after_the_external_call_in_source`'s own
/// source-text check, extended to cover the event publish call too — see that test.
#[test]
fn repud_1_a_rolled_back_leg_emits_no_event_even_for_an_earlier_valid_leg_in_the_same_batch() {
    let (env, _usdc, _usdt0, client) = setup();
    let payer = Address::generate(&env);
    let legs = soroban_sdk::vec![
        &env,
        (
            Rail::Usdc,
            test_cctp_dest(&env, 6, [0xCC; 32]),
            100_000_000i128,
        ), // would succeed alone, and would emit an event alone
        (Rail::Usdc, test_cctp_dest(&env, 6, [0xDD; 32]), -1i128), // guaranteed to fail
    ];

    let mocked = client.mock_all_auths();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        mocked.send_cross_chain_batch(&payer, &legs);
    }));
    assert!(result.is_err(), "expected the batch to panic");

    // THE assertion: zero events from this contract survive the rollback — not even the one for
    // the first leg, which was individually valid and reached `dispatch_one_leg`'s success path
    // before the SECOND leg's panic unwound the whole transaction.
    let events = env.events().all().filter_by_contract(&client.address);
    assert_eq!(events.events(), &[]);
}

#[cfg(test)]
mod proptest_destination_packing {
    //! Real property test for Tamper.1/Info.1, now that `pack_destination` has real logic.
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        /// Any valid 32-byte input round-trips byte-for-byte through `pack_destination`.
        #[test]
        fn pack_destination_round_trips_for_any_32_byte_input(bytes in prop::array::uniform32(any::<u8>())) {
            let env = Env::default();
            let usdc_contract = env.register(RailStub, ());
            let usdt0_contract = env.register(RailStub, ());
            let usdc_sac = register_test_sac(&env);
            let usdt0_sac = register_test_sac(&env);
            let contract_id = env.register(Router, (usdc_contract, usdt0_contract, usdc_sac, usdt0_sac));
            let client = RouterClient::new(&env, &contract_id);
            let raw = soroban_sdk::Bytes::from_array(&env, &bytes);

            let packed = client.pack_destination(&raw);
            prop_assert_eq!(packed, BytesN::from_array(&env, &bytes));
        }

        /// Any input whose length is NOT 32 is rejected (Err), never silently truncated/padded to
        /// a plausible-looking-but-wrong 32-byte value.
        #[test]
        fn pack_destination_rejects_any_non_32_byte_length(len in (0usize..64).prop_filter("not 32", |n| *n != 32)) {
            let env = Env::default();
            let usdc_contract = env.register(RailStub, ());
            let usdt0_contract = env.register(RailStub, ());
            let usdc_sac = register_test_sac(&env);
            let usdt0_sac = register_test_sac(&env);
            let contract_id = env.register(Router, (usdc_contract, usdt0_contract, usdc_sac, usdt0_sac));
            let client = RouterClient::new(&env, &contract_id);
            let bytes = std::vec![0xEFu8; len];
            let raw = soroban_sdk::Bytes::from_slice(&env, &bytes);

            let result = client.try_pack_destination(&raw);
            prop_assert_eq!(result, Err(Ok(RouterError::InvalidDestinationLength)));
        }
    }
}
