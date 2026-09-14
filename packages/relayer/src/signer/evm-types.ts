import type { PrivateKeyAccount } from "viem";

/**
 * The EVM mirror of ./types.ts's own `Signer` interface — same trust-boundary intent (one file
 * reads the raw secret, everything else touches only an interface), a real, deliberate SHAPE
 * difference from the Stellar version, not an oversight:
 *
 * Stellar's `Signer.sign(unsignedEnvelopeXdr)` works because Stellar transactions are built as
 * plain, chain-agnostic XDR that any signer can sign independently of how the transaction gets
 * broadcast. viem's own signing model is different: `WalletClient.writeContract` takes an
 * account bound at CLIENT CONSTRUCTION time and internally signs-then-broadcasts as one call — the
 * account itself IS the "sign with this key" primitive viem expects, not a standalone
 * "hand me XDR, get back signed XDR" function. Forcing an artificial `sign(unsignedTx)` shape onto
 * viem here would mean re-implementing viem's own transaction-encoding/signing internals just to
 * produce a string this same code would immediately hand back to viem to broadcast — a real
 * complexity cost for no safety benefit, since the actual property this project cares about (only
 * ONE file ever reads the raw private key; every other module only ever touches an account
 * reference/address) is preserved either way.
 *
 * `EvmSigner.account` is a real, live viem `PrivateKeyAccount` — a signing capability object, not
 * the raw key itself (the raw hex private key never escapes env-secret-evm-signer.ts once
 * `privateKeyToAccount` consumes it, same "sign in one place" property `Signer.sign` provides for
 * the Stellar side, expressed the way viem's own API naturally shapes it rather than fought
 * against).
 */
export interface EvmSigner {
  /** The 0x-prefixed EVM address this signer signs for. Read once at startup. */
  address(): Promise<`0x${string}`>;
  /** The live viem account object `createRelayerEvmRpc` binds its WalletClient to. Every module
   *  downstream of chain/evm-rpc.ts only ever holds a RelayerEvmRpc built from this — nothing else
   *  in the outbound relayer imports viem/accounts or touches a raw private key directly. */
  readonly account: PrivateKeyAccount;
}
