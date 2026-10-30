[English](README.md) · Français

# @studium/learning-workflow-schema

Définit le graphe de parcours d'apprentissage (LWG, *learning workflow graph*) d'un cours : des nœuds notion, des nœuds tâche (les scènes qui évaluent ces notions) et des arêtes typées entre eux. Il existe sous forme de schéma Zod pour TypeScript et d'un miroir Pydantic pour le planificateur Python. C'est ce graphe qui permet à une leçon de renvoyer l'apprenant vers un prérequis non acquis, au lieu de simplement reposer la même question.

## Place dans l'ensemble

Un bundle de leçon peut porter un graphe dans son champ `learning_workflow_graph` ([`@studium/lesson-bundle-schema`](../lesson-bundle-schema/README.fr.md)). [`@studium/adaptation-engine`](../adaptation-engine/README.fr.md) s'oriente dessus et [`@studium/typed-graph-lens`](../typed-graph-lens/README.fr.md) le dessine. Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Depuis [src/index.ts](src/index.ts) :

| Export | Rôle |
|---|---|
| `LearningWorkflowGraphSchema` / `LearningWorkflowGraph` | `schema_version: "1.0"`, `course_id`, `nodes`, `edges`. |
| `ConceptNodeSchema`, `TaskNodeSchema`, `GraphNodeSchema` | Nœuds distingués par `node_kind` (`concept` ou `task`). |
| `GraphEdgeSchema`, `EdgeRelationSchema` | Relations `prerequisite_for`, `part_of`, `decomposes_into`, `assesses`, `aligns_with`, avec preuves facultatives. |
| `GraphEvidenceSchema` | DOI, citation, page et degré de confiance qui justifient une arête. |
| `BloomLevelSchema`, `KnowledgeDimensionSchema`, `SceneTypeSchema` | Vocabulaires partagés. |
| `WorkflowCharacterizationSchema`, `SuterAxesSchema`, `ReproducibilityTierSchema`, `TaskOpennessSchema` | Description facultative du flux de calcul d'une tâche. |
| `validateGraph(data)` | Renvoie `{ valid, errors }` avec des messages lisibles `chemin message`. |

Python : `learning_workflow_schema`, dans [python/](python/learning_workflow_schema/__init__.py), expose les mêmes modèles et `validate_graph(data)`.

## Exemple

```ts
import { validateGraph } from "@studium/learning-workflow-schema";

const result = validateGraph({
  schema_version: "1.0",
  course_id: "intro-stats",
  nodes: [
    { id: "mean", node_kind: "concept", title: "Moyenne", bloom_level: "understand" },
    { id: "variance", node_kind: "concept", title: "Variance", bloom_level: "apply" },
  ],
  edges: [{ id: "e1", relation: "prerequisite_for", source: "variance", target: "mean" }],
});
result.valid; // true
```

## Invariants

- `prerequisite_for` se lit « la source dépend de la cible » : `source` est la notion dépendante, `target` son prérequis. Inversez une arête écrite dans le sens naturel du nom.
- Les identifiants de nœuds et d'arêtes sont uniques, et chaque extrémité d'arête doit désigner un nœud déclaré ; une arête orpheline fait échouer la validation.
- Les modèles TypeScript et Python sont tenus égaux à la main : modifiez-les ensemble.

## Tests

```bash
pnpm --filter @studium/learning-workflow-schema test
.venv/bin/python -m pytest packages/learning-workflow-schema -q
```

## Dépendances

- Dépend de : `zod` (TypeScript), `pydantic` (Python).
- Utilisé par : `@studium/lesson-bundle-schema`, `@studium/adaptation-engine`, `@studium/lesson-session`, `@studium/typed-graph-lens` ; le miroir Python par `services/planner`.

## Statut

Actif, version de schéma 1.0. Paquet privé de l'espace de travail, non publié sur npm.
