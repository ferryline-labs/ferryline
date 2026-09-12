/**
 * Real Stellar Wallets Kit wiring — the kit's own `defaultModules()` bundle (Freighter, xBull,
 * Lobstr, Albedo, Rabet, and the others that need no extra config/polyfills; see the kit's own
 * `sdk/modules/utils.js` for the exact list). NOT `KeypairWalletModule` (STEP 1's test double,
 * which lives only in `experiments/lib/` and is deliberately never imported here) — this module is
 * the real thing STEP 1 explicitly flagged as its own gap.
 *
 * What's genuinely tested end-to-end vs. documented-but-manually-verified: see this package's own
 * e2e/ directory and its README. Short version: Freighter is the one real, official,
 * publicly-downloadable pre-built extension this project could load into an automated browser
 * context and drive for real (confirmed in `e2e/freighter.e2e.ts`). The other modules in
 * `defaultModules()` are wired identically — same kit, same ModuleInterface contract — but were not
 * independently driven through a real installed extension/app in this phase; that is reported
 * honestly, not silently assumed to work the same way.
 */
import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";

export interface ConnectedWallet {
  readonly address: string;
  readonly moduleId: string;
}

export interface WalletSession {
  connect(moduleId?: string): Promise<ConnectedWallet>;
  signTransaction(xdr: string, networkPassphrase: string): Promise<string>;
  disconnect(): Promise<void>;
  listModules(): readonly ModuleInterface[];
}

function networkPassphraseFor(network: "testnet" | "mainnet"): Networks {
  return network === "testnet" ? Networks.TESTNET : Networks.PUBLIC;
}

/**
 * Real StellarWalletsKit-backed session. One instance per widget element (the kit's own API is
 * static/global — see STEP 1's own finding on `StellarWalletsKit.init`/`setWallet` — so this class
 * exists to give each widget element its OWN modules list and its own re-init on network change,
 * rather than relying on the kit's shared global state across multiple widget instances on one
 * page).
 */
export class RealWalletSession implements WalletSession {
  private readonly modules: readonly ModuleInterface[];

  constructor(network: "testnet" | "mainnet") {
    this.modules = defaultModules();
    StellarWalletsKit.init({ modules: [...this.modules], network: networkPassphraseFor(network) });
  }

  listModules(): readonly ModuleInterface[] {
    return this.modules;
  }

  async connect(moduleId?: string): Promise<ConnectedWallet> {
    const target = moduleId ?? this.modules[0]?.productId;
    if (!target) {
      throw new Error("no wallet modules available");
    }
    StellarWalletsKit.setWallet(target);
    const { address } = await StellarWalletsKit.fetchAddress();
    return { address, moduleId: target };
  }

  async signTransaction(xdr: string, networkPassphrase: string): Promise<string> {
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, { networkPassphrase });
    return signedTxXdr;
  }

  async disconnect(): Promise<void> {
    await StellarWalletsKit.disconnect();
  }
}
