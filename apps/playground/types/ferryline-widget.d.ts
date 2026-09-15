import type { DetailedHTMLProps, HTMLAttributes } from "react";

/**
 * `<ferryline-widget>` is a real custom element (packages/widget/src/index.ts's `FerrylineWidget
 * extends HTMLElement`), not a React component — TypeScript's JSX namespace has no built-in
 * knowledge of it, so using it as a lowercase JSX tag needs this ambient augmentation. Attributes
 * here are exactly the widget's own real, observed ones (`FerrylineWidget.observedAttributes`):
 * `network`, `rpc-url`, `relayer-url`, `relayer-api-key`. The `request`/`availableRails`
 * properties are set imperatively via a ref (see widget-embed.tsx), not as JSX props — the widget's
 * own doc comment is explicit that a full TransferRequest doesn't serialize to a single attribute.
 */
// React 19 moved the JSX namespace from the bare global `JSX` to `React.JSX` (confirmed directly
// in the installed @types/react: `declare namespace React { ... namespace JSX {
// interface IntrinsicElements ... } }`) — augmenting the old bare-global `JSX` namespace (React
// 18's own location) silently does nothing here; this augments the real, current one.
declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        "ferryline-widget": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
          network?: "testnet" | "mainnet";
          "rpc-url"?: string;
          "relayer-url"?: string;
          "relayer-api-key"?: string;
        };
      }
    }
  }
}

export {};
