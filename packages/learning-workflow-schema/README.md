English · [Français](README.fr.md)

# @studium/learning-workflow-schema

Defines the learning workflow graph (LWG) of a course: concept nodes, task nodes (the scenes that assess them) and typed edges between them. It ships as a Zod schema for TypeScript and a Pydantic mirror for the Python planner. The graph is what lets a lesson send a learner back to an unmet prerequisite instead of only replaying the same question.

## Where it sits

A lesson bundle may carry a graph in its `learning_workflow_graph` field ([`@studium/lesson-bundle-schema`](../lesson-bundle-schema/README.md)). [`@studium/adaptation-engine`](../adaptation-engine/README.md) routes over it and [`@studium/typed-graph-lens`](../typed-graph-lens/README.md) draws it. See [architecture](../../docs/develop/architecture.md).

## Public API

From [src/index.ts](src/index.ts):

| Export | Purpose |
|---|---|
| `LearningWorkflowGraphSchema` / `LearningWorkflowGraph` | `schema_version: "1.0"`, `course_id`, `nodes`, `edges`. |
| `ConceptNodeSchema`, `TaskNodeSchema`, `GraphNodeSchema` | Nodes discriminated by `node_kind` (`concept` or `task`). |
| `GraphEdgeSchema`, `EdgeRelationSchema` | Relations `prerequisite_for`, `part_of`, `decomposes_into`, `assesses`, `aligns_with`, with optional evidence. |
| `GraphEvidenceSchema` | DOI, quote, page and confidence backing an edge. |
| `BloomLevelSchema`, `KnowledgeDimensionSchema`, `SceneTypeSchema` | Shared vocabularies. |
| `WorkflowCharacterizationSchema`, `SuterAxesSchema`, `ReproducibilityTierSchema`, `TaskOpennessSchema` | Optional description of a task's computational workflow. |
| `validateGraph(data)` | Returns `{ valid, errors }` with readable `path message` strings. |

Python: `learning_workflow_schema` in [python/](python/learning_workflow_schema/__init__.py) exposes the same models and `validate_graph(data)`.

## Example

```ts
import { validateGraph } from "@studium/learning-workflow-schema";

const result = validateGraph({
  schema_version: "1.0",
  course_id: "intro-stats",
  nodes: [
    { id: "mean", node_kind: "concept", title: "Mean", bloom_level: "understand" },
    { id: "variance", node_kind: "concept", title: "Variance", bloom_level: "apply" },
  ],
  edges: [{ id: "e1", relation: "prerequisite_for", source: "variance", target: "mean" }],
});
result.valid; // true
```

## Invariants

- `prerequisite_for` reads "source depends on target": `source` is the dependent concept, `target` its prerequisite. Reverse an edge written in the natural reading of the name.
- Node and edge ids are unique, and every edge endpoint must name a declared node; a dangling edge fails validation.
- The TypeScript and Python models are kept equal by hand; change both together.

## Test

```bash
pnpm --filter @studium/learning-workflow-schema test
.venv/bin/python -m pytest packages/learning-workflow-schema -q
```

## Depends on / used by

- Depends on: `zod` (TypeScript), `pydantic` (Python).
- Used by: `@studium/lesson-bundle-schema`, `@studium/adaptation-engine`, `@studium/lesson-session`, `@studium/typed-graph-lens`; the Python mirror by `services/planner`.

## Status

Active, schema version 1.0. Private workspace package, not published to npm.
