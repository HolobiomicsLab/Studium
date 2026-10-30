[English](README.md) · Français

# @studium/lesson-bundle-schema

Le contrat d'une leçon jouable. Un bundle de leçon (`lesson.json`) contient les notions, les scènes, les règles d'adaptation, le nom de qui l'a validé et, au besoin, un plan d'évaluation, un graphe de parcours et des « univers » alternatifs. Ce paquet le définit en schémas Zod, avec un miroir Pydantic pour les outils Python, et traduit les erreurs de validation en messages sur lesquels un auteur peut agir. La référence champ par champ se trouve dans la [référence du bundle de leçon](../../docs/reference/lesson-bundle.fr.md).

## Place dans l'ensemble

Tout ce qui lit ou écrit une leçon passe par lui : la session ([`@studium/lesson-session`](../lesson-session/README.fr.md)), l'hôte et son auteur conversationnel ([`@studium/lesson-session-host`](../lesson-session-host/README.fr.md)) et, côté Python, `tools/experience_packet.py`. Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Depuis [src/index.ts](src/index.ts) :

| Export | Rôle |
|---|---|
| `LessonBundleSchema` / `LessonBundle`, `SCHEMA_VERSION` | Le bundle complet ; la version actuelle est `"1.4"`. |
| `BundleMetadataSchema`, `BundleAuthoringSchema`, `AuthoringModeSchema`, `DraftedBySchema` | Titre, langue, durée ; qui a écrit la leçon (`teacher` ou `self_study`) et qui a rédigé ses corrigés (`agent`, `learner`, `teacher`). |
| `SceneSchema`, `SceneTypeSchema` et un schéma par type de scène | 13 types de scènes, d'`intro` et `quiz` à `spot_the_flaw`, `explain_back` et `communication_sim` (voir les [types de scènes](../../docs/concepts/scene-types.fr.md)). |
| `EvidenceSchema`, `BibliographicRefSchema` | Les sources qu'une scène cite, avec citations exactes. |
| `AdaptationRuleSchema`, `RuleConditionSchema`, `RuleActionSchema` | Les règles appliquées par le moteur d'adaptation. |
| `MODULATORS`, `ACTIVE_MODULATORS`, `ModulatorSchema` | Le registre des modulateurs ; une règle ne peut citer qu'un modulateur actif (M1, M3, M6). Voir les [modulateurs](../../docs/concepts/modulators.fr.md). |
| `AssessmentBlueprintSchema` | Ce que la leçon prétend mesurer, dimension par dimension. |
| `CourseSchema`, `nextCourseLesson`, `isCourseComplete` | Une suite ordonnée de leçons avec prérequis. |
| `LAItemEnvelopeSchema`, `laTransitionAllowed` | Enveloppe de relecture d'une scène écrite par un apprenant. |
| `sceneRenderAssets` | Les ressources de rendu (formules, schémas, molécules) d'une scène. |
| `formatBundleError` / `BundleIssue` | Une `ZodError` sous forme d'éléments `{ path, message, hint }`. |

Python : `lesson_bundle_schema`, dans [python/](python/lesson_bundle_schema/__init__.py), avec le même `SCHEMA_VERSION`.

## Exemple

```ts
import { readFileSync } from "node:fs";
import { LessonBundleSchema, formatBundleError } from "@studium/lesson-bundle-schema";

const raw: unknown = JSON.parse(readFileSync("lesson.json", "utf8"));
const parsed = LessonBundleSchema.safeParse(raw);
if (!parsed.success) {
  for (const issue of formatBundleError(parsed.error, raw)) console.log(`${issue.path} : ${issue.message} (${issue.hint})`);
}
```

## Invariants

- `metadata.authoring` est facultatif pour les bundles écrits avant son apparition ; un bloc absent se lit comme une leçon d'enseignant.
- Les corrigés (choix marqués corrects, points clés, réponses modèles, erreurs volontaires) sont dans le bundle. Les hôtes doivent les masquer avant d'afficher une scène ; cela se fait dans `lesson-session-host`, pas ici.
- La validation est structurelle. Les contrôles de rédaction (gabarits non remplis, une seule bonne réponse par quiz, mentions d'auto-formation) relèvent de `node tools/bundle_lint.mjs <lesson.json>`.
- Les modèles Zod et Pydantic sont tenus égaux à la main : modifiez-les ensemble.

## Tests

```bash
pnpm --filter @studium/lesson-bundle-schema test
.venv/bin/python -m pytest packages/lesson-bundle-schema -q
```

## Dépendances

- Dépend de : `zod`, `@studium/learning-workflow-schema` ; `pydantic` pour le miroir.
- Utilisé par : `@studium/adaptation-engine`, `@studium/lesson-session`, `@studium/lesson-session-host`, `apps/student-runtime` ; le miroir par `tools/experience_packet.py` et les tests de `services/scene-synth`.

## Statut

Actif, version de schéma 1.4. Paquet privé de l'espace de travail, non publié sur npm.
