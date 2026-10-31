English · [Français](README.fr.md)

# @studium/lesson-plan-schema

The lesson plan, version 1: what the planner produces before any scene is written. A plan lists learning objectives, scene outlines, concepts and corpus references, and carries a critic score and a status (`draft`, `critic_reviewed`, `approved`). The contract is a JSON Schema ([src/schema.json](src/schema.json)) with TypeScript types and a Pydantic mirror.

## Where it sits

Upstream of the lesson bundle: the Python planner (`services/planner`) and the composition tools build a plan, then a lesson bundle ([`@studium/lesson-bundle-schema`](../lesson-bundle-schema/README.md)) is written from it. See [architecture](../../docs/develop/architecture.md) and the tutorial [from literature to a course](../../docs/tutorials/literature-to-course.md).

## Public API

From [src/index.ts](src/index.ts):

| Export | Purpose |
|---|---|
| `LessonPlan` | The plan type (`schema_version: "1.0"`, objectives, `scene_outlines`, `corpus_refs`, `status`). |
| `LearningObjective`, `SceneOutline`, `Concept`, `CorpusRef` | Parts of a plan. |
| `Evidence`, `BibliographicRef`, `CaseStudy`, `ABSAsset`, `EnrichmentMetadata` | Literature evidence attached to outlines. |
| `validatePlan(data)` | Ajv validation against the JSON Schema; returns `{ valid, errors }`. |
| `loadSchema()` | The JSON Schema object. |

Python: `lesson_plan_schema` in [python/](python/lesson_plan_schema/__init__.py) exposes `LessonPlan` and its parts as Pydantic models.

## Example

```ts
import { readFileSync } from "node:fs";
import { validatePlan } from "@studium/lesson-plan-schema";

const { valid, errors } = validatePlan(JSON.parse(readFileSync("plan.json", "utf8")));
if (!valid) console.error(errors.join("\n"));
```

## Invariants

- The package exports its compiled `dist/`; run `pnpm --filter @studium/lesson-plan-schema build` before importing it from another package.
- Ajv runs in strict mode: an unknown keyword in the schema is an error, not a silent pass.
- The JSON Schema, the TypeScript types and the Pydantic models are kept equal by hand; change all three together.

## Test

```bash
pnpm --filter @studium/lesson-plan-schema test
.venv/bin/python -m pytest packages/lesson-plan-schema -q
```

## Depends on / used by

- Depends on: `ajv` (TypeScript), `pydantic` (Python).
- Used by: the Python mirror in `services/planner`, `tools/compose_lesson.py`, `tools/experience_packet.py` and `services/scene-synth` tests. No TypeScript package imports it today.

## Status

Active on the Python side, schema version 1.0. Private workspace package, not published to npm.
