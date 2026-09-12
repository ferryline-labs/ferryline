/**
 * Real, scripted portion of the widget's E2E run: launches a real Freighter extension in a real,
 * persistent Chrome profile (NOT Playwright's bundled Chromium — see the channel: "chrome" note
 * below), loads the real widget page served by e2e/vite.config.ts, drives the real quote/build
 * flow, opens the real preview, and clicks the Freighter connect button — which pops the real
 * extension's connection-approval window.
 *
 * This script stops there and hands off to a human for the actual approve/sign clicks inside that
 * real Freighter popup (see e2e/README.md's "What's actually scripted vs. manual" section for why:
 * scripting past a real wallet's password/approval UI has no stable, documented automation surface
 * and isn't worth building for this phase's lower ceremony bar). Re-run this any time you want to
 * get back to a fresh preview+connect-popup state without re-clicking through the UI by hand.
 *
 * Prerequisites (see e2e/README.md for full setup):
 *   - `npx vite --config e2e/vite.config.ts` running in another terminal, serving localhost:4173
 *   - a real Freighter extension unpacked at FREIGHTER_EXTENSION_PATH
 *   - that extension already set up (secret imported, unlocked) inside FREIGHTER_PROFILE_DIR via a
 *     real, manual Chrome session — see the README for why this step itself isn't scripted
 */
import { chromium } from "playwright";

const FREIGHTER_PROFILE_DIR = process.env.FREIGHTER_PROFILE_DIR ?? "/tmp/freighter-profile-explore";
const FREIGHTER_EXTENSION_PATH =
  process.env.FREIGHTER_EXTENSION_PATH ?? "/tmp/freighter-ext/unpacked";
const WIDGET_URL = process.env.WIDGET_URL ?? "http://localhost:4173/";

const context = await chromium.launchPersistentContext(FREIGHTER_PROFILE_DIR, {
  headless: false,
  channel: "chrome", // real installed Google Chrome, not Playwright's bundled Chromium — Freighter's
  // encrypted vault state (set up manually in real Chrome) isn't portable to the bundled binary
  // even with the same --user-data-dir, confirmed directly (grant-access showed onboarding, not
  // an unlock/connect prompt, against the bundled Chromium; this real-Chrome channel is the fix).
  args: [
    `--disable-extensions-except=${FREIGHTER_EXTENSION_PATH}`,
    `--load-extension=${FREIGHTER_EXTENSION_PATH}`,
  ],
});

await new Promise((resolve) => setTimeout(resolve, 1500));

const page = await context.newPage();
await page.goto(WIDGET_URL);
await page.waitForTimeout(1500);
await page.evaluate(() => window.__ferrylineTestHooks?.setRequest());

console.log("Waiting for a real quote...");
let quoted = false;
for (let i = 0; i < 15 && !quoted; i += 1) {
  await page.waitForTimeout(1000);
  const status = await page.evaluate(
    () =>
      document.querySelector("#widget")?.shadowRoot?.querySelector('[part="status"]')?.textContent,
  );
  if (status?.includes("Ready to sign")) {
    quoted = true;
  }
}
if (!quoted) {
  throw new Error(
    "no quote arrived within 15s — check the vite dev server and network connectivity",
  );
}
console.log("Quote received. Clicking build...");

await page.evaluate(() => {
  document.querySelector("#widget")?.shadowRoot?.querySelector('[part="build-button"]')?.click();
});
await page.waitForTimeout(3000);

const previewSummary = await page.evaluate(
  () =>
    document.querySelector("#widget")?.shadowRoot?.querySelector('[part="preview-summary"]')
      ?.textContent,
);
console.log("Real decoded preview:", previewSummary?.trim());

console.log("Clicking the Freighter connect button — a real extension popup should open now.");
context.on("page", async (popup) => {
  console.log("Real Freighter popup opened:", popup.url());
});
await page.evaluate(() => {
  document
    .querySelector("#widget")
    ?.shadowRoot?.querySelector('[data-wallet-module="freighter"]')
    ?.click();
});

console.log("");
console.log("=== Hand off to manual interaction now ===");
console.log("1. Approve the connection in the real Freighter popup.");
console.log('2. Back on the widget page, click "Confirm and sign".');
console.log("3. Approve the signature in Freighter.");
console.log("4. Wait for the widget to advance through any deferred steps and start tracking.");
console.log("This browser window stays open — close it yourself when done.");
