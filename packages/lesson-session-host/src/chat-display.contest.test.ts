// INT-STUDIUM-058 lot 4 (walkthrough 2026-11-07): contesting a concept from the conversation. The line
// that opens the reply says which concept is checked, how many questions, and that the claim moves
// nothing; the concept map's list names each concept's id, so that the learner's assistant can relay
// the claim with it.
import { describe, it, expect } from "vitest";
import { contestOpenedMarkdown } from "./chat-display.js";
import { buildConceptMap } from "./concept-map.js";

describe("contesting a concept in the conversation", () => {
  it("opens with one line: the concept checked, the number of questions, and that the claim moves nothing", () => {
    expect(contestOpenedMarkdown("Nombres quantiques", 2, "fr")).toBe(
      "Contrôle sur «\u00a0Nombres quantiques\u00a0»\u00a0: 2 questions. Ta déclaration ne change rien à ta maîtrise\u202f; la leçon reprend ensuite où tu étais.",
    );
    expect(contestOpenedMarkdown("Nombres quantiques", 1, "fr")).toContain("\u00a0: 1 question. ");
    expect(contestOpenedMarkdown("Quantum numbers", 2, "en")).toBe(
      "Check on “Quantum numbers”: 2 questions. Your claim changes nothing; the lesson then resumes where you were.",
    );
    expect(contestOpenedMarkdown("Quantum numbers", 1, "en")).toContain(": 1 question. ");
  });

  it("names each concept's id after its title in the map's list, in both languages", () => {
    const concepts = [{ id: "c-a", title: "Alpha" }, { id: "c-b", title: "Beta" }];
    const scenes = [{ id: "s-a", concept_refs: ["c-a"] }, { id: "s-b", concept_refs: ["c-b"] }];
    const at = (locale: "fr" | "en") => buildConceptMap({
      concepts, scenes, path: { steps: [], passed_prerequisites: [] }, currentSceneId: "s-a", moment: "start", locale,
    });
    const fr = at("fr");
    expect(fr.display_markdown).toContain("- **Alpha (`c-a`) : en cours**");
    expect(fr.display_markdown).toContain("- Beta (`c-b`) : à venir");
    const en = at("en");
    expect(en.display_markdown).toContain("- Beta (`c-b`): upcoming");
  });
});
