/**
 * Real E2E host script: defines the real `<ferryline-widget>` element and wires the SAME
 * `TransferRequest` shape the rest of this repo uses for a real testnet CCTP outbound send
 * (Stellar -> Base Sepolia), then sets it on the element so the real quote/build/preview flow
 * runs against real testnet infrastructure. No mocks, no test doubles — the only thing this file
 * adds beyond what a real integrator's page would do is exposing a couple of read hooks
 * (`window.__ferrylineTestHooks`) so the Playwright script can read rendered state without
 * fragile text-scraping across every assertion.
 */
import { defineFerrylineWidget, type FerrylineWidget } from "../src/index.js";
import type { TransferRequest } from "@ferryline/sdk";

defineFerrylineWidget();

// SENDER is informational only below (the widget takes the real address from whichever wallet you
// connect in the browser) — set it to whatever real testnet account you'll actually sign with.
const SENDER = "GBBA3HN2PNOAJGR6R5VY34SQFDFTZFQIGDPYATJB34UXXFUHVR4KZRAZ";
// Same destination chain/amount/parameters shape prior real runs used
// (experiments/widget-seam-outbound-cctp.ts). Recipient set to the STEP 6 relayer run's own real,
// funded Sepolia sponsor address so this run's mint is independently checkable against that
// address's real balance.
const RECIPIENT_EVM = "0x11598bA8E624b7df301FC3d2C71165A076b7480e";

const widget = document.querySelector<FerrylineWidget>("#widget")!;

const request: TransferRequest = {
  asset: "USDC",
  from: { chain: "stellar", address: SENDER },
  to: { chain: "ethereum-sepolia", address: RECIPIENT_EVM },
  amount: "0.5",
  parameters: { maxFee: "0", minFinalityThreshold: 2000 },
};

declare global {
  interface Window {
    __ferrylineTestHooks?: {
      setRequest(): void;
    };
  }
}

window.__ferrylineTestHooks = {
  setRequest(): void {
    widget.request = request;
  },
};
