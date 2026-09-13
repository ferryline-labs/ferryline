import { defineConfig } from "vite";

/**
 * A purely visual preview host — NOT the real E2E test harness (see ../e2e/, which is untouched).
 * This exists only so the widget can be eyeballed at a realistic embed width instead of stretched
 * full-viewport with no surrounding page chrome. No Playwright, no real network calls triggered on
 * load, no wallet flow — just the widget rendered inside a normal-sized container, the way a real
 * host page would actually place it.
 */
export default defineConfig({
  root: import.meta.dirname,
  server: {
    port: 4174,
    strictPort: true,
  },
});
