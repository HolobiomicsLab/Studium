import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { revealsAnswer } from "./reveal.js";

const fixturePath = fileURLToPath(new URL("../../../../eval/validity/bea_tutor/fixtures/reveal_parity.json", import.meta.url));

describe("reveal rule — cross-language parity with the Python eval", () => {
  const cases: { text: string; banned: string[]; revealed: boolean }[] = JSON.parse(readFileSync(fixturePath, "utf8"));
  for (const c of cases) {
    it(`agrees on: ${c.text.slice(0, 30)}…`, () => {
      expect(revealsAnswer(c.text, c.banned)).toBe(c.revealed);
    });
  }
});
