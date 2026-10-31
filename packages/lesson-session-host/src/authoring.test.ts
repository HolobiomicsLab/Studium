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
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { authoringOf, readApproval, SELF_STUDY_NOTICE, AGENT_DRAFTED_NOTICE } from "./authoring.js";
import { publicPresentation, publicTransition } from "./public-scene.js";

const ATOMISTIQUE = fileURLToPath(new URL("../../../fixtures/atomistique-l1/lesson.json", import.meta.url));
const SELF_STUDY_VALIDATED_BY = "SELF-STUDY — not teacher-validated";
const OPEN_BOOK_FR = "Leçon auto-rédigée\u00a0: les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). ";
const OPEN_BOOK_EN = "Self-authored lesson: quiz and spot-the-flaw keys were written by the learner (open book). ";
// Sprint 2026-10-30, D5: without a judge, free-text feedback no longer claims coverage; the learner
// compares with the model answer and rates their recall, which schedules reviews and never moves
// mastery — and the notice says so. That replaced the « retour par mots-clés » sentence below.
const NO_JUDGE = {
  fr: "Sans juge modèle, les scènes de production ne sont pas évaluées\u00a0: compare ta réponse à la référence " +
    "affichée et note ton rappel\u202f; cette note règle tes révisions, jamais ta maîtrise.",
  // The notice also appears before any answer/reference; it cannot point to a reference "above".
  en: "Without a judge model, production scenes are not assessed: compare your answer with the provided reference and " +
    "rate your recall; that rating schedules your reviews and never changes your mastery.",
};
const WITH_JUDGE = {
  fr: "Les scènes de production sont évaluées par le modèle.",
  en: "Production scenes are assessed by the model.",
};
const BASE_NOTICE = {
  fr: { without_judge: OPEN_BOOK_FR + NO_JUDGE.fr, with_judge: OPEN_BOOK_FR + WITH_JUDGE.fr },
  en: { without_judge: OPEN_BOOK_EN + NO_JUDGE.en, with_judge: OPEN_BOOK_EN + WITH_JUDGE.en },
};
const REPRODUCTION = {
  fr: " Les reproductions exécutées portent une évaluation externe.",
  en: " Executed reproductions carry an external assessment.",
};
const NOTICE = {
  fr: { without_judge: BASE_NOTICE.fr.without_judge + REPRODUCTION.fr,
    with_judge: BASE_NOTICE.fr.with_judge + REPRODUCTION.fr },
  en: { without_judge: BASE_NOTICE.en.without_judge + REPRODUCTION.en,
    with_judge: BASE_NOTICE.en.with_judge + REPRODUCTION.en },
};
// Contract C3: a self-study lesson an agent drafted from the learner's sources says so — the risk is a
// wrong AI key the learner never saw, not open book.
const AGENT_FR = "Leçon rédigée par l'IA à partir de tes sources, non vérifiée par un enseignant\u00a0: chaque " +
  "question cite son passage\u202f; conteste une clé qui te semble fausse. ";
const AGENT_EN = "AI-drafted lesson from your sources, not checked by a teacher: each item cites its passage; " +
  "challenge any key you think is wrong. ";
const AGENT_BASE_NOTICE = {
  fr: { without_judge: AGENT_FR + NO_JUDGE.fr, with_judge: AGENT_FR + WITH_JUDGE.fr },
  en: { without_judge: AGENT_EN + NO_JUDGE.en, with_judge: AGENT_EN + WITH_JUDGE.en },
};
const AGENT_NOTICE = {
  fr: { without_judge: AGENT_BASE_NOTICE.fr.without_judge + REPRODUCTION.fr,
    with_judge: AGENT_BASE_NOTICE.fr.with_judge + REPRODUCTION.fr },
  en: { without_judge: AGENT_BASE_NOTICE.en.without_judge + REPRODUCTION.en,
    with_judge: AGENT_BASE_NOTICE.en.with_judge + REPRODUCTION.en },
};
// Contract C5 (read side) adds `approval`; `validated` keeps its meaning.
const BLOCK_KEYS = ["mode", "author_is_learner", "drafted_by", "validated", "judge", "notice", "approval"];
const NO_APPROVAL = { recorded: false, matches: false };

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
      mode: "self_study", author_is_learner: true, drafted_by: "learner", validated: false, judge: false,
      notice: NOTICE.fr.without_judge,
      approval: NO_APPROVAL,
    });
    expect(Object.keys(started.authoring)).toEqual(BLOCK_KEYS);
  });

  it("the same bundle on a live host: a judge, the judged notice", async () => {
    const started = await startLive(atomistique({ selfStudy: true }));
    expect(started.authoring).toEqual({
      mode: "self_study", author_is_learner: true, drafted_by: "learner", validated: false, judge: true,
      notice: NOTICE.fr.with_judge,
      approval: NO_APPROVAL,
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
    expect(offline.authoring).toEqual({ mode: "teacher", author_is_learner: false, drafted_by: "teacher",
      validated: true, judge: false, notice: null, approval: NO_APPROVAL });
    const live = await startLive(atomistique());
    expect(live.authoring).toEqual({ mode: "teacher", author_is_learner: false, drafted_by: "teacher",
      validated: true, judge: true, notice: null, approval: NO_APPROVAL });
  });
});

describe("authoringOf", () => {
  const metadata = { title: "T", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" };

  it("holds the four spec texts verbatim", () => {
    // RFR-09 changed the exported base text: the reproduction sentence is appended only by
    // authoringOf when this particular bundle actually contains a reproduction scene.
    expect(SELF_STUDY_NOTICE).toEqual(BASE_NOTICE);
  });

  it("is not validated under the DRAFT prefix either", () => {
    expect(authoringOf({ metadata, validated_by: "DRAFT — not validated" }, { judge: false }).validated).toBe(false);
  });

  it("uses French for a regional French tag and English for any other language", () => {
    const selfStudy = (language: string) => authoringOf({
      metadata: { ...metadata, language, authoring: { mode: "self_study", author_is_learner: false } },
      validated_by: SELF_STUDY_VALIDATED_BY,
    }, { judge: false }).notice;
    expect(selfStudy("fr-FR")).toBe(BASE_NOTICE.fr.without_judge);
    expect(selfStudy("de")).toBe(BASE_NOTICE.en.without_judge);
  });

  it("reports a learner-authored contribution a teacher approved (community bundle) as teacher and validated", () => {
    const block = authoringOf({
      metadata: { ...metadata, authoring: { mode: "teacher", author_is_learner: true } },
      validated_by: "https://univ-cotedazur.fr/people/teacher-001",
    }, { judge: false });
    expect(block).toEqual({ mode: "teacher", author_is_learner: true, drafted_by: "teacher", validated: true,
      judge: false, notice: null, approval: NO_APPROVAL });
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

describe("C3 — a lesson an agent drafted from the learner's sources", () => {
  const metadata = { title: "T", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" };
  const agentDrafted = (language: string, judge: boolean) => authoringOf({
    metadata: { ...metadata, language, authoring: { mode: "self_study", author_is_learner: false, drafted_by: "agent" } },
    validated_by: SELF_STUDY_VALIDATED_BY,
  } as never, { judge }).notice;

  it("holds the four agent-drafted texts verbatim", () => {
    expect(AGENT_DRAFTED_NOTICE).toEqual(AGENT_BASE_NOTICE);
  });

  it("says AI-drafted, not teacher-checked, cited and contestable, by locale and judge", () => {
    expect(agentDrafted("fr", false)).toBe(AGENT_BASE_NOTICE.fr.without_judge);
    expect(agentDrafted("fr", true)).toBe(AGENT_BASE_NOTICE.fr.with_judge);
    expect(agentDrafted("en", false)).toBe(AGENT_BASE_NOTICE.en.without_judge);
    expect(agentDrafted("de", true)).toBe(AGENT_BASE_NOTICE.en.with_judge);
  });

  it("never credits the learner with keys an agent wrote", () => {
    for (const judge of [false, true]) {
      expect(agentDrafted("fr", judge)).not.toMatch(/apprenant/);
      expect(agentDrafted("en", judge)).not.toMatch(/learner/);
    }
  });

  it("mentions external reproduction assessment only when the bundle contains one (RFR-09)", () => {
    const authoring = { mode: "self_study", author_is_learner: false, drafted_by: "agent" };
    const without = authoringOf({ metadata: { ...metadata, authoring }, validated_by: SELF_STUDY_VALIDATED_BY,
      scenes: [] } as never, { judge: false });
    const withRun = authoringOf({ metadata: { ...metadata, authoring }, validated_by: SELF_STUDY_VALIDATED_BY,
      scenes: [{ type: "reproduction" }] } as never, { judge: false });
    expect(without.notice).toBe(AGENT_BASE_NOTICE.fr.without_judge);
    expect(without.notice).not.toMatch(/reproduction/i);
    expect(withRun.notice).toBe(AGENT_NOTICE.fr.without_judge);
    expect(withRun.notice).toContain("reproductions exécutées");
  });

  it("a learner-drafted self-study lesson keeps the open-book notice; drafted_by absent defaults by mode", () => {
    const notice = (authoring: Record<string, unknown>) => authoringOf({
      metadata: { ...metadata, authoring }, validated_by: SELF_STUDY_VALIDATED_BY,
    } as never, { judge: false }).notice;
    expect(notice({ mode: "self_study", author_is_learner: true, drafted_by: "learner" })).toBe(BASE_NOTICE.fr.without_judge);
    expect(notice({ mode: "self_study", author_is_learner: true })).toBe(BASE_NOTICE.fr.without_judge);
  });
});

describe("C5 — the approval record, read side", () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  function courseDir(): string {
    const root = mkdtempSync(join(tmpdir(), "approval-")); dirs.push(root);
    mkdirSync(join(root, "course"), { recursive: true });
    return join(root, "course");
  }
  const record = (bundleSha: string) => JSON.stringify({
    schema: "studium-approval/1", bundle_sha256: bundleSha, reviewer: "Dr Example",
    reviewed_at: "2026-10-30T09:00:00Z", checklist: {}, lint: { errors: 0, warnings: 0 }, tool: "experience_packet.py approve",
  });

  it("no record, a matching record, a stale record and a malformed one", async () => {
    const dir = courseDir();
    expect(await readApproval(dir, sha("v1"))).toEqual({ recorded: false, matches: false });
    writeFileSync(join(dir, "approval.json"), record(sha("v1")));
    expect(await readApproval(dir, sha("v1"))).toEqual({
      recorded: true, matches: true, reviewer: "Dr Example", reviewed_at: "2026-10-30T09:00:00Z",
    });
    expect(await readApproval(dir, sha("v2"))).toMatchObject({ recorded: true, matches: false });
    writeFileSync(join(dir, "approval.json"), "{not json");
    expect(await readApproval(dir, sha("v1"))).toEqual({ recorded: false, matches: false });
    writeFileSync(join(dir, "approval.json"), JSON.stringify({ schema: "other/9", bundle_sha256: sha("v1") }));
    expect(await readApproval(dir, sha("v1"))).toEqual({ recorded: false, matches: false });
    expect(await readApproval(null, null)).toEqual({ recorded: false, matches: false });
  });

  it("a started lesson reports the approval bound to its exact lesson.json; validated keeps its meaning", async () => {
    const root = mkdtempSync(join(tmpdir(), "approval-host-")); dirs.push(root);
    mkdirSync(join(root, "course"));
    const text = JSON.stringify(atomistique({ selfStudy: true }));
    writeFileSync(join(root, "course", "lesson.json"), text);
    writeFileSync(join(root, "course", "approval.json"), record(sha(text)));
    const started = await new SessionHost({ bundlesRoot: root, live: false }).create("course/lesson.json");
    expect(started.authoring.approval).toEqual({
      recorded: true, matches: true, reviewer: "Dr Example", reviewed_at: "2026-10-30T09:00:00Z",
    });
    expect(started.authoring.validated).toBe(false); // the SELF-STUDY validated_by still says not validated
    writeFileSync(join(root, "course", "lesson.json"), text + "\n"); // edited after approval
    const again = await new SessionHost({ bundlesRoot: root, live: false }).create("course/lesson.json");
    expect(again.authoring.approval).toMatchObject({ recorded: true, matches: false });
  });
});
