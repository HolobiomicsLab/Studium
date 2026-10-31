[English](README.md) · Français

# @studium/learner-state

Le modèle de données de ce que Studium sait d'un apprenant, sous forme de schémas Zod et de fonctions pures : l'état par notion (une loi a posteriori Beta sur la maîtrise, les tentatives, la calibration de la confiance et de la confiance accordée à l'IA), les signaux émis par une session, les décisions renvoyées par le moteur, la mémoire FSRS de chaque notion et le profil qui suit l'apprenant d'une leçon à l'autre. Aucune entrée-sortie. La page [modèle de l'apprenant](../../docs/concepts/learner-model.fr.md) explique ce que signifient ces nombres.

## Place dans l'ensemble

Tout en bas de la pile TypeScript : [`@studium/adaptation-engine`](../adaptation-engine/README.fr.md) met à jour ces enregistrements, [`@studium/lesson-session`](../lesson-session/README.fr.md) les stocke, [`@studium/lesson-session-host`](../lesson-session-host/README.fr.md) transporte le profil d'une leçon à l'autre. Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Depuis [src/index.ts](src/index.ts) :

| Export | Rôle |
|---|---|
| `ConceptStateSchema`, `defaultConceptState` | Une notion pour un apprenant ; par défaut, l'a priori uniforme (alpha = beta = 1). |
| `SignalSchema` | `answer_submitted`, `confidence_declared`, `scene_entered`, `scene_completed`. |
| `DecisionSchema`, `NextActionSchema` | Sortie du moteur : avancer, rejouer, passer, afficher le panneau de calibration ou d'explication. |
| `LearnerStateSchema`, `defaultLearnerState` | Un apprenant dans une leçon ; l'historique garde les 50 dernières entrées. |
| `ConceptMemoryStateSchema` | Mémoire FSRS (stabilité en jours, difficulté, dernière révision, répétitions, oublis). |
| `LearnerProfileSchema`, `defaultLearnerProfile`, `recordCompletedLesson`, `seedConceptStatesFromProfile`, `mergeConceptStatesIntoProfile`, `mergeConceptMemoryIntoProfile` | Le profil inter-leçons, indexé par pseudonyme. |
| `masteryOf`, `effectiveMastery` | Moyenne a posteriori ; multipliée par la probabilité de rappel FSRS quand une mémoire existe. |
| `recordConfidenceSample`, `updateCalibration`, `isCalibrated`, `isMiscalibrated`, `isOverconfident` | Calibration de la confiance (confiance déclarée face à la maîtrise réelle). |
| `recordJudgmentAudit`, `recordJudgmentSdt`, `isTrustCalibrated`, `isTrustMiscalibrated`, `isOverTrusting` | Calibration de la confiance accordée à l'IA, mesurée sur des productions volontairement fautives. |
| `CALIBRATION_LAMBDA`, `CALIBRATION_ANSWER_LAMBDA`, `CALIBRATION_WELL_BAND`, `TRUST_CALIBRATION_LAMBDA`, `TRUST_WELL_BAND` | Facteurs de lissage et marges de tolérance. |

## Exemple

```ts
import { defaultConceptState, masteryOf, recordConfidenceSample, isCalibrated, effectiveMastery } from "@studium/learner-state";

let c = defaultConceptState("c1");
masteryOf(c);                    // 0.5
isCalibrated(c);                 // false : jamais mesurée
c = recordConfidenceSample(c, 2); // confiance déclarée 2 sur une échelle de 0 à 4
isCalibrated(c);                 // true : 2/4 correspond à 0,5
effectiveMastery(masteryOf(c), 0.7); // 0.35
```

## Invariants

- Non mesuré ne veut pas dire zéro. Une calibration ne compte qu'après au moins un échantillon ; `effectiveMastery(p, undefined)` renvoie `p`, car une notion jamais révisée n'est pas une notion oubliée.
- Signe de la calibration : positif signifie surconfiance (ou confiance excessive envers l'IA), négatif sous-confiance (ou méfiance excessive).
- Les fonctions de profil sont pures et ne modifient jamais leur entrée. Au démarrage, l'état propre à la leçon l'emporte sur le profil ; la fusion de la mémoire FSRS ignore les notions jamais révisées (`reps === 0`).
- Le profil est indexé par un pseudonyme, jamais par un nom (voir [confidentialité et limites](../../docs/concepts/privacy-and-limits.fr.md)).

## Tests

```bash
pnpm --filter @studium/learner-state test
```

## Dépendances

- Dépend de : `zod`.
- Utilisé par : `@studium/adaptation-engine`, `@studium/lesson-session`, `@studium/lesson-session-host`, `@studium/typed-graph-lens`, `apps/student-runtime`.

## Statut

Actif. Paquet privé de l'espace de travail, non publié sur npm.
