"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import type { FerrylineWidget } from "@ferryline/widget";
import { defineFerrylineWidget } from "@ferryline/widget";
import { Badge, Card } from "@ferryline/ui";

import { installInspectorCapture } from "@/lib/inspector-capture";

/**
 * Read once, at module load — same real client-exposure mechanism apps/site/apps/docs never
 * needed before (neither has any env var at all): Next.js only inlines an env var into
 * client-side code when it's prefixed `NEXT_PUBLIC_`, a hard framework requirement, not a style
 * choice. Named with this project's own established `FERRYLINE_*` prefix (see
 * packages/relayer/.env.example's real env vars) rather than inventing a new naming convention.
 *
 * Both can be genuinely unset: there is no real, publicly-deployed Ferryline relayer instance
 * anywhere in this project (every relayer URL in the docs is a `your-relayer.example.com`
 * placeholder or a local docker-composed instance) — self-hosting one is real infrastructure work
 * outside what a Next.js app can do on its own. See this file's own README note for what must be
 * set before a real launch, and why the key specifically must be a dedicated, low-privilege,
 * revocable one, never a production integrator's key (packages/relayer/src/http/auth.ts's
 * ApiKeyStore supports per-key revocation for exactly this).
 */
const RELAYER_URL = process.env["NEXT_PUBLIC_FERRYLINE_RELAYER_URL"];
const RELAYER_API_KEY = process.env["NEXT_PUBLIC_FERRYLINE_RELAYER_API_KEY"];

/**
 * Outbound (Stellar -> Ethereum Sepolia), not inbound: the direction that actually exercises the
 * mechanisms this playground exists to demonstrate — the two-step approve/burn sequence (and its
 * real POST_APPROVE_BUILD_DELAY_MS mitigation, surfaced live by RetryDelayNote), and
 * registerOutboundTransfer's real relayer registration path. `maxFee`/`minFinalityThreshold` are
 * the two real, independently-confirmed-working values from this project's own Security &
 * Verification page (apps/docs/content/docs/security.mdx) — CCTP requires both on every request
 * with no default (see core-concepts.mdx's own "why no default" section), not values invented for
 * this form.
 */
const DEFAULT_AMOUNT = "1.00";
const RAIL_PARAMETERS = { maxFee: "0", minFinalityThreshold: 2000 } as const;

export function WidgetEmbed(): ReactElement {
  const widgetRef = useRef<FerrylineWidget>(null);
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);

  useEffect(() => {
    installInspectorCapture();
    defineFerrylineWidget();
    // Set via setAttribute, not JSX props on <ferryline-widget> itself — reproduced directly:
    // React 19 tries to assign some custom-element JSX props as JS *properties* rather than HTML
    // attributes (its own heuristic, not something this app controls), and FerrylineWidget.network
    // is a getter-ONLY accessor (packages/widget/src/index.ts) — assigning to it as a property
    // throws `Cannot set property network of [object Object] which has only a getter`, a real
    // crash caught by this component's own tests, not a hypothetical. setAttribute always writes
    // a real HTML attribute regardless of what the class also happens to expose as a property,
    // matching exactly what the widget's own attributeChangedCallback/getAttribute calls expect.
    const widget = widgetRef.current;
    if (!widget) return;
    widget.setAttribute("network", "testnet");
    if (RELAYER_URL) widget.setAttribute("relayer-url", RELAYER_URL);
    if (RELAYER_API_KEY) widget.setAttribute("relayer-api-key", RELAYER_API_KEY);
  }, []);

  const startTransfer = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const widget = widgetRef.current;
    if (!widget) return;
    widget.request = {
      asset: "USDC",
      from: { chain: "stellar", address: sender },
      to: { chain: "ethereum-sepolia", address: recipient },
      amount,
      parameters: RAIL_PARAMETERS,
    };
  };

  return (
    // overflow-y-auto: same fix as InspectorPanel's own Card (see that file's comment) — Card's
    // h-full is wrapped in StarBorder's overflow-hidden (needed there to clip the glow to the
    // card's rounded corners), so content taller than the card — the full review table, the
    // wallet-selector list — was being silently clipped there, before the page-level wrapper's own
    // scroll area ever saw it. Confirmed live: "Fee"/"Confirm and sign" were unreachable by
    // scrolling the outer wrapper alone; this is the actual boundary that needs to scroll.
    <Card className="overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <p className="text-text-4 uppercase text-on-surface-weak">Start a transfer</p>
        <Badge>USDC via CCTP</Badge>
      </div>

      {/* USDT0 is structurally excluded here, not just left off a menu — see core-concepts.mdx's
          own real language, quoted directly rather than paraphrased loosely. Usdt0LayerZeroAdapter
          throws ROUTE_UNSUPPORTED for anything but "mainnet" (its options type is literally
          `{ network: "mainnet" }`, a compile-time constraint, not a runtime check this playground
          works around) — there is no code path in which a testnet instance of this widget could
          even hold a USDT0 adapter to route to. */}
      <p className="mt-3 text-text-4 text-on-surface-weak">
        USDT0 isn&apos;t offered here: it has no Stellar testnet deployment to test against, so the
        adapter refuses to pretend otherwise. Every real USDT0 transfer is mainnet activity — see{" "}
        <a
          href="https://ferryline-docs.vercel.app/core-concepts#the-two-rails"
          className="underline"
        >
          Core Concepts
        </a>
        .
      </p>

      <form onSubmit={startTransfer} className="mt-6 space-y-4">
        <label className="block text-text-3">
          <span className="mb-1 block text-on-surface-weak">Sender (Stellar address)</span>
          <input
            required
            value={sender}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setSender(event.target.value);
            }}
            placeholder="G..."
            className="w-full rounded border border-on-surface-weaker bg-white px-3 py-2 font-mono text-text-4"
          />
        </label>
        <label className="block text-text-3">
          <span className="mb-1 block text-on-surface-weak">
            Recipient (Ethereum Sepolia address)
          </span>
          <input
            required
            value={recipient}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setRecipient(event.target.value);
            }}
            placeholder="0x..."
            className="w-full rounded border border-on-surface-weaker bg-white px-3 py-2 font-mono text-text-4"
          />
        </label>
        <label className="block text-text-3">
          <span className="mb-1 block text-on-surface-weak">Amount (USDC)</span>
          <input
            required
            value={amount}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setAmount(event.target.value);
            }}
            inputMode="decimal"
            className="w-full rounded border border-on-surface-weaker bg-white px-3 py-2 font-mono text-text-4"
          />
        </label>
        <button
          type="submit"
          className="inline-block rounded-lg bg-brand px-5 py-3 text-text-3 font-medium text-on-brand"
        >
          Get a quote
        </button>
      </form>

      {/* Same honest-caveat voice as the widget's own outboundDeliveryCaveat (packages/widget/
          src/index.ts): state the real consequence plainly, and say directly that it isn't a
          sign of an error — not silence, and not alarm either. */}
      {!RELAYER_URL || !RELAYER_API_KEY ? (
        <p className="mt-4 text-text-4 text-on-surface-weak">
          Automatic relay registration is not configured in this environment. The widget still works
          fully for quoting, building, and signing — delivery on the destination chain just will not
          be automatic, the same as running the widget with no relayer-url at all. This is expected
          here, not a sign of anything broken.
        </p>
      ) : null}

      <div className="mt-6">
        <ferryline-widget ref={widgetRef} />
      </div>
    </Card>
  );
}
