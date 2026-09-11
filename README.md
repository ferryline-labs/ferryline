# Ferryline

Open-source toolkit for moving USDT0 and USDC between Stellar and other chains through the official 1:1 burn-and-mint rails: USDT0 over LayerZero, USDC over Circle's CCTP. Smart-account (C-address) wallets are a first-class concern, not an afterthought.

**Status: pre-alpha.** `@ferryline/core` types and utilities exist, and `@ferryline/sdk` ships two rail adapters: `usdt0-layerzero` (outbound Stellar → EVM with quote/build/track; inbound EVM → Stellar to G accounts only) and `usdc-cctp` (outbound as a two-transaction approve + `deposit_for_burn` with the burn assembled by `prepareStep` once the approve confirms; inbound as an EVM `depositForBurnWithHook` step builder that always targets the CctpForwarder; tracking through Circle's Iris attestation and the destination's nonce). Both are tested against recorded mainnet responses and neither has moved funds on a live chain from this repo. `usdc-cctp` requires `parameters.maxFee` and `parameters.minFinalityThreshold` on every request and ships no defaults. The relayer service and widget wiring are not started.

## What we build

| Package             | Path                                 | What it is                                                                                                                                                   |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@ferryline/core`   | [packages/core](packages/core)       | Shared types, the `RailAdapter` interface, decimal and dust handling (7 on Stellar, 6 shared), G/C/M address encoding, transfer ids. No network access.      |
| `@ferryline/sdk`    | [packages/sdk](packages/sdk)         | One interface for both rails: `quote → build → sign → track`. Returns unsigned XDR so it works with Stellar Wallets Kit, passkey and MPC wallets.            |
| `ferryline-relayer` | [packages/relayer](packages/relayer) | Completes what the protocols leave to the integrator: watches Circle attestations and submits `mint_and_forward` with a fee-bump. Self-hostable, Dockerised. |
| `@ferryline/widget` | [packages/widget](packages/widget)   | Drop-in web component for "deposit from / withdraw to any chain".                                                                                            |
| `ferryline-router`  | [contracts/router](contracts/router) | Soroban contract so vaults, payroll and escrow contracts can send cross-chain in one call. Separate cargo workspace.                                         |

### Why the pieces exist

- Each rail uses 7 decimals on Stellar and 6 elsewhere. The 7th decimal is dust and is returned to the caller, never silently dropped.
- Recipients are encoded differently per rail. Getting `mint_recipient` or `destination_caller` wrong on CCTP permanently strands funds, so the SDK refuses to build a burn whose fields do not point at Circle's `CctpForwarder`. See [packages/core/VERIFIED.md](packages/core/VERIFIED.md) for the upstream evidence.
- A USDT0 recipient must already hold a trustline or delivery fails with `op_no_trust`. The SDK checks before building.
- Circle does not forward into Stellar. Someone has to submit the final mint. That is the relayer.

## Architecture

```mermaid
flowchart LR
  subgraph App["Wallet · payout app · DeFi protocol"]
    W["Ferryline widget"] --> S["Ferryline SDK"]
    C["Soroban contract"] --> R["Ferryline router"]
  end
  S -->|"USDT0 out: quote_send / send"| OFT["USDT0 OFT on Stellar"]
  R --> OFT
  S -->|"USDC out: deposit_for_burn"| TM["CCTP contracts on Stellar"]
  R --> TM
  OFT --> LZ["LayerZero DVNs + executor"] --> DST["Destination chain"]
  TM --> IRIS["Circle Iris attestation"] --> DST
  SRC["Source chain"] -->|"USDC in: burn with hook"| IRIS
  IRIS --> RL["Ferryline relayer"] -->|"mint_and_forward + fee-bump"| FWD["CctpForwarder"] --> U["G / C / M recipient"]
  SRC -->|"USDT0 in"| LZ --> OFT --> U
```

USDT0 inbound is delivered by LayerZero's executor, so no relayer is needed, but the recipient must already hold a trustline. USDC inbound is where the relayer matters.

## Development

Requirements: Node 22.12+ (CI uses 24), pnpm 11, Rust stable with the `wasm32v1-none` target, and [stellar-cli](https://github.com/stellar/stellar-cli) 26 for the contract build.

```sh
pnpm install
pnpm build        # turbo: builds every package in dependency order
pnpm test         # vitest in every package
pnpm typecheck
pnpm lint && pnpm format

cd contracts/router
cargo test
stellar contract build
```

Every upstream fact the code depends on (contract interfaces, addresses, hook-data layout) is recorded with its source and date in [packages/core/VERIFIED.md](packages/core/VERIFIED.md). The product spec and roadmap live in [technical-doc.md](technical-doc.md).

### Experiments

[experiments/](experiments/) holds operator-run scripts that hit live endpoints and can spend testnet or mainnet assets. They are not part of the test suite. Each writes a dated result file to [packages/core/verified/experiments/](packages/core/verified/experiments/) so the outcome can be read without re-running it, and each stops with `BLOCKED` when it lacks funds or keys instead of assuming a result.

```sh
pnpm --filter experiments exp:cctp-burn-max-fee-zero      # testnet; needs USDC on the operator account
pnpm --filter experiments exp:cctp-finality-threshold     # testnet; needs USDC on the operator account
pnpm --filter experiments exp:inbound-usdt0-no-trustline  # mainnet only (USDT0 has no testnet); needs explicit opt-in
pnpm --filter experiments exp:inbound-usdt0-c-address     # mainnet only; needs explicit opt-in and a smart account
```

Recorded mainnet fixtures for the USDT0 adapter tests are regenerated (read-only) with `pnpm --filter @ferryline/sdk record:usdt0-fixtures`.

## License

Apache-2.0. See [LICENSE](LICENSE).
