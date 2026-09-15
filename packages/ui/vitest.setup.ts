import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Same reason as apps/site's own vitest.setup.ts: this config runs with `globals: false`, and
// Testing Library's auto-cleanup only registers against a *global* afterEach, so without this DOM
// nodes leak between tests in the same file.
afterEach(() => {
  cleanup();
});
