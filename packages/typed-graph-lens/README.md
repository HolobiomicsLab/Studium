English · [Français](README.fr.md)

# @studium/typed-graph-lens

Turns a typed graph with live per-node state into something a viewer can draw. The core is project-agnostic: a normalized `GraphView`, a conversion to Cytoscape elements, a style registry and an "ego" filter that shows a learner only the frontier of what they know. A separate adapter maps a Studium learning workflow graph plus live mastery to a `GraphView`, so a learner sees which concepts are mastered, available or still locked.

## Where it sits

[`@studium/lesson-session-host`](../lesson-session-host/README.md) builds the view behind the `get_workflow_graph` tool; the VS Code extension draws it in its graph pane. See [architecture](../../docs/develop/architecture.md).

## Public API

Main entry, [src/index.ts](src/index.ts) (no project dependencies):

| Export | Purpose |
|---|---|
| `GraphViewSchema` / `GraphView`, `GraphNodeSchema`, `GraphEdgeSchema`, `NodeStateSchema` | The interchange (`schema: "typed-graph-lens/1.0"`); node states `locked`, `available`, `in_progress`, `current`, `mastered`, `neutral`. |
| `diffStates(prev, next)` / `StateDelta` | The per-node state changes between two views, for animation. |
| `toCytoscape(view)` | Plain Cytoscape elements with classes; no Cytoscape dependency. |
| `buildStylesheet(registry?)`, `DEFAULT_REGISTRY`, `cssSafe` | A Cytoscape stylesheet from a type-to-style registry. |
| `egoFilter(view)` | The learner view: reachable nodes plus locked nodes one prerequisite away. |

Studium adapter, `@studium/typed-graph-lens/adapters/studium` ([src/adapters/studium.ts](src/adapters/studium.ts)):

| Export | Purpose |
|---|---|
| `lwgToGraphView(lwg, statuses, opts?)` | A learning workflow graph and per-concept `{ mastery, attempts }` to a `GraphView`. |
| `ConceptStatus`, `LwgViewOptions` | Input and options (`theta`, `minAttempts`, `masteredPosterior`, `title`). |

## Example

```ts
import { egoFilter, toCytoscape, buildStylesheet } from "@studium/typed-graph-lens";
import { lwgToGraphView } from "@studium/typed-graph-lens/adapters/studium";
import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";

declare const lwg: LearningWorkflowGraph;
const view = lwgToGraphView(lwg, { mean: { mastery: 0.86, attempts: 3 }, variance: { mastery: 0.4, attempts: 1 } });
const { nodes, edges } = toCytoscape(egoFilter(view));
const style = buildStylesheet();
```

## Invariants

- A concept shows as mastered only with both the posterior (0.8 by default) and the attempt floor (3 by default), matching the engine's certification.
- `prerequisite_for` edges are reversed for display, so arrows point from prerequisite to dependent.
- The main entry pulls in no Studium package; only the adapter subpath depends on the engine and the graph schema.

## Test

```bash
pnpm --filter @studium/typed-graph-lens test
```

## Depends on / used by

- Depends on: `zod`; the adapter also on `@studium/learning-workflow-schema`, `@studium/adaptation-engine`, `@studium/learner-state`.
- Used by: `@studium/lesson-session-host`, `apps/studium-vscode`.

## Status

Active. Private workspace package, not published to npm.
