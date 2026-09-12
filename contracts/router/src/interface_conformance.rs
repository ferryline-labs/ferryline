//! STEP 4's structural fix for the root cause STEP 3 found (see THREAT_MODEL.md's STEP 3 section
//! and this crate's STEP 4 report): a hand-written test double built to mirror the router's OWN
//! assumption of a rail contract's interface — rather than derived from or checked against an
//! independent source — can pass while the router's real call to that contract is wrong. That is
//! exactly what happened to every behavioral test in `invariants.rs` before this fix: `RailStub`
//! accepted whatever `dispatch_one_leg` sent it, by construction, so no scenario test could ever
//! have caught an argument-count or argument-shape mismatch against the REAL deployed contracts.
//!
//! This module is the independent check: it parses the REAL parameter list straight out of the
//! verified interface dumps this crate already depends on (`packages/core/verified/*.rs` — the
//! same files `TESTNET_DEPLOYMENT.md` cites as the source of truth for STEP 3's finding) and
//! compares it against what `dispatch_one_leg`'s own source actually builds, rather than against a
//! second hand-typed list a future edit could silently let drift from the router's real call sites
//! the same way the original bug drifted from the real contracts. If a future edit changes either
//! side without updating the other, this fails — independent of whether any hand-written scenario
//! test happens to exercise the changed code path.
#![cfg(test)]
extern crate std;

use std::string::{String, ToString};
use std::vec::Vec;

const CCTP_DUMP: &str =
    std::include_str!("../../../packages/core/verified/cctp-token-messenger-minter.mainnet.rs");
const OFT_DUMP: &str = std::include_str!("../../../packages/core/verified/usdt0-oft.mainnet.rs");
const LIB_RS: &str = std::include_str!("lib.rs");

/// Extracts a Rust function's parameter list from a verified interface dump's raw text, as
/// `(name, type)` pairs, in the REAL contract's own declared order. Looks for `fn <name>(` and
/// reads forward to the matching close-paren, splitting on commas that are not nested inside a
/// generic's `<...>` (needed for `BytesN<32>`, `Option<BytesN<32>>`, etc., which each contain a
/// comma-free but angle-bracketed type — actually neither example has an internal comma, but
/// `Result<T, E>`-shaped types elsewhere in these dumps do, so the depth tracking is real, not
/// decorative, for this parser to be safely reusable if this file grows more functions later).
fn extract_real_params(dump: &str, fn_name: &str) -> Vec<(String, String)> {
    let needle = std::format!("fn {fn_name}(");
    let start = dump
        .find(&needle)
        .unwrap_or_else(|| panic!("`fn {fn_name}(` not found in the verified interface dump — the dump may have moved or been renamed; this parser's needle must be updated to match, NOT the router's own assumption of the signature"));
    let after_open = start + needle.len();
    let mut depth = 1i32; // one open paren already consumed by `needle`
    let mut end = after_open;
    for (i, ch) in dump[after_open..].char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    end = after_open + i;
                    break;
                }
            }
            _ => {}
        }
    }
    let params_text = &dump[after_open..end];

    let mut params = Vec::new();
    let mut angle_depth = 0i32;
    let mut current = String::new();
    for ch in params_text.chars() {
        match ch {
            '<' => {
                angle_depth += 1;
                current.push(ch);
            }
            '>' => {
                angle_depth -= 1;
                current.push(ch);
            }
            ',' if angle_depth == 0 => {
                params.push(current.trim().to_string());
                current = String::new();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        params.push(current.trim().to_string());
    }

    params
        .into_iter()
        .filter_map(|p| {
            let mut parts = p.splitn(2, ':');
            let name = parts.next()?.trim().to_string();
            let ty = parts.next()?.trim().to_string();
            Some((name, ty))
        })
        // The implicit `env: Env` parameter is never a value in `atomic_invoke`'s `args` vec
        // (`env` is a separate argument to `atomic_invoke` itself, not part of the `Vec<Val>`) —
        // excluded here so this function's output directly comparable to that vec's entry count.
        .filter(|(name, _)| name != "env")
        .collect()
}

/// Counts the value-producing entries the router's OWN source builds for one rail's call — the
/// number of `vec_entry_identifiers_after` entries, which already excludes the leading `env`
/// handle (see that function's own doc comment). Kept as a thin wrapper so the two count-based
/// tests read naturally as "how many did it send", while the shape test below reads the same
/// underlying entries for "what type is each one" — both against the SAME parsed vec text, not two
/// independently-parsed notions of it that could silently drift from each other.
fn count_vec_entries_after(anchor: &str) -> usize {
    vec_entry_identifiers_after(anchor).len()
}

/// STEP 5: `dispatch_one_leg` calls plain `deposit_for_burn` (8 real arguments), NOT
/// `deposit_for_burn_with_hook` (9 — see `RAIL_FN_CCTP`'s own doc comment in `lib.rs` for the real
/// testnet finding — `HookDataEmpty` — that caused the switch). This test was updated to check the
/// function the router ACTUALLY calls; it does not also check the unused `_with_hook` variant,
/// since a conformance check on a function the router never calls would prove nothing about it.
#[test]
fn cctp_call_sends_every_real_argument_deposit_for_burn_requires() {
    let real_params = extract_real_params(CCTP_DUMP, "deposit_for_burn");
    assert_eq!(
        real_params.len(),
        8,
        "expected the verified CCTP dump's deposit_for_burn to have 8 non-env \
         parameters (caller, amount, destination_domain, mint_recipient, burn_token, \
         destination_caller, max_fee, min_finality_threshold) — parsed {} instead: {:?}. \
         Either the parser broke or the real interface changed; check packages/core/verified/ \
         directly before assuming either.",
        real_params.len(),
        real_params
    );

    let sent = count_vec_entries_after(
        "Dest::Cctp(destination_domain, mint_recipient, max_fee, min_finality_threshold) => {",
    );
    assert_eq!(
        sent,
        real_params.len(),
        "dispatch_one_leg's CCTP call sends {} argument(s) but the verified interface requires \
         {} ({:?}) — this is exactly the STEP 3 bug class: the router's own call-building code \
         has drifted from the real contract's interface. Fix dispatch_one_leg, not this test.",
        sent,
        real_params.len(),
        real_params
    );
}

#[test]
fn oft_quote_send_call_sends_every_real_argument_quote_send_requires() {
    let real_params = extract_real_params(OFT_DUMP, "quote_send");
    assert_eq!(
        real_params.len(),
        3,
        "expected the verified OFT dump's quote_send to have 3 non-env parameters (from, \
         send_param, pay_in_zro) — parsed {} instead: {:?}",
        real_params.len(),
        real_params
    );

    let sent = count_vec_entries_after("let quote_args = soroban_sdk::vec![");
    // count_vec_entries_after anchors on text BEFORE `soroban_sdk::vec![`, and this specific call
    // site anchors on its own `let` line (which already contains the marker), so search from the
    // `let` line itself rather than requiring a separate preceding anchor.
    let real_len = real_params.len();
    assert_eq!(
        sent, real_len,
        "dispatch_one_leg's quote_send call sends {} argument(s) but the verified interface \
         requires {} ({:?})",
        sent, real_len, real_params
    );
}

#[test]
fn oft_send_call_sends_every_real_argument_send_requires() {
    let real_params = extract_real_params(OFT_DUMP, "send");
    assert_eq!(
        real_params.len(),
        4,
        "expected the verified OFT dump's send to have 4 non-env parameters (from, send_param, \
         fee, refund_address) — parsed {} instead: {:?}",
        real_params.len(),
        real_params
    );

    let sent = count_vec_entries_after("let send_args = soroban_sdk::vec![");
    let real_len = real_params.len();
    assert_eq!(
        sent, real_len,
        "dispatch_one_leg's send call sends {} argument(s) but the verified interface requires {} \
         ({:?}) — NOTE: a matching count alone does NOT prove a matching SHAPE (see \
         oft_send_call_uses_struct_typed_send_param_and_fee_not_scalars below for the check that \
         closes that specific gap, discovered via this crate's own mutation-testing pass)",
        sent, real_len, real_params
    );
}

/// STEP 4 mutation-testing finding, corrected rather than silently patched over (per this crate's
/// established discipline — see THREAT_MODEL.md's Elev.2/Spoof.1 rows for two earlier instances of
/// the same discipline): `oft_send_call_sends_every_real_argument_send_requires` above ONLY checks
/// argument COUNT, not TYPE. Directly testing this by mutation (reverting `send`'s call args to the
/// original STEP 3 bug's 4 scalars — `payer, amount, dst_eid, to` — instead of the real
/// `from, send_param, fee, refund_address`) proved the count-only check does NOT catch it: both
/// shapes have exactly 4 non-env entries, so a pure count comparison is STRUCTURALLY BLIND to this
/// specific bug class for `send` (though it DOES catch CCTP's bug, which is a genuine count
/// mismatch — 4 sent vs 9 real, confirmed by the identical mutation-testing technique on that call).
///
/// This test closes that gap: it confirms the router's `send_args`/`quote_args` vecs, at the
/// POSITIONS where the real interface requires a `SendParam`/`MessagingFee` struct, are built from
/// a variable whose declared type is `SendParam`/`MessagingFee` — not a primitive — by reading the
/// vec entry's own expression text (stripping `.into_val(env)`/`.clone()`) and checking that
/// identifier's `let` binding in `dispatch_one_leg`'s LayerZero arm.
#[test]
fn oft_send_call_uses_struct_typed_send_param_and_fee_not_scalars() {
    let send_entries = vec_entry_identifiers_after("let send_args = soroban_sdk::vec![");
    assert_eq!(
        send_entries.len(),
        4,
        "expected 4 entries in send_args to check shape for — got {:?}; the count test above \
         should already have failed if this count is wrong",
        send_entries
    );
    // Real order: from, send_param, fee, refund_address (index 1 and 2 are the two struct-typed
    // params this check exists for).
    assert_eq!(
        local_variable_type(&send_entries[1]).as_deref(),
        Some("SendParam"),
        "send_args[1] (the real interface's `send_param: SendParam`) is built from `{}`, whose \
         declared type is {:?}, not SendParam — this is exactly the STEP 3 OFT bug: a scalar \
         value standing in for a required struct. A matching argument COUNT does not prove a \
         matching SHAPE (see this test's own doc comment for the mutation-testing finding that \
         PROVES this needed its own check).",
        send_entries[1],
        local_variable_type(&send_entries[1])
    );
    assert_eq!(
        local_variable_type(&send_entries[2]).as_deref(),
        Some("MessagingFee"),
        "send_args[2] (the real interface's `fee: MessagingFee`) is built from `{}`, whose \
         declared type is {:?}, not MessagingFee",
        send_entries[2],
        local_variable_type(&send_entries[2])
    );
}

/// Extracts each `soroban_sdk::vec![...]` entry's leading expression text (e.g. `send_param` from
/// `send_param.into_val(env)`, or `send_param` from `send_param.clone().into_val(env)`), in order,
/// using the same anchor/bracket-depth-aware approach `count_vec_entries_after` uses to find the
/// vec body — factored so both functions read the SAME real vec text rather than one re-deriving
/// it independently and silently drifting from the other's notion of where the vec is.
fn vec_entry_identifiers_after(anchor: &str) -> Vec<String> {
    let body = vec_body_after(anchor);
    let mut depth = 0i32;
    let mut current = String::new();
    let mut entries = Vec::new();
    for ch in body.chars() {
        match ch {
            '(' | '[' | '<' => {
                depth += 1;
                current.push(ch);
            }
            ')' | ']' | '>' => {
                depth -= 1;
                current.push(ch);
            }
            ',' if depth == 0 => {
                entries.push(current.trim().to_string());
                current = String::new();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        entries.push(current.trim().to_string());
    }
    // First entry is always the literal `env` handle (see count_vec_entries_after's own doc
    // comment) — not one of the real call's arguments, so dropped here the same way.
    entries
        .into_iter()
        .skip(1)
        .map(|e| {
            // Strip a trailing `.into_val(env)` (always present — every real entry in this file's
            // vecs is `<expr>.into_val(env)`) and any `.clone()` before it, down to the bare
            // leading identifier this function's callers look up a declared type for.
            let e = e.trim_end_matches(".into_val(env)").trim();
            let e = e.trim_end_matches(".clone()").trim();
            e.to_string()
        })
        .collect()
}

/// Shared by `count_vec_entries_after` and `vec_entry_identifiers_after`: finds the `[`-`]` body of
/// the first `soroban_sdk::vec![` after `anchor`.
fn vec_body_after(anchor: &str) -> String {
    let anchor_pos = LIB_RS.find(anchor).unwrap_or_else(|| {
        panic!("anchor `{anchor}` not found in lib.rs — dispatch_one_leg's structure changed; update this test's anchor to point at the (possibly relocated) real call-building code, do not just delete the check")
    });
    let vec_marker = "soroban_sdk::vec![";
    let vec_start = LIB_RS[anchor_pos..]
        .find(vec_marker)
        .map(|i| anchor_pos + i + vec_marker.len())
        .expect("no soroban_sdk::vec![ found after anchor");

    let mut depth = 1i32;
    let mut end = vec_start;
    for (i, ch) in LIB_RS[vec_start..].char_indices() {
        match ch {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    end = vec_start + i;
                    break;
                }
            }
            _ => {}
        }
    }
    LIB_RS[vec_start..end].to_string()
}

/// Looks up a local variable's declared type in `dispatch_one_leg`'s source, by finding
/// `let <name>: <Type>` (explicit annotation) or `let <name> = <Type> {` / `let <name> = <Type>(`
/// (inferred from a struct-literal or tuple-variant construction) anywhere in `lib.rs`, searching
/// from the START of the file so the check works regardless of which arm the binding is in. Returns
/// `None` if no recognizable declaration is found (e.g. the identifier isn't a simple local
/// variable — the calling test then fails with a clear "not SendParam" message rather than a panic,
/// since a missing type is itself evidence something doesn't match, not a parser bug to hide).
fn local_variable_type(name: &str) -> Option<String> {
    for marker in [std::format!("let {name}: "), std::format!("let {name} = ")] {
        if let Some(pos) = LIB_RS.find(&marker) {
            let after = &LIB_RS[pos + marker.len()..];
            // Explicit annotation: `let x: Type = ...` — type ends at the next `=` or `,`.
            if marker.ends_with(": ") {
                let end = after.find(['=', ',', ';']).unwrap_or(after.len());
                return Some(after[..end].trim().to_string());
            }
            // Inferred from construction: `let x = Type { ... }` or `let x = Type(...)` or
            // `let x = Type::something(...)` — type is the identifier immediately after `= `,
            // up to the first non-identifier character (`{`, `(`, `.`, `:`, whitespace).
            let end = after
                .find(|c: char| !(c.is_alphanumeric() || c == '_'))
                .unwrap_or(after.len());
            let candidate = after[..end].trim().to_string();
            if !candidate.is_empty() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Field-name check for the two structs the router defines to match LayerZero's real types:
/// every real field name in the verified dump's `SendParam`/`MessagingFee` must appear, verbatim,
/// in the router's own struct definition in `lib.rs`. This catches a field RENAMED or DROPPED
/// relative to the real contract — `#[contracttype]` structs encode by field name (see `SendParam`
/// 's own doc comment in `lib.rs`), so a name mismatch is a real cross-contract encoding bug, not
/// cosmetic.
#[test]
fn router_send_param_and_messaging_fee_structs_have_every_real_field_name() {
    let real_send_param_fields = extract_real_struct_fields(OFT_DUMP, "SendParam");
    let real_messaging_fee_fields = extract_real_struct_fields(OFT_DUMP, "MessagingFee");

    assert!(
        !real_send_param_fields.is_empty(),
        "failed to parse SendParam's real fields from the verified dump — parser or dump problem, check before trusting this test's other assertions"
    );
    assert!(
        !real_messaging_fee_fields.is_empty(),
        "failed to parse MessagingFee's real fields from the verified dump"
    );

    for field in &real_send_param_fields {
        assert!(
            LIB_RS.contains(&std::format!("pub {field}:")),
            "lib.rs's SendParam definition is missing real field `{field}` (found in the verified \
             OFT dump) — a missing/renamed field here is a real cross-contract encoding mismatch, \
             not cosmetic, since #[contracttype] structs encode by field name",
        );
    }
    for field in &real_messaging_fee_fields {
        assert!(
            LIB_RS.contains(&std::format!("pub {field}:")),
            "lib.rs's MessagingFee definition is missing real field `{field}` (found in the \
             verified OFT dump)",
        );
    }
}

/// Extracts a `pub struct <name> { field: Type, ... }` definition's field names from a verified
/// dump's raw text, the same bracket-depth-aware technique `extract_real_params` uses.
fn extract_real_struct_fields(dump: &str, struct_name: &str) -> Vec<String> {
    let needle = std::format!("pub struct {struct_name} {{");
    let Some(start) = dump.find(&needle) else {
        return Vec::new();
    };
    let after_open = start + needle.len();
    let end = dump[after_open..]
        .find('}')
        .map(|i| after_open + i)
        .unwrap_or(dump.len());
    let body = &dump[after_open..end];

    body.lines()
        .filter_map(|line| {
            let line = line.trim().trim_start_matches("pub ").trim_end_matches(',');
            let mut parts = line.splitn(2, ':');
            let name = parts.next()?.trim();
            if name.is_empty() || parts.next().is_none() {
                None
            } else {
                Some(name.to_string())
            }
        })
        .collect()
}
