import type { TransferStage } from "@ferryline/sdk";

export const WIDGET_TAG = "ferryline-widget";

/** Human copy for each transfer stage. Kept here so the SDK stays UI-free. */
export const STAGE_LABELS: Readonly<Record<TransferStage, string>> = {
  created: "Ready to sign",
  submitted: "Submitted, waiting for verification",
  verified: "Verified, delivering",
  delivered: "Delivered",
  failed: "Failed",
};

/**
 * Placeholder element. Renders a shell only; wiring to the SDK, wallet kit, quotes and
 * step status lands after the rail adapters exist.
 */
export class FerrylineWidget extends HTMLElement {
  static readonly observedAttributes = ["network"] as const;

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(): void {
    this.render();
  }

  get network(): string {
    return this.getAttribute("network") ?? "testnet";
  }

  private render(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display: block; font: 14px system-ui, sans-serif; }
        .shell { border: 1px solid #d3dce2; border-radius: 8px; padding: 16px; }
        .net { font-size: 12px; color: #54667a; text-transform: uppercase; letter-spacing: 0.08em; }
      </style>
      <div class="shell" part="shell">
        <div class="net" part="network">${this.network}</div>
        <p part="status">Ferryline widget: not wired to a rail yet.</p>
      </div>`;
  }
}

/** Register the element once. Safe to call more than once. */
export function defineFerrylineWidget(tagName: string = WIDGET_TAG): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, FerrylineWidget);
  }
}
