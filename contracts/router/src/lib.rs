//! Ferryline router.
//!
//! Scaffold only. `send_cross_chain` and batch payouts are specified in the technical
//! doc and will be added once the TypeScript adapters have pinned down the exact
//! OFT `SendParam` and CCTP `deposit_for_burn_with_hook` argument encodings
//! (see packages/core/VERIFIED.md). Nothing here moves funds.
#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

/// Bumped on every incompatible change to the router's public interface.
pub const INTERFACE_VERSION: u32 = 0;

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    /// Interface version, so integrators and the SDK can assert compatibility on-chain.
    pub fn version(_env: Env) -> u32 {
        INTERFACE_VERSION
    }
}

#[cfg(test)]
mod test;
