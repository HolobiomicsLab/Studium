// The exportable record behind the learner's concept map: the map itself, the steps of the session
// with who assessed each answer and how the session routed after it, and, for every scene, what its
// content rests on (the passages cited, where they come from, who wrote the key), and, for every
// answer, the day it was given, the hints taken before it and whether the learner then rated their
// own recall (`evidence`, read by the panel's map view, INT-STUDIUM-058 § 2.7), with the learner's
// contests and what their check questions showed (`contest`). It is the declared
// artifact that tools/concept_map_report.py wraps in an ASTRA document, an ARA trace and an
// interactive page. It carries no learner identifier and none of the learner's words.
//
// A passage's quote can state the key of the question that cites it, so a quote is recorded only for
// a scene the learner was served and has left (the rule the verdict follows, I-2). The title and the
// origin of a source are recorded for every scene.
import type { LessonBundle, Scene } from "@studium/lesson-bundle-schema";
import type { AnswerFact, LearnerPath, PathStep } from "@studium/lesson-session";
import type { AuthoringBlock } from "./authoring.js";
import { CONVERSATION_PROVENANCE_PREFIX } from "./authoring-draft/build.js";
import { calendarDate } from "./calendar.js";
import type { ConceptMap } from "./concept-map.js";
import type { RecordContest } from "./contest.js";
import { keyClassOf, type KeyClass } from "./key-class.js";
import { citedReferences, referenceUrl, type CitedReference } from "./public-scene.js";

export const CONCEPT_MAP_RECORD_SCHEMA = "studium/concept-map-record/v1";

/** Where a cited passage comes from. `document`: a source with no web address (a file, pasted text). */
export type RecordSourceOrigin = "conversation" | "web" | "doi" | "document";

export interface RecordSource {
  title: string;
  origin: RecordSourceOrigin;
  url?: string;
  license?: string;
  /** The exact passage; present only once the learner has left the scene that cites it. */
  quote?: string;
}

export interface RecordScene {
  scene_id: string;
  title: string;
  type: string;
  concept_ids: string[];
  /** Who can assess an answer to this scene: nobody, the author's key, a production reference, a run. */
  key_class: KeyClass | null;
  /** Served at least once in this session. */
  served: boolean;
  /** The learner was served this scene and has left it: its passages are quoted. */
  passages_released: boolean;
  sources: RecordSource[];
}

export interface RecordStep {
  step: number;
  scene_id: string;
  concept_id: string | null;
  answered: boolean;
  correct: boolean | null;
  assessed_by: NonNullable<PathStep["assessed_by"]> | null;
  navigation: NonNullable<PathStep["navigation"]> | null;
}

/** One answered step of `path`, by `step`: the calendar day of the answer in the server's time zone,
 * the hints taken on that visit before answering, and whether the learner then rated their own recall
 * (a rating made before a server restart is no longer known after it). */
export interface RecordEvidence { step: number; scene_id: string; day: string; hints: number; self_rated: boolean }

export interface ConceptMapRecord {
  schema: typeof CONCEPT_MAP_RECORD_SCHEMA;
  generated_at: string;
  lesson: { bundle_id: string; title: string; language: string; lesson_sha256: string | null };
  authoring: {
    mode: string;
    drafted_by: AuthoringBlock["drafted_by"];
    /** A teacher validated the bundle (its `validated_by` is not a draft or self-study placeholder). */
    validated: boolean;
    /** A judge model assessed production answers in this session. */
    judge: boolean;
    approval: { recorded: boolean; matches: boolean };
    /** At least one passage is an excerpt of a conversation with an AI assistant. */
    from_conversation: boolean;
  };
  session: { completed: boolean; steps: number };
  map: ConceptMap;
  scenes: RecordScene[];
  path: RecordStep[];
  evidence: RecordEvidence[];
  /** The learner's contests (contest.ts): the one under way, what can be contested now, those settled. */
  contest: RecordContest;
}

export interface ConceptMapRecordInput {
  bundle: Pick<LessonBundle, "bundle_id" | "metadata" | "scenes">;
  map: ConceptMap;
  path: LearnerPath;
  /** One fact per answered step of the path (LessonSession.answerFacts). */
  answers: readonly AnswerFact[];
  /** The zone the days of `evidence` are counted in (the server's, as get_server_info names it). */
  timeZone: string;
  contest: RecordContest;
  authoring: AuthoringBlock;
  /** The scene on screen; null once the lesson is complete. */
  currentSceneId: string | null;
  /** Scenes whose passages the session still holds back (answered, not left). */
  withheldSceneIds: ReadonlySet<string>;
  completed: boolean;
  lessonSha256: string | null;
  generatedAt: string;
}

const conceptIdsOf = (scene: Scene): string[] =>
  ("concept_refs" in scene && Array.isArray(scene.concept_refs) ? scene.concept_refs.filter((id) => id !== "") : []);

function originOf(reference: CitedReference): RecordSourceOrigin {
  const derived = reference.prov_derived_from ?? "";
  if (derived.startsWith(CONVERSATION_PROVENANCE_PREFIX)) return "conversation";
  if (/^https?:\/\//.test(derived)) return "web";
  return reference.doi ? "doi" : "document";
}

function sourceOf(reference: CitedReference, withQuote: boolean): RecordSource {
  const source: RecordSource = { title: reference.title, origin: originOf(reference) };
  const url = referenceUrl(reference);
  if (url) source.url = url;
  if (reference.license) source.license = reference.license;
  if (withQuote && reference.excerpt) source.quote = reference.excerpt;
  return source;
}

/** The record of one session's concept map. Pure: the host supplies the session facts. */
export function buildConceptMapRecord(input: ConceptMapRecordInput): ConceptMapRecord {
  const { bundle, path, authoring } = input;
  const served = new Set(path.steps.map((step) => step.scene_id));
  const sceneById = new Map(bundle.scenes.map((scene) => [scene.id, scene]));
  const scenes = bundle.scenes.map((scene): RecordScene => {
    const released = input.completed
      || (served.has(scene.id) && scene.id !== input.currentSceneId && !input.withheldSceneIds.has(scene.id));
    return {
      scene_id: scene.id, title: scene.title, type: scene.type, concept_ids: conceptIdsOf(scene),
      key_class: keyClassOf(scene.type), served: served.has(scene.id), passages_released: released,
      sources: citedReferences(scene).map((reference) => sourceOf(reference, released)),
    };
  });
  return {
    schema: CONCEPT_MAP_RECORD_SCHEMA,
    generated_at: input.generatedAt,
    lesson: {
      bundle_id: bundle.bundle_id, title: bundle.metadata.title, language: bundle.metadata.language,
      lesson_sha256: input.lessonSha256,
    },
    authoring: {
      mode: authoring.mode, drafted_by: authoring.drafted_by, validated: authoring.validated, judge: authoring.judge,
      approval: { recorded: authoring.approval.recorded, matches: authoring.approval.matches },
      from_conversation: scenes.some((scene) => scene.sources.some((source) => source.origin === "conversation")),
    },
    session: { completed: input.completed, steps: path.steps.length },
    map: input.map,
    scenes,
    path: path.steps.map((step): RecordStep => {
      const scene = sceneById.get(step.scene_id);
      return {
        step: step.step, scene_id: step.scene_id, concept_id: (scene ? conceptIdsOf(scene)[0] : undefined) ?? null,
        answered: step.answered, correct: step.correct,
        assessed_by: step.assessed_by ?? null, navigation: step.navigation ?? null,
      };
    }),
    evidence: input.answers.map((fact): RecordEvidence => ({
      step: fact.step, scene_id: fact.scene_id, day: calendarDate(Date.parse(fact.at), input.timeZone),
      hints: fact.hints, self_rated: fact.self_rated,
    })),
    contest: input.contest,
  };
}
