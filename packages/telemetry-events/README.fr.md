[English](README.md) · Français

# @studium/telemetry-events

Le contrat des événements d'apprentissage : ce qu'une session peut rapporter sur un apprenant, pour les analyses de classe des enseignants. Dix-sept types d'événements partagent une base (identifiant d'événement, pseudonyme de l'apprenant, identifiant de leçon, version du bundle, horodatage client) et se distinguent par `type`. Le contrat existe deux fois, en Zod et en Pydantic, et un test de parité échoue à la moindre différence.

## Place dans l'ensemble

[`@studium/lesson-session`](../lesson-session/README.fr.md) émet ces événements par son port de télémétrie. L'hôte ne les écrit sur disque qu'avec le consentement de l'apprenant (`STUDIUM_TELEMETRY_CONSENT`) et un état persistant ; le collecteur d'analyses Python les valide avec le miroir. Voir [confidentialité et limites](../../docs/concepts/privacy-and-limits.fr.md) et l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Depuis [src/index.ts](src/index.ts) (qui réexporte [src/events.ts](src/events.ts)) :

| Export | Rôle |
|---|---|
| `TelemetryEventSchema` / `TelemetryEvent` | L'union discriminée de tous les événements. |
| `LessonStartedSchema`, `SceneEnteredSchema`, `SceneCompletedSchema`, `LessonCompletedSchema` | Progression dans une leçon. |
| `QuizAnsweredSchema`, `HintRequestedSchema`, `AdaptationAppliedSchema` | Réponses, indices et décisions d'adaptation. |
| `CritiqueSubmittedSchema`, `AIAuditResultSchema`, `ReasoningSignalSchema`, `TutorMoveSchema` | Critique d'IA, audits de productions fautives, étiquettes de raisonnement, interventions du tuteur. |
| `JournalEntrySubmittedSchema`, `CooperativeVoteSchema`, `CooperativeConvergenceSchema`, `UniverseSelectedSchema` | Écrit réflexif, scènes de groupe, variantes de scénario. |
| `ConsentGrantedSchema`, `ForgetRequestedSchema` | Consentement et demandes d'effacement. |
| `InteractionSchema`, `PromptShownSchema`, `PromptOutcomeSchema`, `HelpUsedSchema`, `ContestEventSchema`, `ResumeSchema`, `ReviewReceiptEventSchema` | L'usage d'une leçon (INT-STUDIUM-058) : les actes avec leur voie, le rang de la surface et les délais, les propositions montrées et leur issue, les aides utilisées, les contestations, les reprises, les comptes d'un reçu de relecture. Stricts : étiquettes fermées, comptes et références ; un champ inconnu est refusé. L'hôte de séance en émet six, chacun par le puits de la séance. `interaction` : un par acte que le serveur règle (`SessionHost.settleAct`), depuis `panel_action` (voie `fast`, rang de surface de la séance, `client_ms` quand la surface l'envoie), `play_in_forms` (`fast`, rang 2) et les outils de conversation `submit_response`, `submit_turn`, `request_hint`, `rate_recall`, `set_session_language`, `end_session` (voie `companion`, au rang où la séance se joue : rang 1 quand aucun n'a été négocié). `surface_rank` est le rang de la surface où la séance se joue, pas celui par lequel l'acte est arrivé : « companion, rang 3 » est un apprenant qui s'est servi de la conversation pendant qu'un volet était ouvert, et l'indicateur de voie rapide le compte ; `server_ms` est le temps propre du serveur sur l'acte ; une lecture n'est pas un acte. `prompt_shown` et `prompt_outcome` : les propositions et leur issue ; `prompt_shown` aussi pour une notice de reprise, depuis `create` sur une leçon reprise (rang 1 : le texte de conversation la dit d'abord). `help_used` : `hint` quand un indice est donné (pas quand il est refusé au plafond), `explain` quand l'échelle d'aide du volet demande une explication par `ask`. `contest` : quand une contestation se clôt, avec son issue. `resume` : `restart` quand une leçon est reprise (`resume: resumed`), `surface_change` quand une séance passe à une surface d'un autre rang. `review_receipt` est émis par la CLI (`experience_packet.py approve`, `receipt --decision returned`), pas par l'hôte de séance : une ligne à côté des reçus dans `<cours>/reviews/telemetry.jsonl`, sous l'étiquette de rôle fixe `learner_pseudonym: "reviewer"` (un rôle, pas une identité : le nom du relecteur reste dans le fichier du reçu), portant seulement la décision et les comptes. Non émis : le palier `reread` (il se passe chez le client, le serveur ne le voit pas) ; le palier `reference` (la référence s'affiche dans un verdict, elle n'est jamais demandée) ; `resume` de cause `paused` (rien ne met une séance en pause sur le serveur : une pause acceptée n'est qu'un avis). |

Python : `telemetry_events`, dans [python/](python/telemetry_events/__init__.py), avec `TelemetryEvent` en union discriminée Pydantic.

## Exemple

```ts
import { TelemetryEventSchema } from "@studium/telemetry-events";

const event = TelemetryEventSchema.parse({
  type: "lesson_started",
  event_id: crypto.randomUUID(),
  learner_pseudonym: "3f9c0a1b2c3d4e5f",
  lesson_id: "intro-stats",
  client_timestamp: new Date().toISOString(),
  bundle_uri: "intro-stats.json",
});
event.bundle_version; // "unversioned" quand il est absent
```

## Invariants

- Les événements portent des identifiants, des compteurs, des étiquettes et des scores, jamais le texte libre de l'apprenant : une entrée de journal est rapportée par sa longueur et son nombre de révisions.
- L'apprenant n'apparaît que sous pseudonyme.
- Tout champ ajouté d'un côté doit l'être de l'autre, avec le même caractère obligatoire ou facultatif ; [tests/test_contract_parity.py](tests/test_contract_parity.py) compare les deux unions.

## Tests

```bash
pnpm --filter @studium/telemetry-events test
.venv/bin/python -m pytest packages/telemetry-events -q
```

## Dépendances

- Dépend de : `zod` (TypeScript), `pydantic` (Python).
- Utilisé par : `@studium/lesson-session`, `apps/student-runtime` ; le miroir par `services/analytics-collector` et `services/observatory`.

## Statut

Actif, version de paquet 0.5.0. Paquet de l'espace de travail, non publié sur npm.
