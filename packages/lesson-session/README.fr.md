[English](README.md) · Français

# @studium/lesson-session

Joue une leçon pour un apprenant. Une `LessonSession` présente les scènes, note les réponses, laisse le moteur d'adaptation décider de la suite, enregistre les auto-évaluations, émet la télémétrie et écrit les attestations de maîtrise. Toutes les entrées-sorties passent par des ports (stockage d'état, journal d'événements, télémétrie, pseudonymes, évaluateurs, juges, horloge, générateur d'identifiants) : la même session tourne dans les tests, dans un terminal ou derrière un serveur. Les règles de retour qu'elle applique sont décrites dans [honnêteté et provenance](../../docs/concepts/honesty-and-provenance.fr.md).

## Place dans l'ensemble

Entre le moteur pur ([`@studium/adaptation-engine`](../adaptation-engine/README.fr.md)) et l'hôte ([`@studium/lesson-session-host`](../lesson-session-host/README.fr.md)), qui gère plusieurs sessions, la persistance et le masquage pour le serveur MCP, le serveur HTTP et l'extension VS Code. Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Point d'entrée principal, [src/index.ts](src/index.ts) :

| Export | Rôle |
|---|---|
| `LessonSession` | `start()`, `currentPresentation()`, `respond(input)`, `rateRecall(sceneId, grade)`, `requestHint()`, `submitTurn(text)`, `explainLast()`, `getState()`, `erase()`. |
| `grade` | Note une réponse au regard d'une scène. |
| `verdictDeck`, `publicDeck`, `scoreVerdictDeck` | Le jeu de verdicts des scènes « trouver l'erreur » : affirmations derrière des jetons opaques, notées une à une. |
| `matchClaimsAgainstCritique` | Rapprochement hors ligne d'une critique et des erreurs volontaires. |
| `SELF_RATING_CHOICES`, `SelfRatingRequest`, `SelfRatingRecord` | again / hard / good / easy, dans l'ordre FSRS. |
| `SessionError`, `SessionNotStartedError`, `SessionAlreadyCompleteError`, `SceneGradingError`, `SelfRatingNotRequestedError`, `InvalidSelfRatingError` | Erreurs typées. |
| `StubAuditJudge`, `HttpLlmAuditJudge` | Juges d'audit (hors ligne et appuyé sur un modèle). |
| `enrichEvent`, `bundleVersionOf` | Aides pour la télémétrie. |
| `runGateValidity`, `simulateVerdicts`, `CANONICAL_LEARNERS` | Vérification de la porte de confiance par apprenants synthétiques. |
| Types `Presentation`, `ResponseInput`, `Transition`, `CompletionSummary`, `SessionDeps` et les interfaces de ports | Le contrat de la session. |

Adaptateurs Node, `@studium/lesson-session/node` : `FileStateStore`, `JsonlEventLog`, `JsonlTelemetrySink`, `HttpTelemetrySink`, `HmacPseudonymProvider`, `SystemClock`, `RandomIdGen`, `loadBundleZip`, `loadBundleJson`, évaluateurs, tuteurs et évaluateurs de critique réels ou simulés, stockages en mémoire, `FileMasteryClaimSink`. `loadBundleZip` ne décompresse que le `lesson.json` de l'archive, refusé au-delà de `MAX_LESSON_JSON_BYTES` (8 Mo décompressés), même quand l'archive déclare une taille plus petite. Doublures de test, `@studium/lesson-session/testing` : `buildTestDeps`, `FixedClock`, `SeqIdGen`, `StaticPseudonym`.

## Exemple

```ts
import { readFileSync } from "node:fs";
import { LessonSession } from "@studium/lesson-session";
import { loadBundleJson } from "@studium/lesson-session/node";
import { buildTestDeps } from "@studium/lesson-session/testing";

const raw = JSON.parse(readFileSync("packages/lesson-session/src/fixtures/all-scene-types.json", "utf8"));
const session = new LessonSession(loadBundleJson(raw), buildTestDeps(), undefined, "learner-1");
const first = await session.start();               // la première scène
const next = await session.respond({ kind: "ack" }); // next.kind : "next", "replay", "remediate", "complete"...
```

Pour jouer un parcours scénarisé dans le terminal (les fichiers sont écrits dans le dossier `--out`) :

```bash
pnpm --filter @studium/lesson-session play src/fixtures/all-scene-types.json src/fixtures/scripts/all-types-happy.json --out .playthrough
```

## Invariants

- Chaque verdict nomme qui a évalué la réponse : `assessed_by` vaut `key`, `judge` ou `none`. `graded` dit seulement qu'une réponse a été soumise.
- Sans modèle juge, une réponse ouverte n'est pas notée par comptage de mots-clés : le verdict porte la référence (`key_points`, `model_answer`, `reference_kind`) et demande une auto-évaluation. Un quiz auquel l'apprenant a mal répondu porte le texte de son bon choix (`reference_kind: "correct_choice"`).
- Une auto-évaluation n'est acceptée que pour une scène qui l'a demandée ; elle devient une note FSRS pour chaque notion de cette scène (`concept_ids`) et ne fait jamais bouger la maîtrise. Les demandes en attente sont enregistrées avec l'état de l'apprenant ; une demande qu'un état plus ancien a perdue lève `SelfRatingExpiredError`.
- Une réponse que personne n'a notée n'est pas mesurée, pas fausse : elle n'envoie jamais l'apprenant en remédiation.
- Une notion n'est certifiée qu'avec une loi a posteriori d'au moins 0,8 et au moins 3 tentatives notées.
- La session voit les corrigés. Les masquer avant affichage est le travail de l'hôte.
- Le pseudonyme est un HMAC de l'identifiant d'apprenant et de la leçon ; la ligne de commande utilise `STUDIUM_PSEUDO_SECRET`.

## Tests

```bash
pnpm --filter @studium/lesson-session test
```

## Dépendances

- Dépend de : `@studium/adaptation-engine`, `@studium/learner-state`, `@studium/learning-workflow-schema`, `@studium/lesson-bundle-schema`, `@studium/reasoning-scorer`, `@studium/telemetry-events`, `@studium/llm-client`, `fflate`, `zod`.
- Utilisé par : `@studium/lesson-session-host`, `apps/lesson-mcp`, `apps/lesson-server`, `apps/student-runtime`.

## Statut

Actif. Paquet privé de l'espace de travail, non publié sur npm.
