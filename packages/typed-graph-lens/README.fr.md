[English](README.md) · Français

# @studium/typed-graph-lens

Transforme un graphe typé, avec un état vivant par nœud, en données qu'un afficheur peut dessiner. Le cœur ne dépend d'aucun projet : une vue normalisée `GraphView`, une conversion en éléments Cytoscape, un registre de styles et un filtre « ego » qui ne montre à l'apprenant que la frontière de ce qu'il sait. Un adaptateur séparé convertit un graphe de parcours Studium et la maîtrise en cours en `GraphView` : l'apprenant voit quelles notions sont maîtrisées, accessibles ou encore verrouillées.

## Place dans l'ensemble

[`@studium/lesson-session-host`](../lesson-session-host/README.fr.md) construit la vue servie par l'outil `get_workflow_graph` ; l'extension VS Code la dessine dans son panneau de graphe. Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Point d'entrée principal, [src/index.ts](src/index.ts) (sans dépendance de projet) :

| Export | Rôle |
|---|---|
| `GraphViewSchema` / `GraphView`, `GraphNodeSchema`, `GraphEdgeSchema`, `NodeStateSchema` | Le format d'échange (`schema: "typed-graph-lens/1.0"`) ; états de nœud `locked`, `available`, `in_progress`, `current`, `mastered`, `neutral`. |
| `diffStates(prev, next)` / `StateDelta` | Les changements d'état par nœud entre deux vues, pour l'animation. |
| `toCytoscape(view)` | Des éléments Cytoscape simples, avec classes ; sans dépendre de Cytoscape. |
| `buildStylesheet(registry?)`, `DEFAULT_REGISTRY`, `cssSafe` | Une feuille de style Cytoscape à partir d'un registre type vers style. |
| `egoFilter(view)` | La vue de l'apprenant : les nœuds atteignables et les nœuds verrouillés à un prérequis de distance. |

Adaptateur Studium, `@studium/typed-graph-lens/adapters/studium` ([src/adapters/studium.ts](src/adapters/studium.ts)) :

| Export | Rôle |
|---|---|
| `lwgToGraphView(lwg, statuses, opts?)` | Un graphe de parcours et, par notion, `{ mastery, attempts }` vers une `GraphView`. |
| `ConceptStatus`, `LwgViewOptions` | Entrée et options (`theta`, `minAttempts`, `masteredPosterior`, `title`). |

## Exemple

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

- Une notion n'apparaît maîtrisée qu'avec à la fois la loi a posteriori (0,8 par défaut) et le seuil de tentatives (3 par défaut), comme la certification du moteur.
- Les arêtes `prerequisite_for` sont inversées à l'affichage : les flèches vont du prérequis vers la notion qui en dépend.
- Le point d'entrée principal n'importe aucun paquet Studium ; seul le sous-chemin de l'adaptateur dépend du moteur et du schéma de graphe.

## Tests

```bash
pnpm --filter @studium/typed-graph-lens test
```

## Dépendances

- Dépend de : `zod` ; l'adaptateur aussi de `@studium/learning-workflow-schema`, `@studium/adaptation-engine`, `@studium/learner-state`.
- Utilisé par : `@studium/lesson-session-host`, `apps/studium-vscode`.

## Statut

Actif. Paquet privé de l'espace de travail, non publié sur npm.
