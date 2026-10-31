[English](README.md) · Français

# @studium/adaptation-engine

Décide ce que fait une leçon après chaque signal de l'apprenant, et quand une notion doit être revue. Le moteur applique les règles d'adaptation du bundle de leçon, intègre les réponses notées dans une estimation de maîtrise par notion (une loi a posteriori Beta), oriente selon les prérequis et planifie les révisions espacées avec FSRS-4.5. Du TypeScript pur : aucune entrée-sortie, aucune horloge sauf celle que vous injectez. Les termes sont définis dans le [glossaire](../../docs/concepts/glossary.fr.md) et dans la page [modèle de l'apprenant](../../docs/concepts/learner-model.fr.md).

## Place dans l'ensemble

[`@studium/lesson-session`](../lesson-session/README.fr.md) pilote un `AdaptationEngine` par session ; l'état qu'il met à jour est défini dans [`@studium/learner-state`](../learner-state/README.fr.md). Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Depuis [src/index.ts](src/index.ts) :

| Export | Rôle |
|---|---|
| `AdaptationEngine` | `onSignal(signal)` met à jour l'état et renvoie une `Decision` (action suivante, identifiant de règle, explication courte, modulateur) ; `getState()`, `explain()`. |
| `updateBeta` | Intègre une réponse notée dans la loi a posteriori d'une notion, avec correction du hasard pour les questions à choix. |
| `matchesCondition` | Évalue la clause `when` d'une règle (`>=`, `<=`, `>`, `<`, `==`, `!=`) sur un contexte. |
| `isAvailable`, `availableConcepts`, `lockedConcepts`, `nextConcept`, `remediationTarget`, `DEFAULT_THETA` | Orientation par prérequis sur un graphe de parcours ; une notion s'ouvre quand ses prérequis atteignent `DEFAULT_THETA` (0,8). |
| `defaultMemoryState`, `reviewMemory`, `retrievability`, `intervalDays`, `dueAt`, `isDue` | Mémoire FSRS-4.5 d'une notion. |
| `gradeFromAnswer`, `gradeFromSelfRating`, `SELF_RATING_GRADES` | Convertissent une réponse notée, ou une auto-évaluation again / hard / good / easy, en note FSRS de 1 à 4. |
| `dueForReinforcement`, `nextReinforcement`, `reinforcementPriority` | Classent les notions maîtrisées dont le rappel s'estompe. |

## Exemple

```ts
import { AdaptationEngine, defaultMemoryState, reviewMemory, gradeFromSelfRating, isDue } from "@studium/adaptation-engine";
import { defaultLearnerState } from "@studium/learner-state";
import type { AdaptationRule } from "@studium/lesson-bundle-schema";

const rules: AdaptationRule[] = [{
  id: "replay_after_two_errors",
  when: { consecutive_errors_same_concept: ">=2" },
  action: { kind: "replay_current_scene", reason: "errors_threshold" },
  modulator: "M1",
  explanation_short: "Deux erreurs de suite sur cette notion.",
}];

const engine = new AdaptationEngine(rules, defaultLearnerState("lesson-1"));
const decision = engine.onSignal({
  kind: "answer_submitted", concept_id: "c1", scene_id: "q1",
  correct: false, time_ms: 12_000, hint_count: 0, difficulty: 0.5,
});
decision.next_action.kind; // "advance_to_next_scene" tant que la règle ne se déclenche pas

const now = Date.now();
const memory = reviewMemory(defaultMemoryState("c1"), gradeFromSelfRating("good"), now);
isDue(memory, now + 7 * 86_400_000); // true : le rappel prédit est passé sous 90 %
```

## Invariants

- Une réponse sans champ `correct` n'est pas mesurée : elle ne modifie ni la loi a posteriori ni `total_attempts` ; seul `ungraded_attempts` augmente, et aucune règle portant sur `answer_correct` ne se déclenche.
- Une clé absente du contexte ne correspond jamais. Les clés de calibration ne sont publiées qu'une fois mesurées : un apprenant jamais mesuré n'est donc jamais traité comme parfaitement calibré.
- `alpha + beta` est plafonné à 20, pour que les anciennes réponses ne figent pas l'estimation.
- Une arête `prerequisite_for` va de la notion dépendante (`source`) vers son prérequis (`target`).
- Le constructeur copie l'état initial en profondeur ; le troisième argument injecte l'horloge utilisée pour l'historique et les dates FSRS.
- Une auto-évaluation ne produit qu'une note FSRS. La maîtrise ne bouge que sur des réponses notées (règle appliquée dans `lesson-session`).

## Tests

```bash
pnpm --filter @studium/adaptation-engine test
```

## Dépendances

- Dépend de : `@studium/learner-state`, `@studium/lesson-bundle-schema`, `@studium/learning-workflow-schema`.
- Utilisé par : `@studium/lesson-session`, `@studium/lesson-session-host`, `@studium/typed-graph-lens`, `apps/student-runtime`.

## Statut

Actif. Paquet privé de l'espace de travail, non publié sur npm.
