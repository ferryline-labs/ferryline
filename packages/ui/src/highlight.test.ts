import { describe, expect, it } from "vitest";

import { highlightCode } from "./highlight.js";

describe("highlightCode", () => {
  it("flags bare-word keywords and leaves everything else untouched", () => {
    const segments = highlightCode('import { Ferryline } from "@ferryline/sdk";');

    expect(segments).toEqual([
      { text: "import", isKeyword: true },
      { text: " { Ferryline } ", isKeyword: false },
      { text: "from", isKeyword: true },
      { text: ' "@ferryline/sdk";', isKeyword: false },
    ]);
  });

  it("does not match a keyword that is only a substring of a larger identifier", () => {
    // "of" must not match inside "profile", "constant" must not trip the "const" keyword, etc.
    const segments = highlightCode("const profile = constant;");

    expect(segments.filter((s) => s.isKeyword)).toEqual([{ text: "const", isKeyword: true }]);
  });

  it("joins segments back to the original string losslessly", () => {
    const code =
      "for await (const status of ferryline.track(tx.transferId)) {\n  render(status.stage);\n}";
    const segments = highlightCode(code);

    expect(segments.map((s) => s.text).join("")).toBe(code);
  });

  it("returns a single non-keyword segment when there is nothing to highlight", () => {
    expect(highlightCode("wallet.signAndSubmit(tx.xdr);")).toEqual([
      { text: "wallet.signAndSubmit(tx.xdr);", isKeyword: false },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(highlightCode("")).toEqual([]);
  });
});
