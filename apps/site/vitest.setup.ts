import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts runs with `globals: false` (explicit imports everywhere, matching the rest of
// the repo's test files) — Testing Library's own auto-cleanup only registers itself against a
// *global* afterEach, so without this it never runs and DOM nodes leak between tests in the same
// file.
afterEach(() => {
  cleanup();
});
