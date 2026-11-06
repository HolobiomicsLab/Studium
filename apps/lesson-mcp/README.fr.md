[English](README.md) · Français

# Serveur de leçons Studium pour MCP

`@studium/lesson-mcp` permet à tout assistant d'IA qui parle le Model Context Protocol (MCP) de faire
jouer une leçon Studium à un apprenant, de construire une leçon à partir de sources choisies par
l'apprenant, de programmer des révisions sur plusieurs jours, et de fournir aux enseignants une relecture
et un rapport de classe. Codex, Claude Code, Copilot, OpenCode et Cursor le lancent tous de la même façon :
un processus local qui dialogue sur stdio. L'extension VS Code embarque ce même serveur.

| | |
|---|---|
| Statut | **pris en charge** (décision D6) |
| Lancer | `pnpm --filter @studium/lesson-mcp start` (stdio, pas de port) |
| Adaptateur HTTP facultatif | `pnpm --filter @studium/lesson-mcp api`, port 8130 sur 127.0.0.1 |
| Dépend de | [`@studium/lesson-session-host`](../../packages/lesson-session-host), [`@studium/lesson-session`](../../packages/lesson-session) |
| Appelle | rien par défaut ; un modèle juge seulement si `LITELLM_BASE_URL` est défini |
| Tests | `pnpm --filter @studium/lesson-mcp test` |

## Le lancer

Depuis un clone, après `pnpm install` à la racine du dépôt :

```bash
pnpm --filter @studium/lesson-mcp start
```

Le serveur écrit une ligne de démarrage sur stderr (stdout porte le protocole) : dossier des leçons,
bibliothèque, dossier de données et présence d'un modèle juge. Pour l'essayer sans rien écrire dans
votre dossier personnel, gardez l'état en mémoire :

```bash
STUDIUM_EPHEMERAL=1 BUNDLES_ROOT="$PWD/fixtures" pnpm --filter @studium/lesson-mcp start
```

Une version en un seul fichier, utilisable sans clone :

```bash
pnpm --filter @studium/lesson-mcp bundle   # écrit apps/lesson-mcp/dist/studium-mcp.cjs
```

L'extension VS Code construit le même point d'entrée sous `apps/studium-vscode/dist/lesson-mcp.cjs`.
Des configurations prêtes à l'emploi se trouvent dans [`docs/examples/`](../../docs/examples/)
(`codex.toml`, `mcp.claude.json`, `mcp.vscode.json`, `opencode-v2.json`) ; le
[guide des harnais](../../docs/start/harnesses.fr.md) les explique une par une.

## Ce qu'il propose

40 outils, deux prompts (`learn` et `review`) et des instructions de serveur qui demandent à l'assistant
d'attendre les réponses de l'apprenant lui-même. Le contrat complet figure dans la
[référence des outils MCP](../../docs/reference/mcp-tools.fr.md).

| Groupe | Outils |
|---|---|
| Leçon (25) | `start_lesson_session`, `get_current_scene`, `submit_response`, `request_hint`, `submit_turn`, `get_session_state`, `get_operator_context`, `explain_last_adaptation`, `get_workflow_graph`, `get_scene_artifacts`, `get_run_manifest`, `submit_run_result`, `record_experiment`, `get_experiment_journal`, `get_next_reinforcement`, `set_session_language`, `end_session`, `forget_session`, `get_server_info`, `list_community_bundles`, `open_peer_room`, `join_peer_room`, `get_peer_room_state`, `submit_peer_rating`, `close_peer_room` |
| Étudier dans la durée (5) | `list_lessons`, `get_study_plan`, `start_review_session`, `rate_recall`, `export_concept_map` |
| Créer à partir de sources (3) | `get_authoring_guide`, `prepare_sources`, `create_lesson` |
| Enseignant (2) | `review_lesson`, `class_report` |
| Formulaires, un prototype (1) | `play_in_forms` |
| Panneau partagé (3) | `open_lesson_panel`, `get_panel_view`, `panel_action` |
| Accompagnement (1) | `get_companion_brief` |

Une leçon se joue sur deux voies. Sur un panneau, un volet ou des formulaires, le serveur répond à
l'apprenant et aucun modèle n'écrit. Dans la conversation, un assistant relaie.
`get_companion_brief {session_id}` dit à l'assistant ce que l'apprenant a fait sur la voie rapide depuis
son dernier regard (les douze derniers actes et leur nombre, chacun avec sa voie), où il en est, quelle
aide est ouverte et trois règles à suivre. Il ne contient ni texte de scène, ni corrigé, ni indice, ni
référence. Les actes sont gardés en mémoire pour la séance et repartent de zéro après un redémarrage du
serveur. Lire le brief avance son curseur. Avec `peek: true` il ne bouge pas, ce qu'utilise un panneau
pour tenir à jour le contexte du modèle.

Ce que le serveur garantit :

- Aucun corrigé avant la réponse : les scènes sont expurgées avant de quitter le serveur, et les
  passages cités des scènes notées ne sont transmis qu'après la réponse de l'apprenant.
- `end_session` ferme une leçon et conserve la progression. `forget_session {session_id}` efface la
  progression dans cette leçon ainsi que le profil commun à toutes les leçons et le calendrier de
  révisions de l'apprenant ; `forget_session {learner_id}` efface en plus la progression de toutes ses
  leçons. Sa réponse dit ce qui a été effacé et ce qui reste sur le disque : les leçons de la
  bibliothèque de l'apprenant et leurs sources, qu'il supprime lui-même.
- `create_lesson` écrit `<course_id>/lesson.json` dans la bibliothèque de l'apprenant
  (`<STUDIUM_HOME>/library`) après validation et lint, jamais dans `BUNDLES_ROOT` ; chaque citation doit
  correspondre caractère pour caractère à un passage préparé. La leçon est marquée comme rédigée par
  l'agent, non validée par un enseignant.
- `class_report` tait chaque chiffre calculé sur moins de cinq apprenants ; ni ce seuil ni le dossier
  de données ne se changent depuis l'outil.
- Toute date est un jour du calendrier dans le fuseau horaire du serveur, donné par
  `get_server_info.time_zone`.

## Configuration

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `STUDIUM_HOME` | `~/.studium` | racine de la bibliothèque et des données de l'apprenant |
| `BUNDLES_ROOT` | `<STUDIUM_HOME>/library` | où les leçons sont cherchées d'abord ; la bibliothèque est toujours consultée aussi |
| `STUDIUM_DATA_DIR` | `<STUDIUM_HOME>/data` | état durable de l'apprenant |
| `STUDIUM_EPHEMERAL` | non défini | `1` garde l'état en mémoire, sauf si `STUDIUM_DATA_DIR` est défini (tests, démos, CI) |
| `STUDIUM_LEARNER_ID` | `anonymous` | identifiant utilisé quand un appel n'en donne pas |
| `STUDIUM_PSEUDO_SECRET` | fichier propre à l'installation `<dossier de données>/.studium-secret` | secret des pseudonymes enregistrés sur disque |
| `LITELLM_BASE_URL` | vide | adresse du modèle juge ; vide signifie pas de juge |
| `LITELLM_API_KEY`, `LITELLM_MODEL` | non définis | identifiants et nom du modèle pour cette adresse |
| `STUDIUM_LLM_TIMEOUT_MS` | `20000` | délai maximal d'un appel au juge |

La [référence de configuration](../../docs/reference/configuration.fr.md) recense toutes les variables
de toutes les surfaces.

## Adaptateur HTTP

[`src/http.ts`](src/http.ts) expose les 25 opérations de leçon et `rate_recall` (pas les autres outils
d'étude, ni les outils de création ou d'enseignant) à un client local, sous `/v1/operations`. Il n'écoute que sur 127.0.0.1 et exige un jeton
porteur d'au moins 32 caractères :

```bash
STUDIUM_API_TOKEN="$(openssl rand -hex 32)" BUNDLES_ROOT="$PWD/fixtures" \
  pnpm --filter @studium/lesson-mcp api
```

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `STUDIUM_API_TOKEN` | aucune (obligatoire) | jeton porteur, 32 caractères ou plus |
| `STUDIUM_API_PORT` | `8130` | port |
| `STUDIUM_API_LIVE` | non défini | `1` active le modèle juge pour ce transport |

Les sessions durent le temps du processus. Voir la [référence de l'API HTTP](../../docs/reference/http-api.fr.md).

## Canal fichier

[`src/session-runner-cli.ts`](src/session-runner-cli.ts) pilote une leçon par des fichiers dans un
dossier `.studium-session/` (`task.md` en sortie, `response.json` en entrée, `feedback.md` en retour),
pour les assistants qui éditent des fichiers plutôt que d'appeler des outils. Le protocole est décrit
dans le [protocole de séance agentique](../../docs/reference/agentic-session-protocol.fr.md).

```bash
STUDIUM_EPHEMERAL=1 pnpm --filter @studium/lesson-mcp exec tsx src/session-runner-cli.ts \
  capsule-run-demo/lesson.json --bundles-root=../../fixtures --dir="$(mktemp -d)" --stub
```

`--stub` laisse un opérateur factice jouer jusqu'au bout, pour une vérification rapide.

## Tests

```bash
pnpm --filter @studium/lesson-mcp test     # vitest, y compris le test de bout en bout « apprendre puis réviser »
node apps/lesson-mcp/scripts/headless_smoke.mjs   # un client MCP nu contre le vrai serveur (lancé par la CI)
```

[`src/learn-and-review.e2e.test.ts`](src/learn-and-review.e2e.test.ts) va de « apprendre X » à la
première question en six appels d'outils Studium, puis joue une révision sept jours plus tard. Les
scripts `*.mjs` à la racine de ce dossier sont d'anciennes démonstrations ; ils gardent leur état en
mémoire.

## Voir aussi

- [Apprendre avec votre assistant](../../docs/learn/learn-with-your-assistant.fr.md)
- [Comment fonctionne Studium](../../docs/concepts/how-studium-works.fr.md)
- [Extension VS Code](../studium-vscode/README.fr.md), qui lance ce serveur pour son panneau de leçon
