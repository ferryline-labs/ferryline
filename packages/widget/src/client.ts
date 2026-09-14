/**
 * Real `Ferryline` construction, one instance per widget element, with the real rail adapters
 * registered per network:
 *
 *  - `usdc-cctp` is ALWAYS registered — it is the only rail with a real Stellar testnet deployment
 *    (confirmed repeatedly across prior phases; see packages/core/VERIFIED.md), so it's the one
 *    rail this widget can complete end to end on testnet today.
 *  - `usdt0-layerzero` is registered ONLY for `network: "mainnet"`. This is not a widget-level
 *    policy check — `Usdt0LayerZeroAdapter`'s own constructor throws `ROUTE_UNSUPPORTED` for
 *    anything but `"mainnet"`, and its options type is literally `{ readonly network: "mainnet" }`
 *    (not a `"testnet" | "mainnet"` union). Attempting to construct it for testnet is a **compile-time**
 *    error, not a runtime one — so this module simply never attempts the construction in testnet
 *    mode, rather than constructing-then-catching. This is what "must not be offered as if it works
 *    when it structurally can't" (STEP 2 assignment) means at the code level: there is no code path
 *    where a testnet widget instance even holds a USDT0 adapter to accidentally route to.
 */
import { Buffer } from "buffer";

import { TransactionBuilder } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { createPublicClient, http } from "viem";
import { sepolia, mainnet, arbitrum, base, polygon } from "viem/chains";

import {
  Ferryline,
  InMemoryTransferStore,
  UsdcCctpAdapter,
  Usdt0LayerZeroAdapter,
  type EvmReader,
  type FerrylineNetwork,
  type RailId,
  type StellarRpc,
  type TransferStore,
} from "@ferryline/sdk";

const NETWORK_PASSPHRASE: Readonly<Record<FerrylineNetwork, string>> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};

export interface WidgetClientConfig {
  readonly network: FerrylineNetwork;
  /** Stellar RPC endpoint. Testnet default: Soroban RPC's public testnet endpoint. */
  readonly rpcUrl?: string;
  /** Ferryline relayer endpoint — used for BOTH inbound (EVM -> Stellar) and outbound
   *  (Stellar -> EVM) transfer registration/tracking. Threaded straight into FerrylineConfig's own
   *  relayerUrl (see @ferryline/sdk's index.ts) rather than kept as a widget-only concept — see
   *  index.ts's registerInboundTransfer/registerOutboundTransfer, both of which now read this same
   *  config from `this.client().ferryline.config` instead of building their own. */
  readonly relayerUrl?: string;
  /** Bearer token for the relayer above, if it requires one. */
  readonly relayerApiKey?: string;
  readonly store?: TransferStore;
}

const DEFAULT_RPC_URL: Readonly<Record<FerrylineNetwork, string>> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};

/** viem chain configs keyed by the SDK's own ChainSlug strings, so both sides agree on names. */
const EVM_CHAINS_BY_SLUG = {
  ethereum: mainnet,
  arbitrum,
  base,
  polygon,
  "ethereum-sepolia": sepolia,
} as const;

export type EvmChainSlug = keyof typeof EVM_CHAINS_BY_SLUG;

function buildEvmReaders(): Readonly<Partial<Record<string, EvmReader>>> {
  const readers: Record<string, EvmReader> = {};
  for (const [slug, chain] of Object.entries(EVM_CHAINS_BY_SLUG)) {
    // viem's PublicClient structurally satisfies EvmReader (readContract + getBalance with matching
    // signatures) — confirmed directly against @ferryline/sdk's own EvmReader interface, the same
    // real client shape STEP 1's inbound seam script used via createPublicClient({ chain: sepolia }).
    readers[slug] = createPublicClient({ chain, transport: http() });
  }
  return readers;
}

export interface WidgetClient {
  readonly ferryline: Ferryline;
  /** Rails actually registered for this network — "usdt0-layerzero" only ever appears for mainnet. */
  readonly availableRails: readonly RailId[];
  readonly networkPassphrase: string;
  /**
   * Submits an already-signed Stellar envelope via the real RPC client and returns the real,
   * network-issued transaction hash. Lives on `WidgetClient` (not called ad hoc from index.ts)
   * specifically so component tests can substitute a fake here instead of hitting a real RPC
   * endpoint — see index.test.ts's own client fixture.
   */
  submitStellarTransaction(signedXdr: string): Promise<string>;
}

/** Builds one real Ferryline instance, with real adapters, for the given network. */
export function createWidgetClient(config: WidgetClientConfig): WidgetClient {
  const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL[config.network];
  // `server` is the real, full rpc.Server (has `sendTransaction`, which the SDK's own narrower
  // `StellarRpc` interface deliberately omits — building/simulating never submits, see rpc.ts's own
  // doc comments). `stellarRpc` is the same instance, narrowed to what the adapters need.
  const server = new Server(rpcUrl);
  const stellarRpc: StellarRpc = server;
  const store = config.store ?? new InMemoryTransferStore();
  const evmReaders = buildEvmReaders();
  const networkPassphrase = NETWORK_PASSPHRASE[config.network];

  const ferryline = new Ferryline({
    network: config.network,
    rpcUrl,
    store,
    // exactOptionalPropertyTypes forbids `relayerUrl: undefined`/`relayerApiKey: undefined`
    // explicitly — each property is either present with a real string or absent entirely, matching
    // FerrylineConfig's own `?: string` fields (never `string | undefined`).
    ...(config.relayerUrl !== undefined ? { relayerUrl: config.relayerUrl } : {}),
    ...(config.relayerApiKey !== undefined ? { relayerApiKey: config.relayerApiKey } : {}),
  });

  ferryline.registerAdapter(
    new UsdcCctpAdapter({ network: config.network, stellarRpc, store, evmReaders }),
  );

  if (config.network === "mainnet") {
    // Only reachable in this branch: `config.network` is narrowed to the literal "mainnet" here,
    // which is the ONLY value Usdt0LayerZeroAdapter's constructor accepts — see this module's own
    // doc comment above for why there is no equivalent branch for "testnet".
    ferryline.registerAdapter(
      new Usdt0LayerZeroAdapter({ network: config.network, stellarRpc, store, evmReaders }),
    );
  }

  return {
    ferryline,
    availableRails: ferryline.rails(),
    networkPassphrase,
    async submitStellarTransaction(signedXdr: string): Promise<string> {
      const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
      if (!("operations" in tx)) {
        throw new Error(
          "submitStellarTransaction: expected a plain (non-fee-bump) transaction envelope",
        );
      }
      // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
      console.log(
        "[ferryline-widget client] submitStellarTransaction: parsed tx, local hash =",
        Buffer.from(tx.hash()).toString("hex"),
      );
      const hash = await submitStellarTransactionWithRejectionRecheck(server, tx);
      // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
      console.log(
        "[ferryline-widget client] submitStellarTransactionWithRejectionRecheck resolved, hash =",
        hash,
        "now waiting for confirmation before returning",
      );
      // Real, load-bearing wait: `sendTransaction` returns as soon as the network accepts the
      // envelope into its mempool, well before ledger inclusion — NOT confirmation. A caller that
      // treats this hash as "confirmed" and immediately calls `prepareStep` for a step whose build
      // depends on this one's on-chain effect (e.g. an approve's allowance, before the burn that
      // spends it) will get a real, correct rejection from the SDK, discovered directly during this
      // phase's own real E2E run: "the TokenMessengerMinter may spend 0.0000000 USDC ... but the
      // burn needs 0.5000000; submit the approve step and wait for it to confirm before preparing
      // the burn." Same real wait-for-confirmation pattern as STEP 1's proven outbound seam script
      // (experiments/widget-seam-outbound-cctp.ts's own waitForTransaction).
      const status = await waitForStellarConfirmation(server, hash);
      if (status !== "SUCCESS") {
        throw new Error(`transaction ${hash} did not succeed: ${status}`);
      }
      return hash;
    },
  };
}

/** Bounded retry count for {@link submitStellarTransactionWithRejectionRecheck}'s outer resubmit
 *  loop: how many times a still-genuinely-missing transaction gets resubmitted, not how long each
 *  on-chain recheck itself waits (that reuses {@link waitForStellarConfirmation}'s own, already-
 *  proven 60s ledger-close budget — see this function's own doc comment for why a shorter,
 *  bespoke window was tried first and found insufficient). */
const REJECTION_RECHECK_MAX_ATTEMPTS = 2;

/**
 * Submits an already-signed transaction, defensively handling a real, observed class of false
 * failure: `sendTransaction` reporting a rejection (e.g. `tx_bad_seq`) for a transaction that was, in
 * fact, valid and is later included successfully on-chain anyway — confirmed independently, three
 * times now, via direct Horizon queries during this widget's own real testnet E2E testing. This is a
 * genuine Soroban RPC-node-side staleness/timing issue (the node's own local sequence-number
 * pre-check lagging the network's actual, current state), not a Ferryline bug, and not something that
 * can be prevented, only defended against.
 *
 * The defense: on a rejection, do NOT immediately throw. Instead, independently check whether the
 * exact transaction actually landed on-chain anyway, via `getTransaction` keyed on the hash computed
 * *locally* from the signed envelope (`tx.hash()`, synchronous, no RPC round trip, so it's available
 * and trustworthy even though `sendTransaction`'s own returned `hash` on a rejected response should
 * not be relied on). Same "verify real on-chain state before deciding what happened" pattern already
 * used by the relayer's `reconcileSubmitting` (work/reconcile.ts) and by `feeBumpHashHex`
 * (work/submit.ts) for computing a trustworthy hash from a signed envelope up front.
 *
 * That on-chain recheck reuses {@link waitForStellarConfirmation} itself, at its own default (~60s)
 * budget, rather than a short, bespoke poll: an early version of this function used a 2-attempt,
 * 2-second-apart check (a few seconds total), which a real testnet run proved was not long enough.
 * Horizon later confirmed the exact rejected transaction from that run had landed successfully, at
 * 2026-09-14T20:52:02Z, well outside that short window, the same real "rejected but actually valid"
 * case this function exists to defend against, just not caught by too tight a timeout. Ledger close
 * (~5-6s) plus the same RPC-node staleness this function is already working around means the wait
 * needs the same generous, already-proven budget the success path uses, not a separate, shorter one.
 *
 * If `waitForStellarConfirmation` finds it landed (`SUCCESS`, or any resolved non-NOT_FOUND status):
 * treat this as success and return the hash, no error surfaces to the caller (a non-`SUCCESS` resolved
 * status, e.g. `FAILED`, is a genuine, real on-chain failure and is surfaced as such). If it times out
 * still not found: retry submission of the exact same already-signed XDR (never rebuilt with a fresh
 * sequence number — resubmitting the identical envelope is what keeps a retry from becoming its own
 * double-submission risk; a genuinely-landed transaction resubmitted this way comes back "DUPLICATE",
 * not a second real submission) a small, bounded number of times. Only once that outer bound is
 * exhausted without the transaction ever being found does this surface as a genuine failure.
 *
 * Exported (not just inlined into submitStellarTransaction) so this can be unit-tested directly
 * against a fake `Server`-shaped object, see client.test.ts.
 */
export async function submitStellarTransactionWithRejectionRecheck(
  server: Pick<Server, "sendTransaction" | "getTransaction">,
  tx: Parameters<Server["sendTransaction"]>[0],
  maxAttempts = REJECTION_RECHECK_MAX_ATTEMPTS,
  confirmationMaxAttempts?: number,
  confirmationPollIntervalMs?: number,
): Promise<string> {
  // Computed once, locally, from the signed envelope — independent of anything sendTransaction
  // returns, and stable across every retry below since the envelope itself is never rebuilt.
  const hash = Buffer.from(tx.hash()).toString("hex");

  let lastRejection: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
    console.log(
      `[ferryline-widget client] submitStellarTransactionWithRejectionRecheck: attempt ${String(attempt + 1)}/${String(maxAttempts)}, calling sendTransaction`,
    );
    const sent = await server.sendTransaction(tx);
    // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
    console.log(
      `[ferryline-widget client] sendTransaction responded with status = ${sent.status}`,
      sent,
    );
    if (sent.status === "PENDING" || sent.status === "DUPLICATE") {
      return hash;
    }
    lastRejection = new Error(
      `submission rejected: ${sent.status}${"errorResult" in sent && sent.errorResult ? ` (${sent.errorResult.toXDR("base64")})` : ""}`,
    );
    // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
    console.log(
      `[ferryline-widget client] rejected (${sent.status}), rechecking real on-chain state via getTransaction before giving up. hash = ${hash}`,
    );
    // Rejected (this attempt's own view) — before giving up, check real on-chain state directly, at
    // the same generous budget the success path already trusts: maybe it landed anyway (the
    // false-failure case this function exists for), in which case this rejection was simply wrong
    // and there is nothing to retry or report.
    try {
      const status = await waitForStellarConfirmation(
        server,
        hash,
        confirmationMaxAttempts,
        confirmationPollIntervalMs,
      );
      // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
      console.log(
        `[ferryline-widget client] on-chain recheck resolved with status = ${status} (rejection was likely spurious if SUCCESS)`,
      );
      if (status === "SUCCESS") {
        return hash;
      }
      // A resolved, non-SUCCESS status (e.g. FAILED) is a genuine, real on-chain outcome, not a
      // "maybe it landed" ambiguity, surface it as-is rather than retrying a definite failure.
      throw new Error(`transaction ${hash} did not succeed: ${status}`);
    } catch (confirmError) {
      // waitForStellarConfirmation itself throws only on its own timeout (still NOT_FOUND after its
      // whole budget) — genuinely not found yet, not a definite on-chain failure. Fall through to
      // this function's own outer retry rather than surfacing this timeout directly, so a resubmit
      // is attempted before giving up entirely.
      if (!(confirmError instanceof Error) || !confirmError.message.includes("not found after")) {
        // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
        console.log(
          "[ferryline-widget client] on-chain recheck found a DEFINITE outcome (not a timeout), surfacing as failure",
          confirmError,
        );
        throw confirmError;
      }
      // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
      console.log(
        `[ferryline-widget client] on-chain recheck timed out (still not found), ${attempt + 1 < maxAttempts ? "will resubmit" : "out of attempts, giving up"}`,
      );
    }
  }
  throw lastRejection instanceof Error
    ? lastRejection
    : new Error(`transaction ${hash}: submission rejected and never found on-chain`);
}

/**
 * Exported (not just internal to submitStellarTransaction) specifically so this real,
 * previously-missing wait can be unit-tested directly against a fake `Server`-shaped object,
 * without needing a full `createWidgetClient` call — see client.test.ts. Only `getTransaction` is
 * used, so the fake only needs to satisfy that one method.
 */
export async function waitForStellarConfirmation(
  server: Pick<Server, "getTransaction">,
  hash: string,
  maxAttempts = 40,
  pollIntervalMs = 1500,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const result = await server.getTransaction(hash);
    // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
    console.log(
      `[ferryline-widget client] waitForStellarConfirmation poll ${String(attempt + 1)}/${String(maxAttempts)} (hash ${hash}): ${result.status}`,
    );
    if (result.status !== Api.GetTransactionStatus.NOT_FOUND) {
      return result.status;
    }
  }
  throw new Error(
    `transaction ${hash} not found after ${String((maxAttempts * pollIntervalMs) / 1000)}s`,
  );
}
