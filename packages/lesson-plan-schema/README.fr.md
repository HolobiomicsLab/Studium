[English](README.md) · Français

# @studium/lesson-plan-schema

Le plan de leçon, version 1 : ce que produit le planificateur avant qu'aucune scène ne soit écrite. Un plan liste les objectifs d'apprentissage, les esquisses de scènes, les notions et les références du corpus, et porte une note du relecteur automatique et un statut (`draft`, `critic_reviewed`, `approved`). Le contrat est un JSON Schema ([src/schema.json](src/schema.json)) accompagné de types TypeScript et d'un miroir Pydantic.

## Place dans l'ensemble

En amont du bundle de leçon : le planificateur Python (`services/planner`) et les outils de composition construisent un plan, puis un bundle ([`@studium/lesson-bundle-schema`](../lesson-bundle-schema/README.fr.md)) est rédigé à partir de lui. Voir l'[architecture](../../docs/develop/architecture.fr.md) et le tutoriel [de la littérature au cours](../../docs/tutorials/literature-to-course.fr.md).

## API publique

Depuis [src/index.ts](src/index.ts) :

| Export | Rôle |
|---|---|
| `LessonPlan` | Le type du plan (`schema_version: "1.0"`, objectifs, `scene_outlines`, `corpus_refs`, `status`). |
| `LearningObjective`, `SceneOutline`, `Concept`, `CorpusRef` | Les parties d'un plan. |
| `Evidence`, `BibliographicRef`, `CaseStudy`, `ABSAsset`, `EnrichmentMetadata` | Les éléments de littérature rattachés aux esquisses. |
| `validatePlan(data)` | Validation Ajv contre le JSON Schema ; renvoie `{ valid, errors }`. |
| `loadSchema()` | L'objet JSON Schema. |

Python : `lesson_plan_schema`, dans [python/](python/lesson_plan_schema/__init__.py), expose `LessonPlan` et ses parties en modèles Pydantic.

## Exemple

```ts
import { readFileSync } from "node:fs";
import { validatePlan } from "@studium/lesson-plan-schema";

const { valid, errors } = validatePlan(JSON.parse(readFileSync("plan.json", "utf8")));
if (!valid) console.error(errors.join("\n"));
```

## Invariants

- Le paquet exporte son `dist/` compilé : lancez `pnpm --filter @studium/lesson-plan-schema build` avant de l'importer depuis un autre paquet.
- Ajv tourne en mode strict : un mot-clé inconnu dans le schéma est une erreur, pas un passage silencieux.
- Le JSON Schema, les types TypeScript et les modèles Pydantic sont tenus égaux à la main : modifiez les trois ensemble.

## Tests

```bash
pnpm --filter @studium/lesson-plan-schema test
.venv/bin/python -m pytest packages/lesson-plan-schema -q
```

## Dépendances

- Dépend de : `ajv` (TypeScript), `pydantic` (Python).
- Utilisé par : le miroir Python dans `services/planner`, `tools/compose_lesson.py`, `tools/experience_packet.py` et les tests de `services/scene-synth`. Aucun paquet TypeScript ne l'importe aujourd'hui.

## Statut

Actif côté Python, version de schéma 1.0. Paquet privé de l'espace de travail, non publié sur npm.
