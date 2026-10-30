// packages/lesson-session-host/src/authoring.test.ts
//
// Who wrote the lesson, said on every surface (spec 2026-10-30 « apprenant autonome », Contrat
// commun, « Textes de l'avis »). The self-study bundles are built in-test from the real
// atomistique-l1 fixture by adding `metadata.authoring` and the self-study `validated_by`; the
// untouched fixture is the teacher case. The notice depends on whether the host has a judge model
// (`live`): without one, production scenes are not certified, and the notice must say so.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { authoringOf, SELF_STUDY_NOTICE } from "./authoring.js";
import { publicPresentation, publicTransition } from "./public-scene.js";

const ATOMISTIQUE = fileURLToPath(new URL("../../../fixtures/atomistique-l1/lesson.json", import.meta.url));
const SELF_STUDY_VALIDATED_BY = "SELF-STUDY — not teacher-validated";
const OPEN_BOOK_FR = "Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). ";
const OPEN_BOOK_EN = "Self-authored lesson: quiz and spot-the-flaw keys were written by the learner (open book). ";
const NOTICE = {
  fr: {
    without_judge: OPEN_BOOK_FR + "Sans juge modèle, les scènes de production donnent un retour par mots-clés sans " +
      "évaluation certifiée ; seules les reproductions exécutées portent une évaluation externe.",
    with_judge: OPEN_BOOK_FR + "Les scènes de production, jugées par le modèle, et les reproductions exécutées " +
      "portent l'évaluation.",
  },
  en: {
    without_judge: OPEN_BOOK_EN + "Without a judge model, production scenes give keyword feedback with no certified " +
      "assessment; only executed reproductions carry an external assessment.",
    with_judge: OPEN_BOOK_EN + "Production scenes, judged by the model, and executed reproductions carry the assessment.",
  },
};
const BLOCK_KEYS = ["mode", "author_is_learner", "validated", "judge", "notice"];

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

type BundleJson = { metadata: Record<string, unknown>; validated_by: string; [key: string]: unknown };

/** The atomistique-l1 fixture, optionally turned into a self-study bundle in `language`. */
function atomistique(opts: { selfStudy?: boolean; language?: string } = {}): BundleJson {
  const bundle = JSON.parse(readFileSync(ATOMISTIQUE, "utf8")) as BundleJson;
  if (opts.language) bundle.metadata.language = opts.language;
  if (opts.selfStudy) {
    bundle.metadata.authoring = { mode: "self_study", author_is_learner: true };
    bundle.validated_by = SELF_STUDY_VALIDATED_BY;
  }
  return bundle;
}

/** A bundles root holding `bundle` as lesson.json, and a host over it (offline unless `live`). */
function hostOver(bundle: Record<string, unknown>, live = false): SessionHost {
  const root = mkdtempSync(join(tmpdir(), "authoring-")); dirs.push(root);
  writeFileSync(join(root, "lesson.json"), JSON.stringify(bundle));
  return new SessionHost({ bundlesRoot: root, live });
}

/** Start lesson.json on a live host; live mode refuses the default pseudonym secret. */
async function startLive(bundle: Record<string, unknown>) {
  const previous = process.env["STUDIUM_PSEUDO_SECRET"];
  process.env["STUDIUM_PSEUDO_SECRET"] = "authoring-test-secret";
  try { return await hostOver(bundle, true).create("lesson.json"); }
  finally {
    if (previous === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
    else process.env["STUDIUM_PSEUDO_SECRET"] = previous;
  }
}

describe("authoring block of a started lesson", () => {
  it("a French self-study bundle on an offline host: no judge, the no-judge notice, not validated", async () => {
    const started = await hostOver(atomistique({ selfStudy: true })).create("lesson.json");
    expect(started.authoring).toEqual({
      mode: "self_study", author_is_learner: true, validated: false, judge: false, notice: NOTICE.fr.without_judge,
    });
    expect(Object.keys(started.authoring)).toEqual(BLOCK_KEYS);
  });

  it("the same bundle on a live host: a judge, the judged notice", async () => {
    const started = await startLive(atomistique({ selfStudy: true }));
    expect(started.authoring).toEqual({
      mode: "self_study", author_is_learner: true, validated: false, judge: true, notice: NOTICE.fr.with_judge,
    });
  });

  it("an English self-study bundle carries the English notice of each variant", async () => {
    const offline = await hostOver(atomistique({ selfStudy: true, language: "en" })).create("lesson.json");
    expect(offline.authoring.notice).toBe(NOTICE.en.without_judge);
    const live = await startLive(atomistique({ selfStudy: true, language: "en" }));
    expect(live.authoring.notice).toBe(NOTICE.en.with_judge);
  });

  it("the untouched atomistique fixture is a validated teacher bundle with no notice, judge or not", async () => {
    const offline = await hostOver(atomistique()).create("lesson.json");
    expect(offline.authoring).toEqual({ mode: "teacher", author_is_learner: false, validated: true, judge: false, notice: null });
    const live = await startLive(atomistique());
    expect(live.authoring).toEqual({ mode: "teacher", author_is_learner: false, validated: true, judge: true, notice: null });
  });
});

describe("authoringOf", () => {
  const metadata = { title: "T", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" };

  it("holds the four spec texts verbatim", () => {
    expect(SELF_STUDY_NOTICE).toEqual(NOTICE);
  });

  it("is not validated under the DRAFT prefix either", () => {
    expect(authoringOf({ metadata, validated_by: "DRAFT — not validated" }, { judge: false }).validated).toBe(false);
  });

  it("uses French for a regional French tag and English for any other language", () => {
    const selfStudy = (language: string) => authoringOf({
      metadata: { ...metadata, language, authoring: { mode: "self_study", author_is_learner: false } },
      validated_by: SELF_STUDY_VALIDATED_BY,
    }, { judge: false }).notice;
    expect(selfStudy("fr-FR")).toBe(NOTICE.fr.without_judge);
    expect(selfStudy("de")).toBe(NOTICE.en.without_judge);
  });

  it("reports a learner-authored contribution a teacher approved (community bundle) as teacher and validated", () => {
    const block = authoringOf({
      metadata: { ...metadata, authoring: { mode: "teacher", author_is_learner: true } },
      validated_by: "https://univ-cotedazur.fr/people/teacher-001",
    }, { judge: false });
    expect(block).toEqual({ mode: "teacher", author_is_learner: true, validated: true, judge: false, notice: null });
  });
});

describe("presentations served by the host carry the authoring block", () => {
  it("on start, on the current scene and on every transition, and through the public projections", async () => {
    const host = hostOver(atomistique({ selfStudy: true }));
    const { sessionId, presentation, authoring } = await host.create("lesson.json");
    expect(presentation.authoring).toEqual(authoring);
    expect(host.currentPresentation(sessionId).authoring).toEqual(authoring);
    expect(host.authoring(sessionId)).toEqual(authoring);
    expect(publicPresentation(host.currentPresentation(sessionId)).authoring).toEqual(authoring);

    const transition = await host.respond(sessionId, { kind: "ack" });
    if (!("presentation" in transition)) throw new Error(`expected a presentation, got ${transition.kind}`);
    expect(transition.presentation.authoring).toEqual(authoring);
    const shipped = publicTransition(transition) as typeof transition;
    expect(shipped.presentation.authoring).toEqual(authoring);
  });
});
