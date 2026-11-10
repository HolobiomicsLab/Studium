[English](troubleshooting.md) · Français

# Dépannage

Cherchez votre symptôme dans les tableaux ci-dessous ; chaque ligne donne la vérification et la
correction. Avant de demander de l'aide, notez la révision (`git rev-parse HEAD`), votre assistant et sa
version, `node --version`, `pnpm --version`, la commande qui échoue et, si le serveur démarre, la sortie de
`get_server_info`. Partagez un message d'erreur réduit, sans clé, donnée personnelle ni contenu de leçon
privé.

## Installation et construction

| Symptôme | Vérification et correction |
|---|---|
| `Repository not found` au clonage | le dépôt est privé : lancez `gh auth login`, puis clonez à nouveau |
| `pnpm` introuvable ou trop ancien | `corepack enable`, ou installez pnpm 9.15.9 |
| `ERR_MODULE_NOT_FOUND` ou `dist/` absent | relancez `./setup.sh`, ou `pnpm install --frozen-lockfile`, `pnpm build:libs`, puis `pnpm --filter studium-vscode build` |
| `tsx` introuvable | lancez plutôt le serveur construit avec `node apps/studium-vscode/dist/lesson-mcp.cjs` |
| `listen EPERM` de `tsx` dans un bac à sable | passez par le chargeur, qui n'ouvre pas de socket IPC : `node --import apps/lesson-mcp/node_modules/tsx/dist/loader.mjs apps/lesson-mcp/src/session-runner-cli.ts …` |
| `ModuleNotFoundError` en Python | utilisez le `.venv` du dépôt et `.venv/bin/pip install -r requirements.txt`, pas le Python du système |

## Connexion d'un assistant

| Symptôme | Vérification et correction |
|---|---|
| Le serveur attend sans afficher de page | normal : il dialogue par stdio avec un client MCP, pas avec un navigateur |
| Aucun outil Studium dans le chat | lisez le journal MCP du client, vérifiez le chemin absolu de `lesson-mcp.cjs`, redémarrez le serveur et ouvrez une nouvelle conversation |
| VS Code ignore le JSON | `.vscode/mcp.json` utilise `servers` ; Claude Code et Cursor utilisent `mcpServers` ; OpenCode v2 utilise `mcp.servers` |
| Codex : `MCP tool call requires approval, but approval policy is never` | répondez aux demandes en interactif, ou lancez `codex exec --approve-for-me` |
| Un outil documenté manque | le build est antérieur à votre clone : reconstruisez avec `pnpm --filter studium-vscode build`, redémarrez le serveur, comparez `get_server_info.build` |
| `persistence.durable` vaut false | `STUDIUM_EPHEMERAL=1` est défini sans `STUDIUM_DATA_DIR` : la progression est perdue au redémarrage |
| La leçon demandée est introuvable | le serveur cherche d'abord dans `BUNDLES_ROOT`, puis dans `~/.studium/library` ; demandez à l'assistant d'appeler `list_lessons` |
| Le chat et le panneau montrent deux étapes différentes | ils utilisent deux serveurs ; pilotez la leçon depuis un seul |

## Pendant une leçon

| Symptôme | Vérification et correction |
|---|---|
| Réponse refusée | transmettez les mots de l'apprenant avec `submit_response {kind: "reply", text}` ; lisez `get_operator_context` pour le format attendu |
| Un identifiant de choix de quiz est refusé | les choix sont remélangés à chaque session : utilisez l'identifiant affiché dans l'étape courante, jamais celui d'une autre session |
| `run required: call get_run_manifest, run it, then submit_run_result` | l'étape demande une vraie exécution : suivez `get_run_manifest`, exécutez la capsule, puis `submit_run_result` |
| Les réponses ouvertes disent « à comparer toi-même » | attendu sans modèle juge ; voir [Configuration](../reference/configuration.fr.md#modèle-juge-facultatif) |
| L'assistant répond ou note à votre place | arrêtez-le et répondez vous-même ; les instructions du serveur l'interdisent, et l'auto-évaluation ne change jamais la maîtrise |
| `session not found: …` | le serveur a redémarré ou la séance a été fermée ; le message dit comment reprendre : `start_lesson_session` avec le même `bundle_ref` et le même `learner_id`, ou `start_review_session` avec le même `learner_id` ; le panneau MCP Apps, le volet Claude Code et le volet VS Code affichent « Séance perdue » et un bouton pour rouvrir la leçon, à la place de la scène périmée |
| Une auto-évaluation est refusée comme expirée | la demande a été perdue par un serveur plus ancien ; répondez de nouveau à l'étape pour être sollicité à nouveau |
| `now_ms must be an integer epoch in milliseconds …` | passez un nombre entier de millisecondes depuis 1970, ou omettez `now_ms` pour utiliser l'horloge du serveur |
| `create_lesson` refuse le `course_id` | une leçon de cet identifiant existe déjà : sous `BUNDLES_ROOT`, elle n'est jamais remplacée, choisissez un autre identifiant ; dans votre bibliothèque, passez `overwrite: true` pour remplacer une leçon d'auto-apprentissage qu'aucun enseignant n'a validée |

## VS Code

| Symptôme | Vérification et correction |
|---|---|
| F5 ne trouve pas de configuration de lancement | ouvrez le dossier `apps/studium-vscode`, qui contient la configuration Extension Host |
| Le VSIX installé ne trouve aucune leçon | les leçons ne sont pas dans le VSIX : placez-les dans `~/.studium/library`, ou définissez `studium.bundlesRoot` et `studium.bundleRef`, ou utilisez **Studium : Choisir un cours** |
| Un lien `vscode://` n'ouvre rien | le chemin doit être absolu, sans `..`, encodé pour une URL, vers un fichier `.json` existant |
| Équations ou graphiques dégradés | lancez `pnpm --filter studium-vscode vendor`, reconstruisez, et gardez `studium.assets` à `vendor` |
| Pas de décompte de révisions dans la barre d'état | rien n'est dû, ou vous n'avez pas encore d'historique ; utilisez le bouton de rafraîchissement de la vue Leçons |

## API HTTP

| Réponse | Signification | Que faire |
|---|---|---|
| `400` | JSON ou schéma invalide, `request_id` ou `expected_scene_id` manquant | corrigez la requête d'après `api:call operations` |
| `401` / `403` | jeton faux, `Origin` de navigateur ou adresse non locale | donnez au serveur et au client le même jeton par leur environnement |
| `404` | opération inconnue, ou session disparue (oubliée ou serveur redémarré) | n'inventez pas de reprise ; repartez de l'état durable |
| `409 stale_scene` | l'étape a changé | lisez `get_operator_context`, puis redemandez à l'apprenant |
| `409 request_conflict` | un `request_id` réutilisé pour une autre requête | examinez l'action précédente avant de choisir un nouvel identifiant |
| `410 forgotten` | la session a été effacée | respectez l'effacement |
| `413` / `415` | corps de plus de 1 Mio, ou autre type que `application/json` | envoyez du JSON ; passez les médias par référence |
| `422` | le moteur a refusé l'opération | lisez l'erreur ; ne forcez pas l'avancement |
| `503` | serveur occupé, ou limite de reçus atteinte (512 mutations ou 16 Mio) | relancez avec le même `request_id` s'il est occupé ; exportez, puis redémarrez le serveur s'il est plein |

Après une erreur réseau, renvoyez le même fichier avec le même `request_id`, jamais une seconde réponse.

## Outils enseignant et services

| Symptôme | Vérification et correction |
|---|---|
| `check` refuse le brouillon | comparez schéma, identifiants et citations avec les preuves ; gardez `status: draft` et `validated_by: null` |
| Le dossier de sortie existe déjà | choisissez un nouveau chemin ; les outils préservent volontairement les sorties existantes |
| L'Observatoire ou MySTRA affiche 404 | vérifiez `--course-root` et le sous-dossier du cours ; voir [Observatoire](../teach/observatory.fr.md) |
| Le planner répond `503` | aucun modèle n'est configuré ; configurez-en un, ou utilisez `STUDIUM_LLM_MODE=mock` pour le modèle fictif déterministe |
| Le planner répond `422` | envoyez `manifest_id` et `target` dans le corps de la requête |
| La synthèse de scènes répond `503` | son orchestrateur n'est pas configuré ; lancer le service seul ne suffit pas |
| Un essai « réel » renvoie une sortie fictive | vérifiez le mode, l'URL, les alias de modèles et les indicateurs de repli : un HTTP 200 ne prouve pas qu'un modèle a répondu |

## Vérifications sans conversation

Depuis la racine du dépôt :

```bash
node apps/lesson-mcp/scripts/headless_smoke.mjs        # serveur MCP, en mémoire, sans client
node apps/lesson-mcp/scripts/http-smoke.mjs new-api-audit   # API HTTP et export de rapport ; demande le .venv
```

Le premier affiche `all 19 assertions passed`. Le second lance un serveur API temporaire, le pilote depuis
plusieurs processus clients avec des réponses synthétiques, exporte et vérifie un rapport, puis s'arrête ;
son dossier de sortie ne doit pas exister. Aucun des deux ne vérifie la connexion de votre assistant, le
panneau VS Code ni la qualité pédagogique d'un cours. Les suites de tests complètes sont décrites dans
[Tests](../develop/testing.fr.md).

Si le problème persiste, signalez l'étape, le résultat attendu, l'erreur réduite, la révision, votre
plateforme et une reproduction minimale. Ne publiez pas un dossier de données entier, et ne contournez ni
une vérification ni une protection pour obtenir un voyant vert.
