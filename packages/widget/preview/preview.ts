/**
 * Visual-preview-only host script — same real widget, same `defineFerrylineWidget`/`.request`
 * wiring as ../e2e/harness.ts, but this page's only job is to look right in a browser, not to
 * drive Playwright. `window.__ferrylineTestHooks.setRequest()` is still exposed from the console
 * if you want to see the quoted/preview phases without leaving this page.
 */
import { defineFerrylineWidget, type FerrylineWidget } from "../src/index.js";
import type { TransferRequest } from "@ferryline/sdk";

defineFerrylineWidget();

const SENDER = "GBBA3HN2PNOAJGR6R5VY34SQFDFTZFQIGDPYATJB34UXXFUHVR4KZRAZ";
const RECIPIENT_EVM = "0x78253429b7483FBcCEf90e943526BB990a4D5b50";

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
