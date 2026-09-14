import { describe, expect, it } from "vitest";

import { baseOptions } from "./layout.shared";

describe("baseOptions", () => {
  it("names the site and links out to the real GitHub repo", () => {
    const options = baseOptions();
    expect(options.nav?.title).toBe("Ferryline");
    expect(options.links).toContainEqual(
      expect.objectContaining({
        url: "https://github.com/ferryline-labs/ferryline",
        external: true,
      }),
    );
  });
});
