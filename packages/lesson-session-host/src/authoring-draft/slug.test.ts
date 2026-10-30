import { describe, expect, it } from "vitest";
import { asciiSlug } from "./slug.js";

describe("asciiSlug", () => {
  it("drops accents and turns every other run of non-alphanumerics into one dash", () => {
    expect(asciiSlug("Deux formes de solidarité", 40, "x")).toBe("deux-formes-de-solidarite");
    // Œ has no decomposition and ’ is not ASCII: both go, as in the Python (which gives the same slug).
    expect(asciiSlug("  L’Œuvre — d'É. Durkheim (1893) !", 64, "x")).toBe("luvre-d-e-durkheim-1893");
  });

  it("cuts to maxChars without leaving a dash at the end", () => {
    expect(asciiSlug("abc def ghi", 8, "x")).toBe("abc-def");
    expect(asciiSlug("abc def ghi", 7, "x")).toBe("abc-def");
    expect(asciiSlug("a".repeat(70), 64, "x")).toHaveLength(64);
  });

  it("returns the fallback when no ASCII letter or digit is left", () => {
    expect(asciiSlug("社会分工論", 40, "source")).toBe("source");
    expect(asciiSlug(" — ", 64, "lesson")).toBe("lesson");
  });
});
