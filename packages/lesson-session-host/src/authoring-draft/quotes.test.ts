import { describe, expect, it } from "vitest";
import { checkQuote, normalizeQuoteText, sourceSpan, MIN_QUOTE_CHARS } from "./quotes.js";
import { chunkText } from "./passages.js";
import { FRENCH_SOURCE, P1, P2, P3 } from "./test-fixtures.js";

const texts = chunkText(FRENCH_SOURCE.text).passages;
const passages = [P1, P2, P3].map((id, index) => ({ id, source_id: "deux-formes-de-solidarite", text: texts[index]! }));

describe("normalizeQuoteText", () => {
  it("folds no-break spaces, whitespace runs and typographic apostrophes, nothing else", () => {
    expect(normalizeQuoteText("  l’état : ici\n\n là  ")).toBe("l'état : ici là");
    expect(normalizeQuoteText("« Écrit » … ÉTAT")).toBe("« Écrit » … ÉTAT");
  });
});

describe("checkQuote", () => {
  it("accepts a character-for-character substring of the passage", () => {
    expect(checkQuote(P2, "chacun dépend des autres parce qu’il ne fait pas ce qu’ils font", passages)).toEqual({ ok: true });
  });

  it("accepts straight apostrophes and the source's no-break spaces", () => {
    expect(checkQuote(P1, "comme les molécules d'un corps inerte", passages)).toEqual({ ok: true });
    expect(checkQuote(P1, "cette solidarité : elle tient les individus", passages)).toEqual({ ok: true });
  });

  it("refuses a paraphrase and says where the passage diverges", () => {
    const result = checkQuote(P1, "la cohésion vient du partage des mêmes croyances", passages);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(`the quote is not in passage ${P1}`);
    expect(result.hint).toBe(
      `copy the words of ${P1} exactly: the quote matches it up to “la cohésion vient d”, where the passage reads ` +
      "“la cohésion vient de ce que tous partagent les mêmes croyances…”",
    );
  });

  it("points to the passage that holds the quote when another one was named", () => {
    const result = checkQuote(P1, "le droit devient restitutif", passages);
    expect(result).toMatchObject({ ok: false, hint: `the quote is in ${P3}: cite that passage_id` });
  });

  it("names the closest passage for an unknown passage id", () => {
    const result = checkQuote("p:deux-formes-de-solidarite:9", "le droit est surtout répressif", passages);
    expect(result).toMatchObject({
      ok: false, message: "unknown passage_id p:deux-formes-de-solidarite:9",
      hint: `the quote is in ${P3}: cite that passage_id`,
    });
  });

  it("refuses a quote too short to ground anything, or longer than an evidence excerpt", () => {
    expect(checkQuote(P1, "la cohésion", passages)).toMatchObject({ ok: false, message: `a quote needs at least ${MIN_QUOTE_CHARS} characters` });
    expect(checkQuote(P1, "x".repeat(501), passages)).toMatchObject({ ok: false, message: "a quote has at most 500 characters" });
  });
});

describe("sourceSpan", () => {
  it("returns the passage's own characters for a quote that matched after folding", () => {
    expect(sourceSpan("les molécules d'un corps inerte", passages[0]!.text)).toBe("les molécules d’un corps inerte");
    expect(sourceSpan("# Deux formes de solidarité Dans une société", passages[0]!.text)).toBe("# Deux formes de solidarité\n\nDans une société");
  });

  it("falls back to the folded quote when the passage does not hold it", () => {
    expect(sourceSpan("  absent\u00a0du  passage ", passages[0]!.text)).toBe("absent du passage");
  });
});
