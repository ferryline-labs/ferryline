#![cfg(test)]

use super::{Router, RouterClient, INTERFACE_VERSION};
use soroban_sdk::Env;

#[test]
fn version_reports_interface_version() {
    let env = Env::default();
    let contract_id = env.register(Router, ());
    let client = RouterClient::new(&env, &contract_id);

    assert_eq!(client.version(), INTERFACE_VERSION);
}
