import { describe, expect, it } from "vitest";

import { baseOptions } from "./layout.shared";

describe("baseOptions", () => {
  it("names the site and links out to the real GitHub repo", () => {
    const options = baseOptions();
    expect(options.nav?.title).toBe("Ferryline");
    expect(options.githubUrl).toBe("https://github.com/ferryline-labs/ferryline");
  });

  it("links out to the real Site and Playground deployments", () => {
    const options = baseOptions();
    expect(options.links).toEqual([
      { text: "Site", url: "https://ferryline-site.vercel.app/", external: true },
      { text: "Playground", url: "https://playground-tau-beige.vercel.app/", external: true },
    ]);
  });

  it("enables the real light/dark/system theme switcher, not the light/dark-only default", () => {
    const options = baseOptions();
    expect(options.themeSwitch?.mode).toBe("light-dark-system");
  });
});
