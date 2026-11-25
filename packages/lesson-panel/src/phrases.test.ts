// phrases.test.ts — BN-3: the texts a learner reads while no lesson of their own exists yet (the course picker of the
// VS Code pane and of the MCP Apps panel, the empty Lessons view) say what is true: a lesson the assistant writes
// appears there when it is ready, in a few minutes; the demo can be tried meanwhile. They no longer send the learner to
// « choose another folder », which is not where a lesson built by an assistant lands.
import { describe, expect, it } from "vitest";
import { browserPhrases } from "./phrases.js";

const few = { en: /a few minutes/, fr: /quelques minutes/ } as const;
const assistant = { en: /assistant/, fr: /assistant/ } as const;
const folder = { en: /folder/i, fr: /dossier/i } as const;

describe("texts shown before the learner has a lesson of their own", () => {
  for (const locale of ["en", "fr"] as const) {
    const words = browserPhrases(locale);
    it(`${locale}: the picker's empty text says the assistant's lesson appears in a few minutes, with no folder advice`, () => {
      expect(words.picker_empty).toMatch(assistant[locale]);
      expect(words.picker_empty).toMatch(few[locale]);
      expect(words.picker_empty).not.toMatch(folder[locale]);
    });
    it(`${locale}: the VS Code picker with the demo shipped also suggests trying the demo meanwhile`, () => {
      expect(words.picker_empty_demo).toMatch(assistant[locale]);
      expect(words.picker_empty_demo).toMatch(few[locale]);
      expect(words.picker_empty_demo).toMatch(locale === "en" ? /demo/ : /démo/);
      // The QuickPick placeholder is a single line: a long sentence is cut off.
      expect(words.picker_empty_demo.length).toBeLessThanOrEqual(100);
      expect(words.picker_empty_demo).not.toMatch(folder[locale]);
    });
    it(`${locale}: the empty courses entry of the Lessons view names the assistant, and the library group has a label`, () => {
      expect(words.tree_no_courses).toMatch(assistant[locale]);
      expect(words.tree_library.length).toBeGreaterThan(0);
    });
  }
  it("each text differs between the two languages", () => {
    const en = browserPhrases("en");
    const fr = browserPhrases("fr");
    for (const key of ["picker_empty", "picker_empty_demo", "tree_no_courses", "tree_library"] as const) expect(fr[key]).not.toBe(en[key]);
  });
});
