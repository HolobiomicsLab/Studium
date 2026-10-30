[English](configuration.md) · Français

# Configuration

Studium démarre sans aucune configuration : le serveur MCP range les leçons et la progression sous
`~/.studium` et fonctionne sans modèle. Cette page liste chaque variable d'environnement lue par les
serveurs et services, avec sa valeur par défaut, ainsi que les réglages de l'extension VS Code. Un
modèle commenté de toutes ces variables se trouve dans [.env.example](../../.env.example) ; aucun
composant ne charge ce fichier automatiquement : copiez les lignes utiles dans votre shell, la
configuration de votre harnais ou votre gestionnaire de services.

Pour les variables du serveur MCP, une valeur vide (`VAR=`) compte comme absente.

## Où vivent les leçons et la progression

| Variable | Par défaut | Lue par | Rôle |
|---|---|---|---|
| `STUDIUM_HOME` | `~/.studium` | lesson-mcp, extension VS Code, tableau de bord enseignant | Racine de la bibliothèque de l'apprenant (`<STUDIUM_HOME>/library`) et de ses données (`<STUDIUM_HOME>/data`). |
| `BUNDLES_ROOT` | lesson-mcp : `<STUDIUM_HOME>/library` ; voir les autres composants plus bas | lesson-mcp et chaque serveur | Dossier où un `bundle_ref` est cherché d'abord. lesson-mcp cherche aussi dans la bibliothèque. `prepare_sources` et `create_lesson` n'écrivent jamais ici : ils écrivent toujours dans `<STUDIUM_HOME>/library`. |
| `STUDIUM_DATA_DIR` | `<STUDIUM_HOME>/data` | lesson-mcp, lesson-server, API HTTP | État durable de l'apprenant. Fixez-la pour choisir un autre dossier ; elle reste prise en compte même avec `STUDIUM_EPHEMERAL=1`. lesson-server et l'API HTTP gardent l'état en mémoire tant qu'elle n'est pas fixée. |
| `STUDIUM_EPHEMERAL` | absente | lesson-mcp | `1` (ou `true`, `yes`, `on`) garde l'état en mémoire, perdu au redémarrage. Pour les tests, démonstrations et la CI. |
| `STUDIUM_LEARNER_ID` | `anonymous` | lesson-mcp | Identifiant d'apprenant utilisé quand un appel n'en donne pas. |

Les dates des résultats d'outils et du texte montré à l'apprenant sont des jours du calendrier dans le
fuseau horaire du processus, indiqué par `get_server_info.time_zone`. Aucune variable Studium ne le règle ;
Node.js suit le réglage du système, ou `TZ` quand elle est définie.

## Vie privée et pseudonymes

| Variable | Par défaut | Lue par | Rôle |
|---|---|---|---|
| `STUDIUM_PSEUDO_SECRET` | fichier propre à l'installation `<dossier de données>/.studium-secret` (mode 0600) | lesson-mcp, lesson-server, API HTTP | Secret HMAC des pseudonymes qui nomment les dossiers d'apprenants sur disque. Un dossier de données neuf reçoit son propre secret aléatoire ; un dossier plus ancien qui contient déjà des apprenants garde l'ancien secret, pour que personne ne perde sa progression. Les serveurs en mémoire utilisent `dev-secret`. |
| `NODE_ENV`, `STUDIUM_ENV` | absentes | lesson-mcp, lesson-server, API HTTP | `production` refuse d'ouvrir une session sans vrai secret de pseudonyme (de même qu'un modèle configuré). |
| `STUDIUM_TELEMETRY_CONSENT` | absente (désactivée) | lesson-mcp, lesson-server, API HTTP | `1`, `true`, `granted` ou `yes` écrit une télémétrie de classe pseudonymisée (`telemetry.jsonl`, sans texte libre) à côté de l'état de l'apprenant. Exige un dossier de données durable. L'extension VS Code la fixe uniquement d'après son réglage. |
| `STUDIUM_PER_LEARNER_SHUFFLE` | absente | lesson-mcp, lesson-server, API HTTP | Toute valeur donne à chaque apprenant son propre ordre, reproductible, des choix de quiz. Par défaut, tous voient le même ordre. |
| `STUDIUM_MASTERY_DIR` | absente | lesson-mcp, lesson-server, API HTTP | En mode mémoire seule, dossier où écrire les assertions de maîtrise. Un dossier de données durable a priorité. |

Conservez une copie de `.studium-secret` avec le dossier de données : sans lui, les dossiers
d'apprenants existants ne peuvent plus être rattachés à leurs apprenants.

## Modèle juge (facultatif)

Sans modèle, une réponse ouverte reçoit la référence avec laquelle se comparer et l'auto-évaluation
planifie les révisions ; rien n'affirme une couverture qu'aucun juge n'a mesurée. Le modèle est
joint par un point d'accès compatible OpenAI, par exemple un proxy [LiteLLM](https://docs.litellm.ai/).

| Variable | Par défaut | Lue par | Rôle |
|---|---|---|---|
| `LITELLM_BASE_URL` | vide (pas de modèle) | lesson-mcp, lesson-server, planner | Point d'accès du modèle. Une valeur non vide active le juge, le tuteur socratique et le juge d'audit. Le planner prend `http://localhost:4000` par défaut mais ne l'appelle qu'avec `STUDIUM_LLM_MODE=litellm`. |
| `LITELLM_API_KEY` | absente | lesson-mcp, lesson-server, planner | Clé (Bearer) du point d'accès. |
| `LITELLM_MODEL` | `studium/audit-judge` | lesson-mcp, lesson-server | Nom du modèle du juge d'audit. L'évaluateur et le tuteur utilisent l'alias `studium/runtime-tutor`. |
| `STUDIUM_LLM_TIMEOUT_MS` | `20000` | lesson-mcp, lesson-server | Délai d'un appel d'évaluation ou de tutorat, en millisecondes. |

## API HTTP de lesson-mcp

Voir [API HTTP](http-api.fr.md). Démarrée par `pnpm --filter @studium/lesson-mcp api`.

| Variable | Par défaut | Lue par | Rôle |
|---|---|---|---|
| `STUDIUM_API_TOKEN` | aucune (obligatoire) | API HTTP et son client | Jeton Bearer, au moins 32 caractères. |
| `STUDIUM_API_PORT` | `8130` | API HTTP | Port, sur 127.0.0.1 uniquement. |
| `STUDIUM_API_LIVE` | absente | API HTTP | `1` active le modèle de `LITELLM_BASE_URL` ; sinon l'API n'appelle jamais de modèle. |
| `STUDIUM_API_URL` | `http://127.0.0.1:8130` | client `api:call` | Origine locale de l'API. |
| `BUNDLES_ROOT` | `../../fixtures` (depuis `apps/lesson-mcp`) | API HTTP | Leçons servies. |

## lesson-server

Le serveur REST des salles entre pairs et des pages de cours du tableau de bord enseignant
(`pnpm --filter @studium/lesson-server start`).

| Variable | Par défaut | Lue par | Rôle |
|---|---|---|---|
| `BUNDLES_ROOT` | le dossier courant | lesson-server | Leçons servies. |
| `PORT` | `8010` | lesson-server | Port, sur 127.0.0.1. |
| `LITELLM_BASE_URL` | vide | lesson-server | Comme plus haut. |

## Tableau de bord enseignant et statistiques

| Variable | Par défaut | Lue par | Rôle |
|---|---|---|---|
| `BUNDLES_ROOT` | `<STUDIUM_HOME>/library` | tableau de bord | Leçons affichées dans la bibliothèque et les pages de relecture. |
| `ANALYTICS_BASE_URL` | `http://localhost:8003` | tableau de bord | Service analytics-collector. |
| `SCENE_SYNTH_BASE_URL` | `http://localhost:8002` | tableau de bord | Service scene-synth (contributions des apprenants). |
| `LESSON_SERVER_BASE_URL` | `http://localhost:8010` | tableau de bord | lesson-server (salles entre pairs, cours). |
| `OBSERVATORY_BASE_URL` | `http://localhost:8004` | tableau de bord | Observatoire, lié depuis une leçon quand il répond. |
| `ANALYTICS_DATA_DIR` | `data` (relatif au dossier courant) | analytics-collector | Lieu de stockage de la télémétrie collectée. |
| `ANALYTICS_MIN_LEARNERS` | `5` | analytics-collector | Plus petite cohorte sur laquelle un chiffre de classe est calculé. Côté serveur uniquement, jamais en paramètre de requête. |

Les tests de bout en bout du tableau de bord lisent aussi `DASHBOARD_PORT` (`3001` par défaut),
`DASHBOARD_PORT_EXTERNAL`, `PLAYWRIGHT_CHANNEL` et `CI`. L'Observatoire a ses propres variables
(`STUDIUM_OBS_*`), décrites dans [services/observatory/observatory_config.py](../../services/observatory/observatory_config.py).

## scene-synth

| Variable | Par défaut | Lue par | Rôle |
|---|---|---|---|
| `BUNDLES_ROOT` | le dossier `fixtures/` du dépôt | scene-synth | Un dossier par cours, chacun avec son `lesson.json`. |
| `COMMUNITY_BUNDLES_ROOT` | `BUNDLES_ROOT` | scene-synth | Où sont écrites les contributions d'apprenants approuvées (`<racine>/<cours>/community/`). |
| `LEARNER_DATA_ROOT` | `/tmp/studium-learner-items` | scene-synth | Stockage des contributions soumises. |
| `LEARNER_PSEUDONYM_SECRET` | `dev-insecure-secret` | scene-synth | Secret HMAC des pseudonymes d'auteurs. À fixer pour tout déploiement réel. |
| `BUNDLE_DIR` | le dossier par défaut de la démonstration | `demo_fresh.py` | Où le bundle de démonstration est préparé. |

## Planner

Le planner répond 503 tant qu'aucun modèle n'est configuré.

| Variable | Par défaut | Lue par | Rôle |
|---|---|---|---|
| `STUDIUM_LLM_MODE` | absente | planner | `litellm` appelle le modèle ; `mock` utilise le modèle simulé déterministe (tests et démonstrations seulement). |
| `STUDIUM_LWG_BUILD` | absente | planner | `on` construit le graphe de parcours d'apprentissage de chaque plan. |
| `STUDIUM_LWG_OUT_DIR` | `.lwg` | planner, Observatoire | Dossier de sortie de ces graphes. |
| `STUDIUM_EVIDENCE_ENRICH` | absente | planner | `on` enrichit les plans de preuves issues de la littérature. |
| `STUDIUM_PERSPICACITE_ENABLED` | absente | planner | `on` active le client de littérature Perspicacité. |
| `STUDIUM_PERSPICACITE_MODE` | absente | planner | `mock` utilise un client simulé. |
| `PERSPICACITE_MCP_URL` | `http://localhost:8000/mcp` | planner | Point d'accès MCP de Perspicacité. |
| `PERSPICACITE_DOMAIN_KB` | vide | planner | Base de connaissances par défaut. |
| `STUDIUM_PERSPICACITE_CACHE` | `on` | planner | `off` désactive le cache disque des recherches. |
| `STUDIUM_PERSPICACITE_CACHE_DIR` | `.cache/perspicacite` | planner | Dossier du cache. |

## Identité de build

| Variable | Par défaut | Lue par | Rôle |
|---|---|---|---|
| `STUDIUM_BUILD_INFO` | absente | lesson-mcp lancé depuis les sources | JSON `{origin, built_at, git_sha}` que `get_server_info` rapporte au lieu d'interroger git. Un serveur empaqueté rapporte l'identité compilée et l'ignore. |

## Réglages de l'extension VS Code

Dans les réglages de VS Code (`studium.*`). L'extension démarre son propre serveur MCP avec
`BUNDLES_ROOT` tiré de `studium.bundlesRoot`, `STUDIUM_DATA_DIR` pointant vers son dossier de
stockage VS Code et `STUDIUM_TELEMETRY_CONSENT` tiré de `studium.telemetryConsent` ; le reste de
son environnement est hérité.

| Réglage | Par défaut | Rôle |
|---|---|---|
| `studium.repoRoot` | le dossier deux niveaux au-dessus de l'extension | Un checkout Studium ; s'il est trouvé, le serveur tourne depuis ses sources. Sinon, le `dist/lesson-mcp.cjs` embarqué est utilisé. |
| `studium.bundlesRoot` | vide : `fixtures/` du checkout, sinon `<STUDIUM_HOME>/library` | Dossier des leçons. |
| `studium.bundleRef` | `atomistique-l1/lesson.json` | Leçon ouverte par défaut. |
| `studium.communityBundlesRoot` | vide : `studium.bundlesRoot` | Racine des contributions d'apprenants approuvées. |
| `studium.assets` | `vendor` | `vendor` (visionneuses hors ligne) ou `cdn`. |
| `studium.learnerId` | `vscode-learner` | Identifiant d'apprenant. |
| `studium.telemetryConsent` | `false` | Télémétrie de classe consentie et pseudonymisée. |
| `studium.showGraph` | `true` | Panneau compagnon du graphe de parcours d'apprentissage. |
| `studium.graphView` | `student` | `student` (autour du concept courant) ou `teacher` (graphe entier). |
| `studium.showMastery` | `false` | Barre de maîtrise en direct ; un signal pour l'enseignant, qui peut trahir la réponse pendant un quiz. |
| `studium.modalityPreference` | `balanced` | Ordre des supports d'une scène : `visual`, `textual` ou `balanced`. |

La progression faite dans le panneau VS Code est gardée dans le stockage de l'extension, à part de
`<STUDIUM_HOME>/data` qu'utilise un assistant en terminal. « Studium : Oublier mes données » n'efface
que les données propres à l'extension.
