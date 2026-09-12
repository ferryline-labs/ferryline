# @ferryline/widget

A drop-in `<ferryline-widget>` custom element for moving USDC/USDT0 between Stellar and other
chains via `@ferryline/sdk`. Plain Web Component — works in React, Vue, or a static HTML page with
no framework wrapper (there is deliberately no React wrapper in this v0.x; see the phase's own scope
note below if you're wondering why).

## Install and register

```bash
npm install @ferryline/widget
```

```ts
import { defineFerrylineWidget } from "@ferryline/widget";
defineFerrylineWidget(); // registers <ferryline-widget>; safe to call more than once
```

```html
<ferryline-widget network="testnet"></ferryline-widget>
<script type="module">
  const widget = document.querySelector("ferryline-widget");
  widget.request = {
    asset: "USDC",
    from: { chain: "stellar", address: "G..." },
    to: { chain: "ethereum-sepolia", address: "0x..." },
    amount: "10",
    parameters: { maxFee: "0", minFinalityThreshold: 2000 },
  };
</script>
```

Setting `.request` kicks off a real quote immediately. There is no attribute form for a full
`TransferRequest` — it doesn't serialize cleanly to a single HTML attribute — so it's always set as
a property, imperatively, from your own page's JS.

## Attributes

| Attribute         | Values                       | Default         | Notes                                                                                    |
| ----------------- | ---------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `network`         | `testnet` \| `mainnet`       | `testnet`       | Changing it tears down and rebuilds the widget's internal client/wallet session.         |
| `rpc-url`         | a Soroban RPC URL            | network default | Override if you run your own RPC node.                                                   |
| `relayer-url`     | a Ferryline relayer base URL | —               | Required for inbound (EVM → Stellar) CCTP tracking; see `registerInboundTransfer` below. |
| `relayer-api-key` | a bearer token               | —               | Sent as `Authorization: Bearer <key>` to the relayer.                                    |

## Rail availability: testnet is CCTP-only, by construction

In `network="testnet"` mode, only `usdc-cctp` is ever registered. This isn't a UI-level check —
`Usdt0LayerZeroAdapter`'s own constructor option type is literally `{ network: "mainnet" }` (not a
`"testnet" | "mainnet"` union), because USDT0 has no Stellar testnet deployment. The widget's
internal client (`src/client.ts`) only constructs a `UsdcCctpAdapter` in testnet mode — there is no
code path where a testnet widget instance even holds a USDT0 adapter to accidentally route to, so
USDT0 can never be silently offered as working when it structurally isn't. In `network="mainnet"`
mode, both rails are registered and available.

## Transaction preview: cannot be bypassed

Before any call to a wallet's `signTransaction`, the widget decodes and renders the real built
step — contract/function for a Stellar invocation, or the real ERC-20/TokenMessengerV2 call for an
EVM step, not raw XDR or hex — with an explicit Confirm/Cancel. This is enforced structurally, not
just by UI convention: the internal state machine's `confirmPreviewAndSign` function is the only
thing that can produce a `signing` phase, and it accepts only a `preview`-phase value as input
(`src/state.ts`). There is no other function anywhere in this package that reaches `signing`.

## Wallet support

Wired against Stellar Wallets Kit's real `defaultModules()` bundle: Albedo, Freighter, Fordefi,
Rabet, xBull, LOBSTR, Hana, Klever, OneKey, Bitget, Cactus Link, D'CENT, Scopuly — whatever that
function returns from the installed kit version, rendered as connect buttons inside the preview
step. See the repo's own phase report for which of these were driven through a real, installed
browser extension end-to-end versus wired identically but not independently verified.

## Testnet mode and faucets

In `network="testnet"` mode, the widget surfaces two real, public testnet faucet links:
Friendbot (`https://friendbot.stellar.org`, XLM) and Circle's testnet faucet
(`https://faucet.circle.com`, USDC — supports Stellar testnet directly).

## Inbound (EVM → Stellar) tracking

Outbound Stellar → EVM sends are fully self-contained: quote, build, sign, submit, and track all
happen through this widget and `@ferryline/sdk` directly. Inbound EVM → Stellar CCTP transfers need
a Ferryline relayer (a separate service) to watch the source chain and complete delivery on
Stellar — the widget doesn't drive the source-chain wallet itself (that's whatever wallet the user
already used on the EVM side). Once you have a real EVM burn transaction hash, call:

```ts
await widget.registerInboundTransfer(transferId, "ethereum-sepolia", sourceTxHash);
```

This calls the configured relayer's real `POST /transfers` then polls `GET /transfers/:id`,
rendering live status inline.

## Theming

Every visual token is a CSS custom property with a sensible default, settable from outside the
shadow root (they inherit through it normally) or scoped with `:host` selectors if you're theming
multiple widgets differently on one page:

| Property                    | Default                 | Affects                                      |
| --------------------------- | ----------------------- | -------------------------------------------- |
| `--ferryline-font`          | `system-ui, sans-serif` | Base font family                             |
| `--ferryline-font-size`     | `14px`                  | Base font size                               |
| `--ferryline-fg`            | `#1a2531`               | Text color                                   |
| `--ferryline-bg`            | `#ffffff`               | Shell background                             |
| `--ferryline-border`        | `#d3dce2`               | Shell border color                           |
| `--ferryline-border-radius` | `8px`                   | Corner radius (shell, buttons)               |
| `--ferryline-spacing`       | `16px`                  | Shell inner padding                          |
| `--ferryline-muted`         | `#54667a`               | Secondary text (network label)               |
| `--ferryline-danger`        | `#c0392b`               | Error text                                   |
| `--ferryline-accent`        | `#2c6fbb`               | Buttons, links                               |
| `--ferryline-accent-fg`     | `#ffffff`               | Button text color                            |
| `--ferryline-z-index`       | `1000`                  | Stacking context below the mobile breakpoint |

```css
ferryline-widget {
  --ferryline-accent: #7c3aed;
  --ferryline-border-radius: 16px;
  --ferryline-font: "Inter", sans-serif;
}
```

Below 480px viewport width, the widget docks to the bottom of the viewport as a mobile bottom
sheet (rounded top corners only, scrollable if content exceeds 85% of viewport height). If you're
embedding the widget inside your own bottom-sheet container at that width, override `position` /
`inset` on the `ferryline-widget` element itself — the cascade allows it.

Shadow-DOM `part` attributes are also exposed for deeper styling via `::part()`: `shell`, `network`,
`status`, `quote`, `preview`, `preview-heading`, `preview-summary`, `decoded-call`, `wallet-connect`,
`wallet-module-button`, `build-button`, `confirm-button`, `cancel-button`, `reset-button`,
`source-tx`, `dest-tx`, `failure`, `faucets`, `faucet-link`, `wallet-error`, `inbound-status`,
`delivery-caveat`.

## Known gap: outbound CCTP delivery is not automatically relayed (STEP 3 finding, 2026-09-12)

For an outbound (Stellar → EVM) USDC transfer, the widget's tracking correctly advances to
"verified" once Circle's attestation completes — but delivery on the destination chain is **not
automatic**, on testnet or mainnet. Confirmed directly against Circle's own CCTP technical guide
(developers.circle.com/cctp/references/technical-guide): "An API consumer must query this
attestation and submits it onchain to the destination domain's MessageTransmitterV2#receiveMessage
function" — with no testnet/mainnet distinction anywhere in that document, and no mention of
Circle operating a relayer for this. Third-party aggregators (LI.FI, Squid) and Wormhole's own CCTP
integration each run their own separate relay service for exactly this reason.

The widget surfaces this honestly (see the `delivery-caveat` part above) rather than implying an
ETA-bound "just wait" status. `receiveMessage` is permissionless — the sender, the recipient, or
any integrator's own relayer can submit it, given a small amount of destination-chain gas. See
`e2e/submit-receive-message.mjs` for a real, working example of doing this manually, and
`technical-doc.md`'s threat-model table for the full, sourced writeup and severity assessment.
Building a dedicated outbound relayer (mirroring Ferryline's existing inbound one) is explicitly
out of scope for this package and is a real candidate for a future phase.

## Scope note (v0.x)

This package intentionally does NOT include a React wrapper, and testnet mode intentionally does
NOT offer USDT0 (see above for why the latter is structural, not a policy choice). Both are
explicit decisions for this phase, not oversights — see the repo's phase reports if you're deciding
whether to add either downstream.

## Testing

- `pnpm test` — component-level tests (real SDK types/shapes, a fake `RailAdapter`/`WalletSession`
  standing in for network calls; see `src/index.test.ts`'s own doc comment for why that boundary,
  not the SDK's adapter internals, is what this package's own tests should cover).
- `e2e/` — a real, manual, browser-extension-driven end-to-end run against Stellar testnet, using
  a real installed Freighter extension via Playwright + real Chrome. See `e2e/README.md` for how to
  reproduce it and the repo's phase report for the real transaction hashes it has produced.
