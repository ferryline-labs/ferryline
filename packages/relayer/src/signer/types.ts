/**
 * The trust boundary for spending the sponsor's key. Every place in the relayer that needs a
 * signature goes through this interface, never through a raw secret key or Keypair directly. The
 * MVP implementation (env-secret-signer.ts) reads a hot key from an environment variable, but
 * nothing outside that one file may assume that: a future signer backed by a KMS, an HSM, or a
 * remote signing service (Turnkey, Fireblocks, etc.) plugs in here without any other module
 * changing. Treat this file as the seam a security review of "how does the sponsor key get used"
 * starts and ends at.
 */
export interface Signer {
  /** The G-address this signer signs for. Read once at startup, never re-derived from a secret elsewhere. */
  publicKey(): Promise<string>;

  /**
   * Sign an unsigned transaction envelope (base64 XDR) and return the signed envelope (base64 XDR).
   * Implementations MUST NOT log, persist, or otherwise let the unsigned or signed envelope escape
   * this call except by returning it — logging a signed fee-bump transaction would let anyone
   * capture and resubmit it.
   */
  sign(unsignedEnvelopeXdr: string): Promise<string>;
}
