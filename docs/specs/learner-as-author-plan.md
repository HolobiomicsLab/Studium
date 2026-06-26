# Plan — Learner-as-author MVP (LAItem), backend-first + generalized

Status: **approved scope, implementing** (2026-06-26). Derived from a design workflow
(explore → 4 proposals → judged → synthesized) + user scope decisions.

## Decisions (locked)

- **Backend-first**, but **generalized to the full `Scene` union** (not quiz-only): a learner can
  author a `quiz`, `spot_the_flaw`, or `explain_back` scene. The two React UIs (author-web `/studio`
  form + teacher-dashboard `/submissions` queue) are **deferred** to a later pass; when built they go
  **two-app** (form in author-web, moderation queue in teacher-dashboard). This pass is driven by
  drivers/CLI + tests only.
- **Include the peer-review loop** (Fayol/Ciussi): peers test + rate a submitted item; ratings
  aggregate (k-anonymous) into an item-quality signal. Peer signals live **in the ledger envelope**,
  NOT in telemetry — so **no new ADR-006 telemetry event** is needed.
- **Surfacing = separate community bundle + multi-bundle discovery.** An approved scene is emitted as a
  single-scene "community" bundle into the bundles root; the loader learns to **discover multiple
  bundles per course**. The canonical course `lesson.json` is **never mutated** (stays immutable).
- **Rule 003 is enforced by NEW code** (`decide_item()`), not existing infra: the audit confirmed
  `approve_course` is hard-coupled to `.lwg` JSON-LD claim graphs and `validated_by` is only
  `min_length=3` (does not verify a teacher IRI). `decide_item()` is the SOLE publish path and gets
  dedicated tests.
- Minor defaults: teacher IRI = course-token-derived; HMAC pseudonym secret = scene-synth env var
  (prototype); demo course context hardcoded to `atomistique-l1`.

## Core invariant (the spine)

The learner authors **exactly one `Scene`**, kept **schema-pure** (an unmodified member of the
`Scene` discriminated union), so it round-trips through the existing `extra=forbid` `LessonBundle`
contract and the unchanged runtime/graders with **zero new runtime code**. All
authoring/governance/peer metadata lives **outside** the scene, in a sibling `LAItemEnvelope`.

The learner endpoints can ONLY write `review_state='submitted'`. Surfacing happens **exclusively** in
the approve branch of `decide_item()`. A submitted/rejected item is unreachable by `resolveBundle`
because no bundle file exists for it.

## Data model — `LAItemEnvelope`

Thin wrapper; the `scene` body stays schema-pure.

```
{
  item_id: uuid
  course_id: string
  target_bundle_ref: string        // the .json/.zip where the concept lives
  schema_version: "1.4"
  scene: Scene                      // verbatim, discriminated-union validated (quiz | spot_the_flaw | explain_back)
  author_pseudonym: string         // HMAC, server-only, NEVER distributed
  prior_author?: string            // set on approve (mirrors approval.py prior_assertions)
  created_at: string               // ISO-Z, passed-in (never now())
  review_state: "submitted" | "peer_review" | "revision_requested" | "approved" | "published" | "rejected"
  reviewed_by?: string             // teacher IRI
  reviewed_at?: string             // ISO-Z, passed-in
  review_note_code?: "factual_error" | "ambiguous_distractor" | "off_topic" | "ok"
  validation: { ok: bool, validator_version: string, errors: string[] }
  peer_signals?: { n_tests: int, n_ratings: int, mean_rating: number, helpful_votes: int }  // ledger-only, k-suppressed in any view
  published_bundle_ref?: string    // file:// of the emitted community bundle
}
```

Storage: append-only `learner_items.jsonl` per course (each line = latest snapshot for an `item_id`;
history reconstructable), paralleling the `approval.json` sidecar.

Legal transitions ONLY:
`submitted → {peer_review, approved, rejected, revision_requested}`;
`peer_review → {approved, rejected, revision_requested}`;
`revision_requested → (new item_id)`; `approved → published` (auto on successful bundle build).
Illegal transitions raise.

## Phase breakdown (this implementation; UIs deferred)

**Workflow A — backend core (P0–P2):**
- **P0 `validate_scene()`** — factor a pure `validate_scene(scene_dict, *, course_concept_ids)` out of
  `bundler.build_bundle`: `TypeAdapter(Scene).validate_python` (same contract as the full bundle) +
  custom checks (quiz: exactly-one-correct — confirmed NOT in schema; all types: `concept_refs ⊆
  course concepts`). Returns `{ok, errors[], validator_version}`. `build_bundle` keeps calling it so
  single- and full-bundle validation never diverge. **TDD (rule 002): red tests first.**
  Files: `services/scene-synth/bundler.py`, `services/scene-synth/scene_synth_schemas.py`,
  `services/scene-synth/tests/test_validate_scene.py`.
- **P1 `LAItemEnvelope` + ledger** — Zod in `packages/lesson-bundle-schema/src/learner-item.ts`
  (re-export from `index.ts`) + Pydantic mirror in
  `packages/lesson-bundle-schema/python/lesson_bundle_schema/__init__.py` (dual-path, rule 002) +
  append-only `services/scene-synth/learner_items_store.py` with the transition table. **Scope-purity
  test**: `envelope.scene` round-trips through the UNMODIFIED bundler (no learner keys leak into the
  Scene). Files incl. `tests/learner-item.test.ts`, `tests/test_learner_items_store.py`.
- **P2 endpoints + `decide_item()`** — `services/scene-synth/scene_synth_app.py`: POST
  `/learner-items/validate`, POST `/learner-items` (stage submitted + HMAC pseudonym), GET
  `/learner-items?course=&state=`, POST `/learner-items/{id}/decide`. `decide_item()` in
  `learner_review.py` mirrors `approve_course` INVARIANTS (approve needs non-empty reviewer +
  passed-in `reviewed_at` as `ValueError`s before mutation; idempotent; `prior_author` preserved). On
  approve: synthesize a minimal single-concept plan → `build_bundle` into the bundles root,
  `validated_by`=teacher IRI; assert `author_pseudonym` in NEITHER `lesson.json` NOR `prov.json`. Add
  CORS (confirmed absent). Files incl. `tests/test_decide_item.py`, `tests/test_learner_endpoints.py`.

**Workflow B — peer loop + discovery + e2e (P3–P5):**
- **P3 peer-review loop** — a peer takes a `submitted`/`peer_review` item and rates it; ratings
  aggregate (k-anonymous, min-raters floor) into `peer_signals` on the ledger envelope; an endpoint
  to record a peer test+rating and a teacher-facing read of aggregated signals. No telemetry event.
- **P4 multi-bundle discovery** — `packages/lesson-session-host/src/bundle-resolver.ts` (+ host)
  learn to discover community bundles per course alongside the canonical bundle (a `community/`
  subdir or a per-course `community-manifest.json`). The canonical course is never mutated.
- **P5 atomistique e2e** — driver: a learner authors the 3s radial-nodes quiz on
  `c-orbitales-formes` (radial nodes = n−ℓ−1 = 2, correct='2'), self-tests via the pure `quizGrader`,
  submits; a peer rates it; the teacher approves (UCA IRI + timestamp); a community bundle is emitted
  and resolved alongside `s3-quiz-noeuds`; a classmate is graded by the existing `quizGrader`, never
  seeing the author. `fixtures/atomistique-l1/learner_items.jsonl` + an integration test.

**Deferred (Workflow C, later):** author-web `/studio` guided form + key-free self-test preview;
teacher-dashboard `/submissions` moderation queue (two-app).

## Safety / privacy (must hold + be tested)

- `decide_item()` is the real chokepoint; learner endpoints can only write `submitted`. Approve
  requires non-empty reviewer + passed-in timestamp (ValueErrors before any mutation); idempotent;
  reject/revision leave no bundle.
- `author_pseudonym` is HMAC, server-only, asserted-scrubbed from BOTH `lesson.json` and `prov.json`
  of the distributed community bundle; survives only in the ledger as `prior_author`.
- Free text (question/choices/feedback/flawed_content/prompt…) stays on-device until the learner's
  explicit submit; routed only to the moderation backend + teacher, never into telemetry. Peer
  ratings are scalars/enums in the ledger; any teacher view is k-suppressed.
- Right-to-forget: tombstone the `item_id` in the ledger without breaking the append-only chain.
