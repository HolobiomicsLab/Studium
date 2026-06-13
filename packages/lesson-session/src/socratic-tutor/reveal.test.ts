// reveal.test.ts
import { describe, it, expect } from "vitest";
import { tokenize, jaccard, revealsAnswer } from "./reveal.js";

describe("reveal guardrail primitives", () => {
  it("tokenize lowercases, splits on non-alphanumerics, drops <3-char + stopwords", () => {
    expect(tokenize("The Peroxisome breaks H2O2!")).toEqual(new Set(["peroxisome", "breaks", "h2o2"]));
    expect(tokenize(null)).toEqual(new Set());
  });
  it("jaccard is intersection over union, 0 for two empties", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
  it("revealsAnswer flags a verbatim answer substring", () => {
    expect(revealsAnswer("En fait, la réponse est le peroxysome.", ["le peroxysome"])).toBe(true);
  });
  it("revealsAnswer flags high token overlap even without a substring", () => {
    expect(revealsAnswer("peroxysome catalase oxydation", ["oxydation catalase peroxysome"])).toBe(true);
  });
  it("revealsAnswer passes a faded, non-revealing prompt", () => {
    expect(revealsAnswer("Qu'observerais-tu si c'était vrai ?", ["le peroxysome catalase"])).toBe(false);
  });
});
