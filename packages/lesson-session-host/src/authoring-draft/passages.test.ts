// Goldens computed by tools/self_study_passages.py `chunk_text` (Python, the reference) on the
// same inputs: the TypeScript port must cut every text exactly as the Python route does.
import { describe, expect, it } from "vitest";
import { chunkText, DEFAULT_MAX_CHARS, DEFAULT_MIN_CHARS } from "./passages.js";

const PYTHON_GOLDENS: Array<{ name: string; text: string; min: number; max: number; passages: string[]; dropped_short: number }> = [
  {
    name: "a heading joins its section and a short note joins the passage before it",
    text: "# Deux formes de solidarité\n\nDans une société où chacun ressemble à son voisin, la cohésion vient de ce que tous partagent les mêmes croyances et les mêmes sentiments. On peut appeler mécanique cette solidarité : elle tient les individus comme les molécules d’un corps inerte, sans qu’ils aient besoin de se distinguer.\n\nÀ mesure que le travail se divise, les fonctions se spécialisent et les individus deviennent différents les uns des autres. La cohésion change alors de nature : chacun dépend des autres parce qu’il ne fait pas ce qu’ils font. Cette solidarité, que l’on dira organique, ressemble à celle des organes d’un être vivant.\n\nNote : texte d’exemple.",
    min: 200, max: 1200,
    passages: ["# Deux formes de solidarité\n\nDans une société où chacun ressemble à son voisin, la cohésion vient de ce que tous partagent les mêmes croyances et les mêmes sentiments. On peut appeler mécanique cette solidarité : elle tient les individus comme les molécules d’un corps inerte, sans qu’ils aient besoin de se distinguer.", "À mesure que le travail se divise, les fonctions se spécialisent et les individus deviennent différents les uns des autres. La cohésion change alors de nature : chacun dépend des autres parce qu’il ne fait pas ce qu’ils font. Cette solidarité, que l’on dira organique, ressemble à celle des organes d’un être vivant.\n\nNote : texte d’exemple."],
    dropped_short: 0,
  },
  {
    name: "a long paragraph is cut at sentence ends, never after an abbreviation or an initial",
    text: "Selon M. Dupont, la division du travail précède la société. É. Durkheim soutient l'inverse, cf. p. 12 de l'édition citée. Il ajoute que le droit répressif mesure la solidarité mécanique! Le droit restitutif, lui, mesure la solidarité organique? Enfin… la question reste ouverte.",
    min: 40, max: 120,
    passages: ["Selon M. Dupont, la division du travail précède la société.", "É. Durkheim soutient l'inverse, cf. p. 12 de l'édition citée.", "Il ajoute que le droit répressif mesure la solidarité mécanique!", "Le droit restitutif, lui, mesure la solidarité organique? Enfin… la question reste ouverte."],
    dropped_short: 0,
  },
  {
    name: "short paragraphs that fit nowhere are dropped and counted",
    text: "Court.\n\nAussi court.\n\nUn paragraphe de longueur suffisante pour former un passage à lui seul, ou presque.\n\nFin.",
    min: 60, max: 80,
    passages: ["Un paragraphe de longueur suffisante pour former un passage à lui seul, ou"],
    dropped_short: 2,
  },
  {
    name: "line breaks inside a block are spaces; blank lines and form feeds end paragraphs",
    text: "Ligne une\r\ncontinue ici.\r\n\r\nSecond bloc : avec espace insécable.\fPage deux commence là avec un texte qui dépasse le minimum demandé.",
    min: 30, max: 200,
    passages: ["Ligne une continue ici.\n\nSecond bloc : avec espace insécable.", "Page deux commence là avec un texte qui dépasse le minimum demandé."],
    dropped_short: 0,
  },
  {
    name: "a word longer than max_chars is cut anywhere",
    text: "Unmotsansespacequiestbeaucouptroplongpourtenirdansunseulpassagedemaxcaracteresetquidoitdonccetrecoupe n'importe où.",
    min: 10, max: 40,
    passages: ["Unmotsansespacequiestbeaucouptroplongpou", "rtenirdansunseulpassagedemaxcaractereset", "quidoitdonccetrecoupe", "n'importe où."],
    dropped_short: 0,
  },
];

describe("chunkText (port of chunk_text in tools/self_study_passages.py)", () => {
  it.each(PYTHON_GOLDENS)("$name", ({ text, min, max, passages, dropped_short }) => {
    expect(chunkText(text, min, max)).toEqual({ passages, dropped_short });
  });

  it("uses the Python defaults: 200 to 1200 characters", () => {
    expect([DEFAULT_MIN_CHARS, DEFAULT_MAX_CHARS]).toEqual([200, 1200]);
  });

  it("normalizes to NFC, so a decomposed accent matches a composed one", () => {
    const decomposed = "Une société".normalize("NFD") + " " + "x".repeat(30);
    expect(chunkText(decomposed, 10, 100).passages).toEqual(["Une société " + "x".repeat(30)]);
  });

  it("refuses bounds Python refuses", () => {
    expect(() => chunkText("texte", 0, 10)).toThrow(RangeError);
    expect(() => chunkText("texte", 20, 10)).toThrow(RangeError);
  });
});
