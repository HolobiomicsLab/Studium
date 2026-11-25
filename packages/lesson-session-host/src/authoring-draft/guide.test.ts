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

  // INT-STUDIUM-064, change 1: naming a local file spares the assistant copying its whole text.
  it.each(["fr", "en"] as const)("says to name a local file by path and to pass the text of what was fetched from the web (%s)", (language) => {
    const { markdown } = authoringGuide({ language });
    const step = markdown.split("\n").find((line) => line.startsWith("2. "))!;
    expect(step).toContain("`path`");
    expect(step).toContain("`text`");
    expect(step).toMatch(language === "fr" ? /fichier/ : /file/);
    expect(step).toMatch(language === "fr" ? /web/ : /web/);
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

  it.each(["fr", "en"] as const)("keeps retry feedback non-revealing and requires equation legends (%s)", (language) => {
    const { markdown } = authoringGuide({ language });
    expect(markdown).toContain("`feedback_incorrect`");
    expect(markdown).toMatch(language === "fr"
      ? /avant une éventuelle nouvelle tentative[^\n]*ne doit donc jamais donner la réponse/
      : /before a possible retry[^\n]*must never state the answer/);
    expect(markdown).toContain("`equation_latex`");
    expect(markdown).toContain("`legend: [{symbol, meaning}]`");
  });

  it.each(["fr", "en"] as const)("asks for « tu » in a French lesson (%s)", (language) => {
    const { markdown } = authoringGuide({ language });
    expect(markdown).toContain(language === "fr" ? "tutoyez l'apprenant (« tu »)" : "address the learner as « tu »");
  });

  // BN-2 (waiting review 2026-11-25): writing a lesson takes minutes and little shows meanwhile. The guide
  // gives one sentence, in its language, that the assistant relays before it prepares the sources. It
  // promises no number of minutes.
  it.each(["fr", "en"] as const)("gives one sentence telling the learner the lesson takes a few minutes to write, once (%s)", (language) => {
    const { tell_learner } = authoringGuide({ language });
    expect(tell_learner.length).toBeGreaterThan(0);
    expect(tell_learner.length).toBeLessThanOrEqual(300);
    expect(tell_learner).not.toMatch(/\d/);
    expect(tell_learner).toMatch(language === "fr" ? /quelques minutes/ : /a few minutes/);
    expect(tell_learner).toMatch(language === "fr" ? /une fois pour toutes/ : /once/);
    expect(tell_learner).toMatch(language === "fr" ? /autant de fois que/ : /as often as/);
    // Changed: teacher mode had the learner's sentence (« ta leçon », « tu »); a teacher trying the route on
    // their material gets a neutral wording of it instead (review of the wait-server branch, 2026-11-25).
    expect(authoringGuide({ language, mode: "teacher" }).tell_learner).not.toBe(tell_learner);
  });

  it.each(["fr", "en"] as const)("words the sentence neutrally in teacher mode: the lesson, never « tu » (%s)", (language) => {
    const { tell_learner } = authoringGuide({ language, mode: "teacher" });
    expect(tell_learner.length).toBeGreaterThan(0);
    expect(tell_learner.length).toBeLessThanOrEqual(300);
    expect(tell_learner).not.toMatch(/\d/);
    expect(tell_learner).toMatch(language === "fr" ? /quelques minutes/ : /a few minutes/);
    expect(tell_learner).toMatch(language === "fr" ? /une fois pour toutes/ : /once/);
    expect(tell_learner).toMatch(language === "fr" ? /autant de fois que/ : /as often as/);
    expect(tell_learner).toContain(language === "fr" ? "la leçon" : "the lesson");
    expect(tell_learner).not.toMatch(language === "fr" ? /\b(tu|ta|tes|ton|toi|te)\b/i : /\byour lesson\b/i);
  });

  it("speaks to a French learner with « tu » in the sentence to relay", () => {
    expect(authoringGuide({ language: "fr" }).tell_learner).not.toMatch(/\b(vous|votre|vos)\b/i);
    expect(authoringGuide({ language: "fr" }).tell_learner).toMatch(/\b(ta|tes|tu)\b/);
  });

  // A message that holds only text ends the turn in an agent client: the sentence goes with the
  // prepare_sources call, and the assistant does not wait for a reply.
  it.each(["fr", "en"] as const)("asks to relay tell_learner as it is with the prepare_sources call, without waiting (%s)", (language) => {
    const { markdown } = authoringGuide({ language });
    const step = markdown.split("\n").find((line) => line.startsWith("2. "))!;
    expect(step).toContain("`tell_learner`");
    expect(step).toMatch(language === "fr" ? /tel quel/ : /as it is/);
    expect(step).toMatch(language === "fr" ? /même message que votre appel à `prepare_sources`/ : /same message as your `prepare_sources` call/);
    expect(step).toMatch(language === "fr" ? /sans attendre/ : /without waiting/);
  });

  // D4 (waiting review 2026-11-25, owner's decision 3): Studium keeps a refused draft. The step that calls
  // create_lesson says to fix only what the errors name and resend only those scenes with draft_id, and the
  // whole draft only when the refusal asks for it (a refused resend of the whole draft cost 40 s in OpenCode).
  it.each(["fr", "en"] as const)("says to resend only the scenes a refusal names, with draft_id (%s)", (language) => {
    const { markdown } = authoringGuide({ language });
    const step = markdown.split("\n").find((line) => /^\d+\. /.test(line) && line.includes("draft_id"));
    expect(step).toBeDefined();
    expect(step).toContain("`create_lesson {source_set_id, draft_id, scenes: [{at, ...scene}]}`");
    expect(step).toMatch(language === "fr" ? /Studium garde le brouillon/ : /Studium keeps the draft/);
    expect(step).toMatch(language === "fr" ? /renvoyez seulement ces scènes/ : /resend only those scenes/);
    expect(step).toMatch(language === "fr" ? /sauf si le refus demande tout le brouillon/ : /unless the refusal asks for the whole draft/);
    expect(step).toMatch(language === "fr" ? /jamais en faisant dire à une citation/ : /never by making a quote say/);
  });


  // D3 (waiting review 2026-11-25, owner's decision 2): before writing, the assistant shows a short keyless
  // sketch and goes on without waiting; it writes the draft once, in the create_lesson call; a todo list,
  // if the host has one, is ticked with the next call; after create_lesson, only what differs from the
  // sketch is shown. Each check is anchored on its step line: words such as « never a key » are elsewhere
  // in the guide already. French says « esquisse », never the bare « plan » (the outline, the study plan).
  const stepOf = (markdown: string, n: number) => markdown.split("\n").find((line) => line.startsWith(`${n}. `)) ?? "";

  it.each(["fr", "en"] as const)("asks for a short keyless sketch before the draft, without waiting for approval (%s)", (language) => {
    const step = stepOf(authoringGuide({ language }).markdown, 3);
    const fr = language === "fr";
    expect(step).toContain(fr ? "esquisse" : "sketch");
    expect(step).toMatch(fr ? /l'objectif, les intitulés des concepts, et le titre de chaque étape avec son type/ : /the goal, the concept labels, and each step's title with its kind/);
    expect(step).toContain(fr ? "jamais une clé" : "never a key");
    expect(step).toContain(fr ? "des titres qui nomment le sujet, jamais la réponse" : "titles name the topic, never the answer");
    expect(step).toMatch(fr ? /sans attendre son accord/ : /without waiting for approval/);
    expect(step).not.toMatch(/\bplan\b/);
  });

  it.each(["fr", "en"] as const)("asks to write the draft once, in the create_lesson call (%s)", (language) => {
    const step = stepOf(authoringGuide({ language }).markdown, 4);
    expect(step).toContain(language === "fr" ? "une seule fois, dans l'appel à `create_lesson`" : "once, in the `create_lesson` call");
    expect(step).toMatch(language === "fr" ? /pas dans un message, pas deux fois/ : /not in a message, not twice/);
    expect(step).toContain("draft_id");
  });

  it.each(["fr", "en"] as const)("asks to tick a host's todo list with the next call, never in a turn of its own (%s)", (language) => {
    const step = stepOf(authoringGuide({ language }).markdown, 5);
    const fr = language === "fr";
    expect(step).toContain(fr ? "liste de tâches" : "todo list");
    expect(step).toContain(fr ? "sources, esquisse, rédaction et vérification" : "sources, sketch, writing and checking");
    expect(step).toContain(fr ? "dans le même tour que votre appel suivant" : "in the same turn as your next call");
    expect(step).toContain(fr ? "jamais dans un tour à part" : "never in a turn of its own");
  });

  it.each(["fr", "en"] as const)("shows after create_lesson only what differs from the sketch, and the notice (%s)", (language) => {
    const step = stepOf(authoringGuide({ language }).markdown, 6);
    expect(step).toContain(language === "fr" ? "seulement ce qui diffère de l'esquisse" : "only what differs from the sketch");
    expect(step).toContain(language === "fr" ? "jamais une clé" : "never a key");
    expect(step).toContain("`notice`");
    expect(step).toContain("`start_lesson_session {bundle_ref: course_ref}`");
  });

  it("never says the bare « plan » in French: the sketch is an « esquisse »", () => {
    expect(authoringGuide({ language: "fr" }).markdown).not.toMatch(/\bplan\b/);
    expect(authoringGuide({ language: "fr", mode: "teacher" }).markdown).not.toMatch(/\bplan\b/);
  });

  // The waiting review's text (BN-2's tell_learner step, D3's sketch, todo and differences, D4's resend)
  // shares one budget over the guide of release 0.6.4, pinned here: every build reads the whole guide. The
  // plan gave BN-2 300 characters and D3 400; D4's resend sentence takes about 200 more.
  const GUIDE_064_CHARS = { en: 4601, fr: 5054 } as const;
  const WAITING_REVIEW_BUDGET = 900;
  it.each(["fr", "en"] as const)("stays within the waiting review's budget over the 0.6.4 guide (%s)", (language) => {
    expect(authoringGuide({ language }).markdown.length).toBeLessThanOrEqual(GUIDE_064_CHARS[language] + WAITING_REVIEW_BUDGET);
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
