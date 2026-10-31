import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authoringGuide, GUIDE_VERSION } from "./guide.js";
import { createLesson } from "./build.js";
import { LessonDraftSchema } from "./draft-schema.js";
import { prepareSources } from "./source-set.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("authoringGuide", () => {
  it("answers in French for a French tag and in English otherwise", () => {
    const fr = authoringGuide({ language: "fr-FR" });
    const en = authoringGuide({ language: "de" });
    expect([fr.language, en.language]).toEqual(["fr", "en"]);
    expect(fr.version).toBe(GUIDE_VERSION);
    expect(fr.markdown).not.toBe(en.markdown);
    expect(authoringGuide({}).language).toBe("en");
  });

  it.each(["fr", "en"] as const)("states the authoring rules of the plan (%s)", (language) => {
    const { markdown } = authoringGuide({ language });
    const rules = language === "fr"
      ? ["au caractère près", "2 à 4", "scènes de production", "un ou deux quiz", "flaws_expected", "TODO",
        "meta_checkpoint", "learner_profile", "jamais une clé"]
      : ["character for character", "2 to 4", "production scenes", "one or two quiz", "flaws_expected", "TODO",
        "meta_checkpoint", "learner_profile", "never a key"];
    for (const rule of rules) expect(markdown).toContain(rule);
  });

  it.each(["fr", "en"] as const)("asks for the first question by the second screen, and its example does so (%s)", (language) => {
    // R1: « learn X » reaches a first question in at most 6 Studium calls — get_study_plan,
    // get_authoring_guide, prepare_sources, create_lesson, start_lesson_session, and one
    // acknowledgement — so a lesson may open with one reading screen at most.
    const { markdown, example } = authoringGuide({ language });
    expect(markdown).toContain(language === "fr" ? "au plus une scène de lecture" : "at most one reading scene");
    const firstQuestion = example.draft.scenes.findIndex((scene) => scene.type !== "intro" && scene.type !== "concept");
    expect(firstQuestion).toBeGreaterThanOrEqual(0);
    expect(firstQuestion).toBeLessThanOrEqual(1);
  });

  it.each(["fr", "en"] as const)("asks to flag the opening diagnostic and lets its meta_checkpoint replace the intro (%s)", (language) => {
    const { markdown } = authoringGuide({ language });
    expect(markdown).toContain("`diagnostic: true`");
    expect(markdown).toContain(language === "fr" ? "peut remplacer l'intro" : "can replace the intro");
  });

  it.each(["fr", "en"] as const)("asks for a quiz on each prerequisite concept when no judge is configured (%s)", (language) => {
    const { markdown } = authoringGuide({ language });
    expect(markdown).toMatch(language === "fr"
      ? /[Ss]ans juge modèle, chaque concept prérequis a au moins un quiz/
      : /[Ww]ithout a judge model, every prerequisite concept has at least one quiz/);
  });

  it.each(["fr", "en"] as const)("caps quizzes only beyond the one each prerequisite needs, so the two rules agree (%s)", (language) => {
    // A lesson with three prerequisite concepts needs three quizzes without a judge: the cap of
    // « one or two » must count only the quizzes beyond those, or the two rules cannot both hold.
    const { markdown } = authoringGuide({ language });
    expect(markdown).toMatch(language === "fr"
      ? /[Ee]n plus du quiz que demande chaque concept prérequis sans juge[^\n]*ajoutez au plus un ou deux quiz ou spot_the_flaw/
      : /[Bb]esides the quiz each prerequisite concept needs without a judge[^\n]*add at most one or two quiz or spot_the_flaw scenes/);
  });

  it.each(["fr", "en"] as const)("asks for « tu » in a French lesson (%s)", (language) => {
    const { markdown } = authoringGuide({ language });
    expect(markdown).toContain(language === "fr" ? "tutoyez l'apprenant (« tu »)" : "address the learner as « tu »");
  });

  it("writes its French example to the learner with « tu »", () => {
    const { example } = authoringGuide({ language: "fr" });
    expect(JSON.stringify(example.draft)).not.toMatch(/\b(vous|votre|vos|Relisez|Racontez)\b/i);
  });

  it("says in teacher mode that this route writes self-study lessons and names the teacher route", () => {
    expect(authoringGuide({ language: "en", mode: "teacher" }).markdown).toMatch(/self-study lessons only[\s\S]*experience_packet\.py approve/);
    expect(authoringGuide({ language: "fr", mode: "teacher" }).markdown).toMatch(/uniquement des leçons d'auto-apprentissage[\s\S]*experience_packet\.py approve/);
    expect(authoringGuide({ language: "en" }).markdown).not.toMatch(/experience_packet\.py approve/);
  });

  it.each(["fr", "en"] as const)("ships an example draft that builds into a lesson with no ERROR (%s)", async (language) => {
    const { example } = authoringGuide({ language });
    expect(LessonDraftSchema.safeParse(example.draft).success).toBe(true);
    const root = mkdtempSync(join(tmpdir(), "authoring-guide-"));
    roots.push(root);
    const set = await prepareSources(root, [example.source], { goal: example.draft.goal });
    const result = await createLesson(root, { source_set_id: set.source_set_id, draft: example.draft });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.findings.filter((item) => item.level === "ERROR")).toEqual([]);
    expect(result.bundle.metadata.language.slice(0, 2)).toBe(language);
  });
});
