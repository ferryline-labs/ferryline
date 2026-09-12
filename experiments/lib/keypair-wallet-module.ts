/**
 * A real Stellar Wallets Kit `ModuleInterface` implementation backed by a plain testnet `Keypair`,
 * used ONLY for the widget phase's STEP 1 seam-proof script.
 *
 * WHY THIS EXISTS, STATED PLAINLY (per the STEP 1 assignment's own instruction: find the closest
 * real equivalent and say so explicitly, don't silently substitute something weaker): Stellar
 * Wallets Kit (`@creit.tech/stellar-wallets-kit` 2.6.0) genuinely has NO shipped headless/testing
 * module — confirmed by an exhaustive scan of its own published `exports` map (every entry is a
 * real browser-extension wallet, a hardware-wallet, or a WalletConnect-style module; nothing named
 * "test", "headless", "keypair", or similar exists) and its full repo file tree. This is not an
 * oversight to work around quietly; it's how the kit is designed, and the widget's real
 * integration surface with a real wallet (Freighter, xBull, Lobstr, etc.) is genuinely this
 * `ModuleInterface` contract — the same one every one of the kit's real wallet modules implements.
 *
 * `ModuleInterface` itself (the kit's own `src/types/mod.ts`) is DOM-free by its own type
 * definition — confirmed directly by reading the real installed package's `.d.ts`, not assumed.
 * This class implements that REAL interface with a REAL `Keypair.fromSecret(...)` behind it, so
 * `StellarWalletsKit.signTransaction(...)` — the kit's own real, unmodified orchestration code —
 * is what actually runs when this script "connects a wallet" and signs. The only thing substituted
 * is WHERE the private key lives (a raw secret here; a browser extension's own storage in a real
 * deployment) — the signing code PATH through the kit is the real one, not mocked.
 *
 * NOT claimed: that this proves a real browser extension's own UI/permission/connection flow
 * works. It doesn't test Freighter's popup, xBull's approval screen, or any extension-specific
 * behavior — only that the kit's `ModuleInterface` contract, once satisfied by ANY implementation,
 * correctly drives a real Stellar transaction through to a real signed XDR. See this experiment's
 * own report for the explicit gap this leaves (report item 1).
 */
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { ModuleType, Networks } from "@creit.tech/stellar-wallets-kit/types";
import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit/types";

export class KeypairWalletModule implements ModuleInterface {
  moduleType = ModuleType.HOT_WALLET;
  productId = "keypair-test-signer";
  productName = "Keypair test signer (not a real wallet — STEP 1 seam-proof only)";
  productUrl = "https://developers.stellar.org/docs/tools/sdks/library";
  productIcon = "";

  private readonly keypair: Keypair;
  private readonly networkPassphrase: string;

  constructor(secret: string, networkPassphrase: string = Networks.TESTNET) {
    this.keypair = Keypair.fromSecret(secret);
    this.networkPassphrase = networkPassphrase;
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  getAddress(): Promise<{ address: string }> {
    return Promise.resolve({ address: this.keypair.publicKey() });
  }

  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }> {
    const tx = TransactionBuilder.fromXDR(xdr, opts?.networkPassphrase ?? this.networkPassphrase);
    tx.sign(this.keypair);
    return Promise.resolve({
      signedTxXdr: tx.toXDR(),
      signerAddress: this.keypair.publicKey(),
    });
  }

  signAuthEntry(): Promise<{ signedAuthEntry: string; signerAddress?: string }> {
    throw new Error("KeypairWalletModule: signAuthEntry not needed for this seam-proof script");
  }

  signMessage(): Promise<{ signedMessage: string; signerAddress?: string }> {
    throw new Error("KeypairWalletModule: signMessage not needed for this seam-proof script");
  }

  getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    return Promise.resolve({ network: "TESTNET", networkPassphrase: this.networkPassphrase });
  }
}
