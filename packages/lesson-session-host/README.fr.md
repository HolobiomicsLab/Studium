[English](README.md) · Français

# @studium/lesson-session-host

Tout ce dont une interface a besoin autour des sessions de leçon. Un `SessionHost` trouve les leçons, démarre ou reprend les sessions d'un apprenant, conserve sa progression (sur disque par défaut dans les applications, ou en mémoire), cache les corrigés tant que l'apprenant n'a pas répondu, construit le plan d'étude et les séances de révision, et rédige le texte qu'affiche un client de discussion. Le paquet contient aussi l'auteur conversationnel, qui transforme les sources choisies par un apprenant en leçon. Le serveur MCP, le serveur de leçons HTTP et l'extension VS Code sont de fines couches au-dessus ; les outils sont listés dans la page [outils MCP](../../docs/reference/mcp-tools.fr.md).

## Place dans l'ensemble

Au-dessus de [`@studium/lesson-session`](../lesson-session/README.fr.md) (une session) et sous `apps/lesson-mcp` et `apps/lesson-server`. Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Depuis [src/index.ts](src/index.ts), par thème :

| Thème | Principaux exports |
|---|---|
| Sessions | `SessionHost` (`create`, `respond`, `rateRecall`, `requestHint`, `close`, `forget`, `forgetLearner`, `studyPlan`, `listLessons`, `startReview`, `workflowGraph`...), `SessionHostNotFoundError`, `RunRequiredError`, `SessionRegistry`. |
| Temps | `NowMsSchema`, `checkNowMs`, `OffsetClock` (l'horloge d'une séance démarrée avec `now_ms`), `calendarDate`, `localTimeZone`, `checkTimeZone`. |
| Persistance | `resolvePersistence(env, homedir)`, `persistenceInfo`, `DEFAULT_LEARNER_ID`, `buildHostDeps`, `durableDataDir`, `FileLearnerProfileStore`, `telemetryConsentGranted`. |
| Leçons | `resolveBundle`, `loadResolvedBundle`, `discoverCommunityBundles`, `resolveCourse`, `shuffleQuizChoices`. |
| Masquage | `publicScene`, `publicPresentation`, `publicTransition`, `citedSources`, `REDACTED_SCENE_FIELDS`. |
| Provenance | `authoringOf`, `draftedByOf`, `readApproval`, `parseApproval` et `approvalOfZip` (le registre d'approbation, seule source du statut validé), `buildReviewInbox` et `readLastReceipt` (la boîte de relecture et ses reçus ; l'aperçu `preview` de chaque élément, donné par `scenePreview`, est le visage public de la scène : titre, type, 280 premiers caractères du texte de l'apprenant, texte des choix sans indicateur de bonne réponse, calculé à chaque lecture et jamais haché), `hasUnvalidatedPlaceholder` (reconnaît un marqueur DRAFT ou SELF-STUDY ; n'accorde rien), `keyClassOf`, `SELF_STUDY_NOTICE`, `AGENT_DRAFTED_NOTICE`. |
| Discussion | `presentationMarkdown`, `transitionMarkdown`, `verdictMarkdown`, `replyToInput`, `ResponseInputSchema`. |
| Auteur conversationnel | `authoringGuide`, `prepareSources`, `createLesson`, `LessonDraftSchema`, `lintBundleData`, `MAX_SOURCES`, `MAX_TOTAL_SOURCE_CHARS`. |
| Révision | `reviewQueueFromState`, `conceptMemoryFromState`, `nextReinforcementFromState`, `dueReinforcementTargetsFromMemory`, `pickReviewScene`, `isDiagnosticScene`. |
| Exécutions et agents | `SessionWorkspace` (canal fichier), `RunResultSchema`, `parseRunResult`, `runStudiumSession`, `operatorContext`, `StubJudgmentGenerator`, `HttpLlmJudgmentGenerator`. |
| Salles entre pairs | `aggregateRatings`, `distinctRaters`, `ROOM_K_FLOOR`. |

## Exemple

```ts
import { SessionHost } from "@studium/lesson-session-host";

const host = new SessionHost({ bundlesRoot: "fixtures", dataDir: null, live: false });
const { sessionId, presentation, persistence } = await host.create("atomistique-l1/lesson.json", "learner-1");
console.log(presentation.display_markdown); // persistence.durable vaut false : en mémoire seulement
const transition = await host.respond(sessionId, { kind: "ack" });
const plan = await host.studyPlan("learner-1"); // due_reviews, relearn, unmeasured_reviews, next_lesson...
await host.close(sessionId);
```

## Invariants

- Aucun corrigé avant la réponse : les scènes servies perdent les champs de `REDACTED_SCENE_FIELDS` (retours sur la bonne réponse, indices, points clés, réponses modèles, affirmations). Les passages cités et la référence ne sont livrés que lorsque l'apprenant quitte définitivement la scène ; une nouvelle tentative ou un détour par un prérequis sur le même point les retient.
- Les choix des quiz sont mélangés et renommés par scène, de façon déterministe : la bonne réponse n'est jamais toujours « a ».
- `resolvePersistence` place leçons et données sous `STUDIUM_HOME` (par défaut `~/.studium`) ; `STUDIUM_EPHEMERAL=1` garde l'état en mémoire, et un `STUDIUM_DATA_DIR` explicite l'emporte. Voir la [configuration](../../docs/reference/configuration.fr.md).
- Les dossiers d'apprenants sur disque portent des pseudonymes HMAC ; le secret est `STUDIUM_PSEUDO_SECRET` ou un fichier `.studium-secret` propre à l'installation, dans le dossier de données.
- Chaque leçon servie dit qui l'a écrite et qui a rédigé ses corrigés (`teacher`, `learner`, `agent`), et si un enregistrement d'approbation enseignant correspond exactement à ses octets.
- `prepareSources` accepte jusqu'à 20 sources et 200 000 caractères au total ; `createLesson` vérifie chaque citation contre son passage caractère pour caractère, valide et contrôle la leçon avant de l'écrire, et la marque comme rédigée par un agent. Les deux n'écrivent que dans la racine de bibliothèque qu'on leur donne ; le serveur MCP passe `<STUDIUM_HOME>/library`, jamais `BUNDLES_ROOT`.
- Une séance démarrée avec `nowMs` tourne sur une `OffsetClock` ancrée à cet instant : ses réponses, ses notes et ses dates de révision sont datées dans ce temps simulé. Toute date affichée est un jour du calendrier dans le fuseau horaire de l'hôte (`timeZone`, par défaut celui de la machine).
- Une révision ne rejoue jamais une scène de diagnostic (`isDiagnosticScene`) et, sans juge, préfère une scène notée par une clé ; le plan d'étude applique la même règle (`pickReviewScene`).
- La télémétrie n'est écrite sur disque qu'avec consentement (`STUDIUM_TELEMETRY_CONSENT`) et un état persistant.
- Le journal d'interaction (INT-STUDIUM-058 § 2.10) n'est écrit que par l'hôte : `settleAct(id, {act, lane, surfaceRank, clientMs?}, run)` chronomètre `run` et ajoute un événement `interaction` ; `requestHint`, la dernière réponse de vérification d'une contestation, `create` sur une leçon reprise et `surfaceChanged` ajoutent `help_used`, `contest` et `resume`. `create` sur une leçon reprise ouvre aussi une `resume_notice` dans le registre d'invites de la séance (« Reprise à l'étape n sur total. », les nombres de la ligne d'état), liée à ce premier écran : son texte de conversation et les `prompts` du panneau la portent. Étiquettes, identifiants, comptes et délais seulement ; la liste de ce qui émet quoi est dans [telemetry-events](../telemetry-events/README.fr.md).
- Les propositions (INT-STUDIUM-058 § 2.6) : `sessionPrompts(id, ask)` alimente le carnet de propositions de la session pour un panneau qui le demande. Un appel qui sert un écran dans la conversation ou en formulaires nomme plutôt sa surface, `promptSurface: {rank: 1 | 2, formsAvailable}` sur `create`, `startReview`, `respond`, `ingestRunResult`, `rateRecall` et `currentPresentation` : l'hôte alimente alors le carnet en construisant cet écran, après un éventuel avis de reprise, et son `display_markdown` dit une fois les propositions de ce moment, chacune avec son identifiant (`(proposition review_due:start)`) ; la fin d'une leçon les dit après son bilan, une auto-évaluation après sa ligne. Sans l'option, rien ne change. `settlePrompt(id, promptId, outcome)` reçoit la réponse de l'apprenant ; le carnet décide toujours de ce qui est proposé (une fois par identifiant, jamais pendant qu'une réponse est attendue, dans le budget d'attention).
- Chaque écran dit où en est l'apprenant (`orientation.ts`, INT-STUDIUM-058). Le texte de conversation se termine par la ligne d'état, 80 caractères au plus, qui porte l'étape : la ligne « Étape n sur total » sous le titre n'est écrite que sans ligne d'état. Un long titre de leçon est coupé avant son dernier séparateur qui tient (` — `, ` – `, ` : `, ` (`, ` [`, `: `), pour se lire de la même façon d'un écran à l'autre ; sans séparateur, il est coupé avec « … ». Sur une question de vérification d'une contestation, l'orientation porte `contest: {concept_id, question, total}` et la ligne dit « contrôle n/total » à la place de l'étape. `contest(id, conceptId, claim, lane)` (voie `companion` par défaut, `fast` depuis un panneau) lance les questions de contrôle ; la réponse de la conversation s'ouvre sur `contestOpenedMarkdown(title, questions, locale)` (« Contrôle sur « titre » : n questions. Ta déclaration ne change rien à ta maîtrise ; la leçon reprend ensuite où tu étais. »), puis la première question telle que `currentPresentation` la sert. La liste de la carte des notions écrit l'identifiant de chaque notion après son titre (« Nombres quantiques (`c-nombres-quantiques`) : à venir »), pour que l'assistant puisse nommer la notion à contester. L'échelle d'aide ouvre l'explication d'une question après un premier essai, et sur l'écran qui suit juste une réponse évaluée (`answered_before`), jusqu'au prochain acte de l'apprenant.

## Tests

```bash
STUDIUM_EPHEMERAL=1 pnpm --filter @studium/lesson-session-host test
```

## Dépendances

- Dépend de : `@studium/lesson-session`, `@studium/adaptation-engine`, `@studium/lesson-bundle-schema`, `@studium/learner-state`, `@studium/typed-graph-lens`, `zod`.
- Utilisé par : `apps/lesson-mcp` (et, à travers lui, l'extension VS Code), `apps/lesson-server`.

## Statut

Actif. Paquet privé de l'espace de travail, non publié sur npm.
