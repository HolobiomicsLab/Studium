export type CorpusRef = {
  ref_id: string;
  ref_type: "local_file" | "doi" | "url" | "offline";
  title?: string;
  doi?: string;
  resolved?: boolean;
};

export type IngestManifest = {
  manifest_id: string;
  target: string;
  pages_extracted: number;
  text_preview: string;
  figures_count: number;
  references: CorpusRef[];
  keywords?: string;
  extractor: string;
};

export type SceneOutline = {
  id: string;
  type: string;
  title: string;
  objective_refs: string[];
  notes?: string;
  duration_minutes?: number;
};

export type LearningObjective = {
  id: string;
  description: string;
  bloom_level: string;
};

export type LessonPlan = {
  schema_version: string;
  id: string;
  title: string;
  language: string;
  target: string;
  duration_minutes: number;
  learning_objectives: LearningObjective[];
  scene_outlines: SceneOutline[];
  corpus_refs: CorpusRef[];
  critic_score?: number;
  critic_annotations?: string[];
  status: "draft" | "critic_reviewed" | "approved";
  validated_by?: string;
  metadata?: Record<string, unknown>;
};

export type PlanResponse = {
  lesson_plan: LessonPlan;
  critic_score: number;
  critic_annotations: string[];
};

const INGEST_URL = process.env.NEXT_PUBLIC_INGEST_SERVICE_URL || "http://localhost:8000";
const PLANNER_URL = process.env.NEXT_PUBLIC_PLANNER_SERVICE_URL || "http://localhost:8001";
const SCENE_SYNTH_URL = process.env.NEXT_PUBLIC_SCENE_SYNTH_SERVICE_URL || "http://localhost:8002";

export async function ingestCorpus(
  pdf: File,
  target: string,
  bib?: File,
  keywords?: string
): Promise<IngestManifest> {
  const form = new FormData();
  form.append("pdf", pdf);
  form.append("target", target);
  if (bib) form.append("bib", bib);
  if (keywords) form.append("keywords", keywords);

  const resp = await fetch(`${INGEST_URL}/ingest/corpus`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) throw new Error(`Ingest failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export async function generatePlan(manifest: IngestManifest): Promise<PlanResponse> {
  const resp = await fetch(`${PLANNER_URL}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      manifest_id: manifest.manifest_id,
      target: manifest.target,
      corpus_refs: manifest.references,
      text_preview: manifest.text_preview,
      keywords: manifest.keywords,
    }),
  });
  if (!resp.ok) throw new Error(`Plan generation failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// --------------------------------------------------------------------------- //
// Learner-as-author (Workflow C) — scene-synth :8002.
//
// The learner authors EXACTLY ONE schema-pure QuizScene (an unmodified member
// of the Scene discriminated union). The two functions below are the ONLY
// network calls the /studio form makes:
//   - validateLearnerScene -> POST /learner-items/validate (no write; badge)
//   - submitLearnerItem     -> POST /learner-items (creates a 'submitted' item)
//
// PRIVACY: free text (question/choices/feedback) stays on-device until the
// learner's explicit Submit; only then is it routed to the moderation backend.
// The form NEVER publishes — review_state stays 'submitted'; publishing happens
// ONLY through the teacher's approve in the moderation queue (rule-003).
// --------------------------------------------------------------------------- //

export type QuizChoice = { id: string; text: string; correct: boolean };

// Schema-pure QuizScene (mirrors QuizSceneSchema in @studium/lesson-bundle-schema).
// exactly-one-correct is NOT in the schema — enforced client-side (see studio).
export type QuizScene = {
  id: string;
  type: "quiz";
  title: string;
  objective_refs: string[];
  concept_refs: string[];
  estimated_seconds: number;
  adaptation_hooks: string[];
  question: string;
  choices: QuizChoice[];
  feedback_correct: string;
  feedback_incorrect: string;
  hints: string[];
};

export type ValidateResponse = {
  ok: boolean;
  validator_version: string;
  errors: string[];
};

// Client-safe LearnerItemView (the server NEVER returns author_pseudonym).
export type LearnerItemView = {
  item_id: string;
  course_id: string;
  target_bundle_ref: string;
  schema_version: string;
  scene: QuizScene;
  review_state:
    | "submitted"
    | "peer_review"
    | "revision_requested"
    | "approved"
    | "published"
    | "rejected";
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note_code?: string | null;
  validation: ValidateResponse;
  created_at: string;
  published_bundle_ref?: string | null;
};

export async function validateLearnerScene(
  scene: QuizScene,
  courseId: string
): Promise<ValidateResponse> {
  const resp = await fetch(`${SCENE_SYNTH_URL}/learner-items/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ course_id: courseId, scene }),
  });
  if (!resp.ok) throw new Error(`Validation failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export async function submitLearnerItem(args: {
  courseId: string;
  targetBundleRef: string;
  authorHandle: string;
  createdAt: string;
  scene: QuizScene;
}): Promise<LearnerItemView> {
  const resp = await fetch(`${SCENE_SYNTH_URL}/learner-items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      course_id: args.courseId,
      target_bundle_ref: args.targetBundleRef,
      author_handle: args.authorHandle,
      created_at: args.createdAt,
      scene: args.scene,
    }),
  });
  if (!resp.ok) throw new Error(`Submit failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}
