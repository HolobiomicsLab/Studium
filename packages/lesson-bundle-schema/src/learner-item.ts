import { z } from "zod";
import { SceneSchema } from "./scenes";

// ---------------------------------------------------------------------------
// LAItemEnvelope — the "learner-as-author" governance wrapper (plan §"Data model").
//
// CORE INVARIANT (the spine): the learner authors EXACTLY ONE `scene`, kept
// SCHEMA-PURE (an unmodified member of the `Scene` discriminated union), so it
// round-trips through the existing `LessonBundle` contract and the unchanged
// runtime/graders with ZERO new runtime code. ALL authoring/governance/peer
// metadata lives OUTSIDE the scene, here in this sibling envelope — never
// inside the Scene body.
//
// PRIVACY: `author_pseudonym` is an HMAC, SERVER-ONLY. It MUST NEVER appear in
// any emitted/distributed bundle (it is asserted-scrubbed from lesson.json and
// prov.json on approve). It survives only in the ledger (as `prior_author`).
// `peer_signals` are ledger-only scalars/enums, k-suppressed in any view, and
// never routed to telemetry.
// ---------------------------------------------------------------------------

// Forward-only lifecycle. Learner endpoints can ONLY ever write `submitted`;
// every later state is reachable only through the teacher's `decide_item()`.
export const LAReviewStateSchema = z.enum([
  "submitted",
  "peer_review",
  "revision_requested",
  "approved",
  "published",
  "rejected",
]);
export type LAReviewState = z.infer<typeof LAReviewStateSchema>;

// A coarse, enum-only moderation reason (free text never leaves the backend).
export const LAReviewNoteCodeSchema = z.enum([
  "factual_error",
  "ambiguous_distractor",
  "off_topic",
  "ok",
]);
export type LAReviewNoteCode = z.infer<typeof LAReviewNoteCodeSchema>;

// Mirror of scene-synth `validate_scene()` verdict ({ok, errors, validator_version}).
export const LAValidationSchema = z.object({
  ok: z.boolean(),
  validator_version: z.string().min(1),
  errors: z.array(z.string()),
});
export type LAValidation = z.infer<typeof LAValidationSchema>;

// RESERVED for the P3 peer-review loop. Ledger-only aggregate; k-suppressed in
// any teacher view. Kept optional so P1/P2 envelopes need not carry it.
export const LAPeerSignalsSchema = z.object({
  n_tests: z.number().int().nonnegative(),
  n_ratings: z.number().int().nonnegative(),
  mean_rating: z.number(),
  helpful_votes: z.number().int().nonnegative(),
});
export type LAPeerSignals = z.infer<typeof LAPeerSignalsSchema>;

export const LAItemEnvelopeSchema = z.object({
  item_id: z.string().min(1),
  course_id: z.string().min(1),
  target_bundle_ref: z.string().min(1),
  schema_version: z.literal("1.4"),
  // SCHEMA-PURE: a verbatim member of the Scene discriminated union. No
  // learner/envelope keys may leak into this body.
  scene: SceneSchema,
  // HMAC, SERVER-ONLY — NEVER distributed in any emitted bundle.
  author_pseudonym: z.string().min(1),
  prior_author: z.string().optional(),
  created_at: z.string().datetime(), // ISO-Z, passed-in (never now())
  review_state: LAReviewStateSchema,
  reviewed_by: z.string().optional(), // teacher IRI
  reviewed_at: z.string().datetime().optional(), // ISO-Z, passed-in
  review_note_code: LAReviewNoteCodeSchema.optional(),
  validation: LAValidationSchema,
  peer_signals: LAPeerSignalsSchema.optional(), // RESERVED (P3); ledger-only
  published_bundle_ref: z.string().optional(), // file:// of the emitted community bundle
});

export type LAItemEnvelope = z.infer<typeof LAItemEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Forward-only transition table (plan §"Data model"). The authoritative copy
// lives in the Python ledger (learner_items_store.py); this mirror lets TS
// callers (and the deferred React moderation queue) reason about legal next
// states without re-deriving them. `revision_requested` is terminal here
// because a revision is a NEW item_id, not an in-place transition.
// ---------------------------------------------------------------------------
export const LA_LEGAL_TRANSITIONS: Readonly<Record<LAReviewState, readonly LAReviewState[]>> =
  Object.freeze({
    submitted: ["peer_review", "approved", "rejected", "revision_requested"],
    peer_review: ["approved", "rejected", "revision_requested"],
    revision_requested: [],
    approved: ["published"],
    published: [],
    rejected: [],
  });

export function laTransitionAllowed(from: LAReviewState, to: LAReviewState): boolean {
  return LA_LEGAL_TRANSITIONS[from].includes(to);
}
