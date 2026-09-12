#![cfg(test)]

use super::{Router, RouterClient, INTERFACE_VERSION};
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn version_reports_interface_version() {
    let env = Env::default();
    // Router's real __constructor (STEP 2, extended in STEP 4 with two SAC addresses) requires
    // four addresses; version() does not depend on any of them, so any four satisfy this test's
    // own purpose.
    let usdc_contract = Address::generate(&env);
    let usdt0_contract = Address::generate(&env);
    let usdc_sac = Address::generate(&env);
    let usdt0_sac = Address::generate(&env);
    let contract_id = env.register(Router, (usdc_contract, usdt0_contract, usdc_sac, usdt0_sac));
    let client = RouterClient::new(&env, &contract_id);

    assert_eq!(client.version(), INTERFACE_VERSION);
}
