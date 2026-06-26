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
// The learner authors EXACTLY ONE schema-pure Scene — an unmodified member of
// the canonical Scene discriminated union. The /studio form supports the three
// active-learning scene types a learner can author: quiz | spot_the_flaw |
// explain_back. The network calls below are the ONLY ones the form makes:
//   - validateLearnerScene -> POST /learner-items/validate (no write; badge)
//   - submitLearnerItem     -> POST /learner-items (creates a 'submitted' item)
//   - submitPeerReview      -> POST /learner-items/{id}/peer-review (Workflow B)
//
// PRIVACY: free text (question/choices/flawed content/key points/feedback) is sent to scene-synth on a
// debounced VALIDATE (for the badge) and on the explicit Submit; no learner-item is CREATED until
// Submit, and it is never routed to telemetry — only to validation + the moderation queue.
// The form NEVER publishes — review_state stays 'submitted';
// publishing happens ONLY through the teacher's approve in the moderation queue
// (rule-003).
// --------------------------------------------------------------------------- //

export type QuizChoice = { id: string; text: string; correct: boolean };

// Shared rubric (AICritiqueRubric mirror) used by the active-learning scenes.
export type Rubric = {
  completeness: number;
  evidence_quality: number;
  tone: number;
};

// Common fields every scene carries (mirror of SceneBaseSchema, minus the
// optional render_assets the form does not author).
type SceneBase = {
  id: string;
  title: string;
  objective_refs: string[];
  concept_refs: string[];
  estimated_seconds: number;
  adaptation_hooks: string[];
};

// Schema-pure QuizScene (mirrors QuizSceneSchema in @studium/lesson-bundle-schema).
// exactly-one-correct is NOT in the schema — enforced client-side (see studio).
export type QuizScene = SceneBase & {
  type: "quiz";
  question: string;
  choices: QuizChoice[];
  feedback_correct: string;
  feedback_incorrect: string;
  hints: string[];
};

// A planted (flawed) assertion + the >=1 expected-flaw keywords the scorer
// matches (FlawClaim). The answer key — never rendered pre-answer.
export type FlawClaim = { id: string; text: string; flaws_expected: string[] };

// spot_the_flaw — learner reads a deliberately-flawed mini-lesson and names what
// is wrong. `claims` + `model_correction` are reveals (post-answer only).
export type SpotTheFlawScene = SceneBase & {
  type: "spot_the_flaw";
  flawed_content: string;
  claims: FlawClaim[];
  model_correction: string;
  rubric: Rubric;
};

// A key idea + the >=1 cue phrases the coverage scorer matches (KeyPoint).
export type KeyPoint = { id: string; text: string; cues: string[] };

// explain_back — teach-back: learner explains a concept in their own words.
// `key_points` + `model_explanation` are reveals (post-answer only).
export type ExplainBackScene = SceneBase & {
  type: "explain_back";
  prompt: string;
  key_points: KeyPoint[];
  model_explanation: string;
  rubric: Rubric;
};

// The Scene union the form can author + submit. The backend accepts the FULL
// canonical Scene union; the form exposes the three learner-authorable types.
export type Scene = QuizScene | SpotTheFlawScene | ExplainBackScene;
export type SceneType = Scene["type"];

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
  scene: Scene;
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
  scene: Scene,
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
  scene: Scene;
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

// Workflow B — a peer rating on a submitted item. course_id MUST be the demo
// course. passed=did the peer judge the item usable; rating 1..5; helpful=free
// signal. The backend owns the aggregation/promotion; this is a thin POST.
export type PeerReviewResponse = {
  item_id: string;
  review_count: number;
  review_state: LearnerItemView["review_state"];
};

// Workflow B — discovery: the peer-testing queue. Lists the items a classmate
// may TAKE and rate. The peer only ever sees 'submitted' items, never the
// author identity (the server returns the client-safe LearnerItemView, which
// OMITS author_pseudonym). course MUST be the demo course.
export async function listSubmittedItems(args: {
  course: string;
  state?: LearnerItemView["review_state"];
}): Promise<LearnerItemView[]> {
  const params = new URLSearchParams({ course: args.course });
  // The peer queue is the 'submitted' state; callers may override (e.g. for a
  // wider discovery view) but default to the moderation-pending set.
  params.set("state", args.state ?? "submitted");
  const resp = await fetch(
    `${SCENE_SYNTH_URL}/learner-items?${params.toString()}`,
    { method: "GET" }
  );
  if (!resp.ok) throw new Error(`List failed: ${resp.status} ${await resp.text()}`);
  const body = (await resp.json()) as { items: LearnerItemView[] };
  return body.items;
}

export async function submitPeerReview(args: {
  itemId: string;
  passed: boolean;
  rating: 1 | 2 | 3 | 4 | 5;
  helpful: boolean;
}): Promise<PeerReviewResponse> {
  const resp = await fetch(
    `${SCENE_SYNTH_URL}/learner-items/${encodeURIComponent(args.itemId)}/peer-review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passed: args.passed,
        rating: args.rating,
        helpful: args.helpful,
      }),
    }
  );
  if (!resp.ok) throw new Error(`Peer review failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}
