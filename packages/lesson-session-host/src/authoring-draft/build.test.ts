import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LessonBundleSchema } from "@studium/lesson-bundle-schema";
import { createLesson, SELF_STUDY_VALIDATED_BY, type CreateLessonResult } from "./build.js";
import { lintBundleData } from "./lint.js";
import { prepareSources, type SourceSet } from "./source-set.js";
import { FRENCH_SOURCE, P1, P2, P3 } from "./test-fixtures.js";

const NOW = new Date("2026-10-30T09:00:00.000Z");
const GOAL = "Distinguer les deux formes de solidarité et ce que le droit en montre";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function prepared(): Promise<{ root: string; set: SourceSet }> {
  const root = mkdtempSync(join(tmpdir(), "authoring-build-"));
  roots.push(root);
  return { root, set: await prepareSources(root, [FRENCH_SOURCE], { goal: GOAL, language: "fr" }) };
}

/** A complete draft over FRENCH_SOURCE: every quote is copied from a passage. */
function validDraft(): Record<string, unknown> & { scenes: Array<Record<string, unknown>> } {
  return {
    title: "Solidarité mécanique et organique",
    language: "fr",
    goal: GOAL,
    concepts: [
      { id: "c-mecanique", label: "Solidarité mécanique", bloom: "understand" },
      { id: "c-organique", label: "Solidarité organique", bloom: "understand", prerequisites: ["c-mecanique"] },
    ],
    scenes: [
      { type: "intro", title: "Deux façons de tenir ensemble", concept_refs: ["c-mecanique"],
        markdown: "Cette leçon compare deux formes de cohésion sociale à partir de votre source.", quotes: [] },
      { type: "concept", title: "La ressemblance", concept_refs: ["c-mecanique"],
        markdown: "Quand tous partagent les mêmes croyances, la cohésion naît de la ressemblance.",
        // A straight apostrophe where the source has a typographic one: accepted.
        quotes: [{ passage_id: P1, text: "comme les molécules d'un corps inerte" }] },
      { type: "quiz", title: "D'où vient la cohésion ?", concept_refs: ["c-mecanique"],
        question: "Dans la solidarité mécanique, d'où vient la cohésion ?",
        choices: [
          { text: "Du partage des mêmes croyances", correct: true },
          { text: "De la spécialisation des fonctions", correct: false },
          { text: "D'un contrat entre individus", correct: false },
        ],
        feedback_correct: "Oui : la cohésion vient de la ressemblance.",
        feedback_incorrect: "Relisez le passage sur la ressemblance.",
        quotes: [{ passage_id: P1, text: "la cohésion vient de ce que tous partagent les mêmes croyances" }] },
      { type: "concept", title: "La différence", concept_refs: ["c-organique"],
        markdown: "Quand le travail se divise, chacun dépend des autres.",
        quotes: [{ passage_id: P2, text: "chacun dépend des autres parce qu’il ne fait pas ce qu’ils font" }] },
      { type: "explain_back", title: "Expliquer la solidarité organique", concept_refs: ["c-organique"],
        prompt: "Expliquez avec vos mots ce qui tient ensemble une société où le travail est divisé.",
        key_points: [
          { text: "Les individus se spécialisent", cues: ["spécialis", "différen"] },
          { text: "Chacun dépend des autres", cues: ["dépend", "interdépend"] },
        ],
        model_explanation: "Le travail divisé spécialise les individus ; chacun dépend alors des autres, comme les organes d'un être vivant.",
        quotes: [{ passage_id: P2, text: "les fonctions se spécialisent et les individus deviennent différents" }] },
      { type: "summary_audit", title: "Auditer un résumé", concept_refs: ["c-organique"],
        source_content: "Là où domine la solidarité mécanique, le droit est surtout répressif.",
        ai_summary: "Le droit est toujours restitutif, quelle que soit la solidarité.",
        claims: [{ text: "Le résumé efface le droit répressif.", flaws_expected: ["répressif"] }],
        model_correction: "Le résumé omet le droit répressif, propre à la solidarité mécanique.",
        quotes: [{ passage_id: P3, text: "le droit est surtout répressif" }] },
    ],
  };
}

async function created(input: Partial<Parameters<typeof createLesson>[1]> = {}): Promise<{ root: string; result: CreateLessonResult }> {
  const { root, set } = await prepared();
  const result = await createLesson(root, { source_set_id: set.source_set_id, draft: validDraft(), ...input }, { now: () => NOW });
  return { root, result };
}

function okResult(result: CreateLessonResult): Extract<CreateLessonResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return result;
}

function errorsOf(result: CreateLessonResult) {
  if (result.ok) throw new Error("expected a refusal");
  return result.errors;
}

describe("createLesson: a valid draft", () => {
  it("writes a complete LessonBundle 1.4 to <library>/<course_id>/lesson.json", async () => {
    const { root, result } = await created();
    const ok = okResult(result);
    expect(ok.course_id).toBe("solidarite-mecanique-et-organique");
    expect(ok.course_ref).toBe("solidarite-mecanique-et-organique/lesson.json");
    const written = JSON.parse(readFileSync(join(root, ok.course_ref), "utf8"));
    expect(LessonBundleSchema.safeParse(written).success).toBe(true);
    expect(JSON.stringify(written)).not.toMatch(/TODO/);
    expect(written).toEqual(JSON.parse(JSON.stringify(ok.bundle)));
  });

  it("lints with no ERROR, and reports the agent-drafted key instead of an open book", async () => {
    const { root, result } = await created();
    const ok = okResult(result);
    const { findings } = lintBundleData(ok.bundle, { bundleDir: join(root, ok.course_id) });
    expect(findings.filter((item) => item.level === "ERROR")).toEqual([]);
    expect(ok.findings).toEqual(findings);
    expect(ok.findings.map((item) => item.code)).toContain("self_study_agent_key");
    expect(ok.findings.map((item) => item.code)).not.toContain("self_study_open_book");
  });

  it("records who drafted it and that no teacher validated it", async () => {
    const bundle = okResult((await created()).result).bundle;
    expect(bundle.metadata.authoring).toEqual({ mode: "self_study", author_is_learner: false, drafted_by: "agent", note: GOAL });
    expect(bundle.validated_by).toBe(SELF_STUDY_VALIDATED_BY);
    expect(bundle.validated_by).toBe("SELF-STUDY — not teacher-validated");
    expect(bundle.validated_at).toBe(NOW.toISOString());
    expect(bundle.metadata).toMatchObject({ title: "Solidarité mécanique et organique", language: "fr", target: "Apprenant autonome" });
    expect(bundle.bundle_id).toBe("self-study-solidarite-mecanique-et-organique");
  });

  it("fills the identifiers, the defaults and the prerequisite graph (engine convention)", async () => {
    const bundle = okResult((await created()).result).bundle;
    expect(bundle.scenes.map((scene) => scene.id)).toEqual([
      "s1-intro", "s2-concept", "s3-quiz", "s4-concept", "s5-explain_back", "s6-summary_audit",
    ]);
    const quiz = bundle.scenes[2]!;
    if (quiz.type !== "quiz") throw new Error("expected a quiz");
    expect(quiz.choices.map((choice) => choice.id)).toEqual(["a", "b", "c"]);
    expect(quiz.hints).toEqual([]);
    const explain = bundle.scenes[4]!;
    if (explain.type !== "explain_back") throw new Error("expected explain_back");
    expect(explain.key_points.map((point) => point.id)).toEqual(["kp1", "kp2"]);
    expect(explain.rubric).toEqual({ completeness: 0.6, evidence_quality: 0.3, tone: 0.1 });
    expect(bundle.concepts).toEqual([
      { id: "c-mecanique", title: "Solidarité mécanique", description: "Solidarité mécanique", bloom_level_target: "understand" },
      { id: "c-organique", title: "Solidarité organique", description: "Solidarité organique", bloom_level_target: "understand" },
    ]);
    expect(bundle.learning_workflow_graph?.edges).toEqual([{
      id: "prerequisite:c-organique:c-mecanique", relation: "prerequisite_for",
      source: "concept:c-organique", target: "concept:c-mecanique",
    }]);
    // L-5: French typography, a no-break space before the colon.
    expect(bundle.rules.map((rule) => rule.explanation_short)).toEqual(["Deux erreurs sur ce concept\u00a0: on reprend la scène avec un appui."]);
    expect(bundle.metadata.duration_minutes).toBe(14);
  });

  it("binds each cited scene to its passages, with the source's own characters", async () => {
    const bundle = okResult((await created()).result).bundle;
    expect(bundle.scenes[0]!.evidence).toBeUndefined();
    const refs = bundle.scenes[1]!.evidence?.bibliographic_refs;
    expect(refs).toEqual([{
      perspicacite_doc_id: P1, title: "Deux formes de solidarité", authors: [],
      excerpt: "comme les molécules d’un corps inerte", relevance_score: 1, prov_derived_from: "https://example.org/solidarite",
      // L-3: the licence the learner's source was prepared with travels with every citation.
      license: "CC-BY-4.0",
    }]);
    expect(bundle.scenes[5]!.evidence?.enrichment_metadata).toEqual({
      enricher_version: "studium-authoring-draft/1", perspicacite_mode_used: "passages", timestamp: NOW.toISOString(), degraded: false,
    });
  });

  it("returns an outline and key classes without any key", async () => {
    const ok = okResult((await created()).result);
    expect(ok.key_classes).toEqual({
      author_keyed: ["s3-quiz"], production: ["s5-explain_back", "s6-summary_audit"], externally_grounded: [],
      ungraded: ["s1-intro", "s2-concept", "s4-concept"],
    });
    expect(ok.outline.scenes[2]).toEqual({
      id: "s3-quiz", type: "quiz", title: "D'où vient la cohésion ?", concepts: ["c-mecanique"], key_class: "author_keyed", passages: [P1],
    });
    expect(ok.outline.concepts).toEqual([
      { id: "c-mecanique", label: "Solidarité mécanique", prerequisites: [] },
      { id: "c-organique", label: "Solidarité organique", prerequisites: ["c-mecanique"] },
    ]);
    const shown = JSON.stringify({ outline: ok.outline, key_classes: ok.key_classes });
    for (const key of ["Du partage des mêmes croyances", "spécialis", "interdépend", "répressif", "Oui : la cohésion", "correct", "model_"]) {
      expect(shown).not.toContain(key);
    }
  });

  it("is deterministic: the same draft at the same time gives the same file", async () => {
    const first = okResult((await created()).result).bundle;
    const second = okResult((await created()).result).bundle;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("createLesson: refusals an agent can act on", () => {
  async function refused(mutate: (draft: ReturnType<typeof validDraft>) => void, input: Record<string, unknown> = {}) {
    const { root, set } = await prepared();
    const draft = validDraft();
    mutate(draft);
    const result = await createLesson(root, { source_set_id: set.source_set_id, draft, ...input }, { now: () => NOW });
    return { root, errors: errorsOf(result) };
  }

  it("refuses a quote that is not in its passage, with the closest wording", async () => {
    const { root, errors } = await refused((draft) => {
      draft.scenes[2]!["quotes"] = [{ passage_id: P1, text: "la cohésion vient du partage des mêmes croyances" }];
    });
    expect(errors).toEqual([{
      path: "scenes.2.quotes.0.text", message: `the quote is not in passage ${P1}`,
      hint: expect.stringContaining("matches it up to “la cohésion vient d”"),
    }]);
    expect(existsSync(join(root, "solidarite-mecanique-et-organique"))).toBe(false);
  });

  it("refuses an unknown passage id, pointing to the passage that holds the quote", async () => {
    const { errors } = await refused((draft) => {
      draft.scenes[5]!["quotes"] = [{ passage_id: "p:autre:1", text: "le droit est surtout répressif" }];
    });
    expect(errors).toEqual([{ path: "scenes.5.quotes.0.passage_id", message: "unknown passage_id p:autre:1", hint: `the quote is in ${P3}: cite that passage_id` }]);
  });

  it("refuses an unfilled placeholder: a lesson is created complete", async () => {
    const { errors } = await refused((draft) => { draft.scenes[2]!["feedback_incorrect"] = "TODO: retour"; });
    expect(errors).toEqual([{ path: "scenes.2.feedback_incorrect", message: "unfilled placeholder \"TODO: retour\"", hint: "write the real text: a lesson is created complete, with no TODO" }]);
  });

  it("reports a malformed scene field by field", async () => {
    const { errors } = await refused((draft) => {
      delete draft.scenes[4]!["key_points"];
      draft.scenes[3]!["type"] = "lecture";
    });
    expect(errors).toEqual(expect.arrayContaining([
      { path: "scenes.4.key_points", message: "required field is missing", hint: 'add "key_points"' },
      expect.objectContaining({ path: "scenes.3.type", message: '"lecture" is not a known type' }),
    ]));
  });

  it("refuses a production scene without quotes and a key point with a single cue", async () => {
    const { errors } = await refused((draft) => {
      draft.scenes[4]!["quotes"] = [];
      (draft.scenes[4]!["key_points"] as Array<{ cues: string[] }>)[0]!.cues = ["spécialis"];
    });
    expect(errors).toEqual(expect.arrayContaining([
      { path: "scenes.4.quotes", message: "needs at least 1 item, has 0", hint: "add items" },
      { path: "scenes.4.key_points.0.cues", message: "needs at least 2 items, has 1", hint: "add items" },
    ]));
  });

  it("checks concept references and that every concept is taught", async () => {
    const { errors } = await refused((draft) => {
      (draft.concepts as Array<Record<string, unknown>>).push({ id: "c-droit", label: "Droit", bloom: "remember", prerequisites: ["c-absent"] });
      draft.scenes[5]!["concept_refs"] = ["c-inconnu"];
      delete draft.scenes[0]!["concept_refs"];
    });
    expect(errors).toEqual(expect.arrayContaining([
      { path: "concepts.2.prerequisites.0", message: 'unknown concept "c-absent"', hint: "use one of: c-mecanique, c-organique, c-droit" },
      { path: "scenes.5.concept_refs.0", message: 'unknown concept "c-inconnu"', hint: "use one of: c-mecanique, c-organique, c-droit" },
      { path: "scenes.0.concept_refs", message: "required when the draft has several concepts", hint: "name the concept this scene teaches: one of c-mecanique, c-organique, c-droit" },
      { path: "concepts.2", message: 'concept "c-droit" has no scene', hint: "add a scene that teaches it, or remove it" },
    ]));
  });

  it("refuses a quiz without exactly one correct choice", async () => {
    const { errors } = await refused((draft) => {
      (draft.scenes[2]!["choices"] as Array<{ correct: boolean }>)[1]!.correct = true;
    });
    expect(errors).toEqual([{ path: "scenes.2.choices", message: "exactly one choice must be correct, found 2", hint: "mark the one right answer correct: true" }]);
  });

  it("passes the linter's ERRORs back with the scene they concern", async () => {
    const { errors } = await refused((draft) => {
      draft.scenes[5]!["model_correction"] = "Le résumé se trompe sur la nature du droit.";
    });
    expect(errors).toEqual([{
      path: "scenes.5.model_correction",
      message: 'flaw_reveal_gap: s6-summary_audit: flaw "répressif" is absent from model_correction',
      hint: "name every expected flaw in model_correction, in the words of flaws_expected",
    }]);
  });

  it("refuses a dependent concept taught before its prerequisite", async () => {
    const { errors } = await refused((draft) => {
      const [intro, ...rest] = draft.scenes;
      draft.scenes = [{ ...intro!, concept_refs: ["c-organique"] }, ...rest];
    });
    expect(errors.map((error) => error.message)).toEqual([expect.stringMatching(/^lwg_locked_before_prereq: concept:c-organique is carried by the first concept scene "s1-intro"/)]);
    expect(errors[0]!.hint).toMatch(/prerequisite concept is taught before/);
  });

  it("keeps an existing lesson unless overwrite is true", async () => {
    const { root, set } = await prepared();
    const input = { source_set_id: set.source_set_id, draft: validDraft() };
    okResult(await createLesson(root, input, { now: () => NOW }));
    expect(errorsOf(await createLesson(root, input, { now: () => NOW }))).toEqual([{
      path: "course_id", message: "a lesson already exists at solidarite-mecanique-et-organique/lesson.json",
      hint: "pass overwrite: true to replace it, or choose another course_id",
    }]);
    okResult(await createLesson(root, { ...input, overwrite: true }, { now: () => NOW }));
  });

  it("refuses a course_id that is not a plain directory name", async () => {
    for (const courseId of ["../outside", "Mon Cours", "_sources"]) {
      const { root, errors } = await refused(() => undefined, { course_id: courseId });
      expect(errors[0]).toMatchObject({ path: "course_id" });
      expect(existsSync(join(root, "..", "outside"))).toBe(false);
    }
  });

  it("refuses an unknown source set", async () => {
    const { root } = await prepared();
    const result = await createLesson(root, { source_set_id: "ss-0000000000000000", draft: validDraft() }, { now: () => NOW });
    expect(errorsOf(result)).toEqual([{ path: "source_set_id", message: "no source set ss-0000000000000000 in this library", hint: "call prepare_sources again with the same texts" }]);
  });
});

describe("createLesson: the learner profile (SL-6)", () => {
  it("asks for the two-item opening diagnostic when a profile is given", async () => {
    const { root, set } = await prepared();
    const draft = { ...validDraft(), learner_profile: { prior: "lycée", minutes_per_day: 15 } };
    const ok = okResult(await createLesson(root, { source_set_id: set.source_set_id, draft }, { now: () => NOW }));
    expect(ok.findings).toContainEqual(expect.objectContaining({ level: "WARN", code: "no_opening_diagnostic" }));
  });

  it("is satisfied by a meta_checkpoint and a production scene after the intro, both flagged diagnostic", async () => {
    const { root, set } = await prepared();
    const draft = validDraft();
    const diagnostic = [
      { type: "meta_checkpoint", title: "Où en êtes-vous ?", concept_refs: ["c-mecanique"], diagnostic: true,
        pre_question: "Avant : à quel point savez-vous ce qui fait tenir une société ?",
        post_question: "Après : et maintenant ?", quotes: [] },
      { type: "explain_back", title: "Ce que vous savez déjà", concept_refs: ["c-mecanique"], diagnostic: true,
        prompt: "Dites en deux phrases ce qui fait tenir ensemble des gens qui se ressemblent.",
        key_points: [{ text: "Les mêmes croyances", cues: ["croyance", "partag"] }],
        model_explanation: "Ils partagent les mêmes croyances et les mêmes sentiments.",
        quotes: [{ passage_id: P1, text: "tous partagent les mêmes croyances et les mêmes sentiments" }] },
    ];
    draft.scenes.splice(1, 0, ...diagnostic);
    const ok = okResult(await createLesson(root, {
      source_set_id: set.source_set_id, draft: { ...draft, learner_profile: { interests: ["droit"] } },
    }, { now: () => NOW }));
    expect(ok.findings.map((item) => item.code)).not.toContain("no_opening_diagnostic");
    expect(ok.findings.map((item) => item.code)).not.toContain("no_opening_diagnostic_flag");
    const meta = ok.bundle.scenes[1]!;
    if (meta.type !== "meta_checkpoint") throw new Error("expected a meta_checkpoint");
    expect(meta.scale_labels).toEqual(["Pas du tout", "Un peu", "Moyennement", "Plutôt bien", "Tout à fait"]);
  });

  it("asks for both diagnostic flags when the opening has the right shape but only its meta_checkpoint is flagged", async () => {
    const { root, set } = await prepared();
    const draft = validDraft();
    draft.scenes.splice(1, 0,
      { type: "meta_checkpoint", title: "Où en es-tu ?", concept_refs: ["c-mecanique"], diagnostic: true,
        pre_question: "Avant : à quel point sais-tu ce qui fait tenir une société ?",
        post_question: "Après : et maintenant ?", quotes: [] },
      { type: "explain_back", title: "Ce que tu sais déjà", concept_refs: ["c-mecanique"],
        prompt: "Dis en deux phrases ce qui fait tenir ensemble des gens qui se ressemblent.",
        key_points: [{ text: "Les mêmes croyances", cues: ["croyance", "partag"] }],
        model_explanation: "Ils partagent les mêmes croyances et les mêmes sentiments.",
        quotes: [{ passage_id: P1, text: "tous partagent les mêmes croyances et les mêmes sentiments" }] },
    );
    const ok = okResult(await createLesson(root, {
      source_set_id: set.source_set_id, draft: { ...draft, learner_profile: { interests: ["droit"] } },
    }, { now: () => NOW }));
    const codes = ok.findings.map((item) => item.code);
    expect(codes).not.toContain("no_opening_diagnostic");
    const flag = ok.findings.find((item) => item.code === "no_opening_diagnostic_flag");
    expect(flag).toMatchObject({ level: "WARN" });
    expect(flag?.message).toContain("s3-explain_back");
    expect(flag?.message).not.toContain("s2-meta_checkpoint");
  });
});

describe("createLesson: the source licence (L-3)", () => {
  it("leaves the licence out of a citation whose source declared none", async () => {
    const root = mkdtempSync(join(tmpdir(), "authoring-build-"));
    roots.push(root);
    const { license: _declared, ...withoutLicense } = FRENCH_SOURCE;
    const set = await prepareSources(root, [withoutLicense], { goal: GOAL, language: "fr" });
    const bundle = okResult(await createLesson(root, { source_set_id: set.source_set_id, draft: validDraft() }, { now: () => NOW })).bundle;
    const refs = bundle.scenes.flatMap((scene) => scene.evidence?.bibliographic_refs ?? []);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).not.toHaveProperty("license");
  });

  it("writes the licence of each cited source into lesson.json", async () => {
    const { root, result } = await created();
    const written = JSON.parse(readFileSync(join(root, okResult(result).course_ref), "utf8")) as { scenes: Array<{ evidence?: { bibliographic_refs: Array<{ license?: string }> } }> };
    const licences = written.scenes.flatMap((scene) => (scene.evidence?.bibliographic_refs ?? []).map((ref) => ref.license));
    expect(licences.length).toBeGreaterThan(0);
    expect(new Set(licences)).toEqual(new Set(["CC-BY-4.0"]));
  });
});

describe("createLesson: diagnostic scenes (L-8)", () => {
  it("keeps the draft's diagnostic flag on the scene, and no flag on the others", async () => {
    const { root, set } = await prepared();
    const draft = validDraft();
    draft.scenes[4]!["diagnostic"] = true;
    const bundle = okResult(await createLesson(root, { source_set_id: set.source_set_id, draft }, { now: () => NOW })).bundle;
    expect(bundle.scenes[4]).toMatchObject({ id: "s5-explain_back", diagnostic: true });
    expect(bundle.scenes.filter((scene) => scene.diagnostic !== undefined).map((scene) => scene.id)).toEqual(["s5-explain_back"]);
  });
});

describe("createLesson: an unmeasurable prerequisite (RFR-17)", () => {
  it("names the concept to give a quiz, and the concept that depends on it", async () => {
    const { root, set } = await prepared();
    const draft = validDraft();
    draft.scenes.splice(2, 1); // the only quiz on c-mecanique, the prerequisite of c-organique
    const ok = okResult(await createLesson(root, { source_set_id: set.source_set_id, draft }, { now: () => NOW }));
    const warning = ok.findings.find((item) => item.code === "lwg_prereq_unassessable");
    expect(warning).toMatchObject({ level: "WARN", message: expect.stringContaining("concept:c-mecanique") });
    expect(warning?.hint).toMatch(/add a quiz on "c-mecanique"/);
    expect(warning?.hint).toContain("c-organique");
    expect(warning?.hint).toMatch(/without a judge model/);
  });
});

describe("createLesson: the learner profile is kept (RFR-06)", () => {
  const profile = { prior: "lycée", minutes_per_day: 10, target_date: "2026-12-01" };

  it("stores only the scheduling part of the learner profile in metadata.authoring of the written lesson", async () => {
    const { root, set } = await prepared();
    const draft = { ...validDraft(), learner_profile: profile };
    const ok = okResult(await createLesson(root, { source_set_id: set.source_set_id, draft }, { now: () => NOW }));
    const written = JSON.parse(readFileSync(join(root, ok.course_ref), "utf8")) as { metadata: { authoring: Record<string, unknown> } };
    // A lesson file can be shared; what the learner already knows and what interests them shaped the
    // draft and stay out of it. The study plan needs only the minutes a day and the target date.
    const scheduling = { minutes_per_day: 10, target_date: "2026-12-01" };
    expect(written.metadata.authoring).toEqual({ mode: "self_study", author_is_learner: false, drafted_by: "agent", note: GOAL, learner_profile: scheduling });
    expect(LessonBundleSchema.parse(written).metadata.authoring?.learner_profile).toEqual(scheduling);
  });

  it("writes no learner_profile when the profile has no scheduling field", async () => {
    const { root, set } = await prepared();
    const draft = { ...validDraft(), learner_profile: { prior: "lycée", interests: ["droit"] } };
    const ok = okResult(await createLesson(root, { source_set_id: set.source_set_id, draft }, { now: () => NOW }));
    const written = JSON.parse(readFileSync(join(root, ok.course_ref), "utf8")) as { metadata: { authoring: Record<string, unknown> } };
    expect(written.metadata.authoring).not.toHaveProperty("learner_profile");
  });

  it("warns when the lesson takes longer than the learner's minutes a day, and not otherwise", async () => {
    const { root, set } = await prepared();
    const over = okResult(await createLesson(root, {
      source_set_id: set.source_set_id, draft: { ...validDraft(), learner_profile: profile },
    }, { now: () => NOW }));
    expect(over.bundle.metadata.duration_minutes).toBe(14);
    expect(over.findings).toContainEqual(expect.objectContaining({
      level: "WARN", code: "duration_over_daily_minutes", message: expect.stringMatching(/about 14 minutes.*10 minutes a day/),
    }));
    const within = okResult(await createLesson(root, {
      source_set_id: set.source_set_id, draft: { ...validDraft(), learner_profile: { minutes_per_day: 15 } }, overwrite: true,
    }, { now: () => NOW }));
    expect(within.findings.map((item) => item.code)).not.toContain("duration_over_daily_minutes");
  });
});

describe("createLesson: overwrite replaces only a self-study lesson (SEC-1)", () => {
  async function withExisting(lesson: Record<string, unknown>, approval = false) {
    const { root, set } = await prepared();
    const dir = join(root, "solidarite-mecanique-et-organique");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lesson.json"), JSON.stringify(lesson));
    if (approval) writeFileSync(join(dir, "approval.json"), JSON.stringify({ reviewer: "Prof" }));
    const result = await createLesson(root, { source_set_id: set.source_set_id, draft: validDraft(), overwrite: true }, { now: () => NOW });
    return { dir, result };
  }

  it("refuses to replace a teacher's lesson", async () => {
    const teacher = { metadata: { title: "Cours", authoring: { mode: "teacher" } }, validated_by: "Prof. Martin" };
    const { dir, result } = await withExisting(teacher);
    expect(errorsOf(result)).toEqual([{
      path: "course_id", message: "solidarite-mecanique-et-organique/lesson.json is not a self-study lesson: overwrite replaces only those",
      hint: "choose another course_id",
    }]);
    expect(JSON.parse(readFileSync(join(dir, "lesson.json"), "utf8"))).toEqual(teacher);
  });

  it("refuses to replace a lesson with no authoring record, an approval or a teacher's validation", async () => {
    expect(errorsOf((await withExisting({ metadata: { title: "Ancien" }, validated_by: "SELF-STUDY" })).result)[0]).toMatchObject({ path: "course_id" });
    const approved = { metadata: { authoring: { mode: "self_study" } }, validated_by: "SELF-STUDY — not teacher-validated" };
    expect(errorsOf((await withExisting(approved, true)).result)[0]).toMatchObject({ path: "course_id", message: expect.stringContaining("approval.json") });
    const released = { metadata: { authoring: { mode: "self_study", author_is_learner: true } }, validated_by: "Prof. Martin" };
    expect(errorsOf((await withExisting(released)).result)[0]).toMatchObject({ path: "course_id", message: expect.stringContaining("validated by a teacher") });
  });

  it("refuses to replace an unreadable lesson.json", async () => {
    const { root, set } = await prepared();
    const dir = join(root, "solidarite-mecanique-et-organique");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lesson.json"), "{ not json");
    const result = await createLesson(root, { source_set_id: set.source_set_id, draft: validDraft(), overwrite: true }, { now: () => NOW });
    expect(errorsOf(result)[0]).toMatchObject({ path: "course_id" });
    expect(readFileSync(join(dir, "lesson.json"), "utf8")).toBe("{ not json");
  });
});

describe("createLesson: a course id another lessons folder already serves is refused", () => {
  it("refuses before writing when the server reads a lesson of that id first, and names the fix", async () => {
    const { root, set } = await prepared();
    const servedElsewhere = (id: string) => id === "taken";
    const result = await createLesson(root, { source_set_id: set.source_set_id, draft: validDraft(), course_id: "taken" }, { now: () => NOW, servedElsewhere });
    expect(errorsOf(result)).toEqual([{
      path: "course_id", message: "\"taken\" is already a lesson in the lessons folder this server reads before the library",
      hint: "choose another course_id",
    }]);
    expect(existsSync(join(root, "taken"))).toBe(false);
    okResult(await createLesson(root, { source_set_id: set.source_set_id, draft: validDraft(), course_id: "free" }, { now: () => NOW, servedElsewhere }));
  });
});
