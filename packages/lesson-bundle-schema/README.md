English · [Français](README.fr.md)

# @studium/lesson-bundle-schema

The contract of a playable lesson. A lesson bundle (`lesson.json`) holds the concepts, the scenes, the adaptation rules, who validated it, and optionally an assessment blueprint, a learning workflow graph and alternative "universes". This package defines it as Zod schemas, with a Pydantic mirror for the Python tools, and turns validation failures into messages an author can act on. The field-by-field reference is in [lesson bundle reference](../../docs/reference/lesson-bundle.md).

## Where it sits

Everything that reads or writes a lesson goes through it: the session ([`@studium/lesson-session`](../lesson-session/README.md)), the host and its conversational author ([`@studium/lesson-session-host`](../lesson-session-host/README.md)), and on the Python side `tools/experience_packet.py`. See [architecture](../../docs/develop/architecture.md).

## Public API

From [src/index.ts](src/index.ts):

| Export | Purpose |
|---|---|
| `LessonBundleSchema` / `LessonBundle`, `SCHEMA_VERSION` | The whole bundle; the current version is `"1.4"`. |
| `BundleMetadataSchema`, `BundleAuthoringSchema`, `AuthoringModeSchema`, `DraftedBySchema` | Title, language, duration; who wrote the lesson (`teacher` or `self_study`) and who drafted its keys (`agent`, `learner`, `teacher`). |
| `SceneSchema`, `SceneTypeSchema` and one schema per scene type | 13 scene types, from `intro` and `quiz` to `spot_the_flaw`, `explain_back` and `communication_sim` (see [scene types](../../docs/concepts/scene-types.md)). |
| `EvidenceSchema`, `BibliographicRefSchema` | Sources a scene cites, with exact quotes. |
| `AdaptationRuleSchema`, `RuleConditionSchema`, `RuleActionSchema` | Rules the adaptation engine applies. |
| `MODULATORS`, `ACTIVE_MODULATORS`, `ModulatorSchema` | The modulator registry; a rule may only name an active one (M1, M3, M6). See [modulators](../../docs/concepts/modulators.md). |
| `AssessmentBlueprintSchema` | What the lesson claims to measure, by dimension. |
| `CourseSchema`, `nextCourseLesson`, `isCourseComplete` | An ordered set of lessons with prerequisites. |
| `LAItemEnvelopeSchema`, `laTransitionAllowed` | Review envelope for a scene a learner authored. |
| `sceneRenderAssets` | The render assets (formulas, diagrams, molecules) a scene uses. |
| `formatBundleError` / `BundleIssue` | A `ZodError` as `{ path, message, hint }` items. |

Python: `lesson_bundle_schema` in [python/](python/lesson_bundle_schema/__init__.py), same `SCHEMA_VERSION`.

## Example

```ts
import { readFileSync } from "node:fs";
import { LessonBundleSchema, formatBundleError } from "@studium/lesson-bundle-schema";

const raw: unknown = JSON.parse(readFileSync("lesson.json", "utf8"));
const parsed = LessonBundleSchema.safeParse(raw);
if (!parsed.success) {
  for (const issue of formatBundleError(parsed.error, raw)) console.log(`${issue.path}: ${issue.message} (${issue.hint})`);
}
```

## Invariants

- `metadata.authoring` is optional for bundles written before it existed; readers treat an absent block as teacher-authored.
- Answer keys (choices marked correct, key points, model answers, planted flaws) live in the bundle. Hosts must redact them before showing a scene; that is done in `lesson-session-host`, not here.
- Validation is structural. Authoring checks (unfilled placeholders, one correct choice per quiz, self-study notices) are the job of `node tools/bundle_lint.mjs <lesson.json>`.
- The Zod and Pydantic models are kept equal by hand; change both together.

## Test

```bash
pnpm --filter @studium/lesson-bundle-schema test
.venv/bin/python -m pytest packages/lesson-bundle-schema -q
```

## Depends on / used by

- Depends on: `zod`, `@studium/learning-workflow-schema`; `pydantic` for the mirror.
- Used by: `@studium/adaptation-engine`, `@studium/lesson-session`, `@studium/lesson-session-host`, `apps/student-runtime`; the mirror by `tools/experience_packet.py` and `services/scene-synth` tests.

## Status

Active, schema version 1.4. Private workspace package, not published to npm.
