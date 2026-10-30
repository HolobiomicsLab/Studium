# Studium par API, avec ou sans éditeur

Studium peut fonctionner comme un moteur local que votre harnais pilote par HTTP.
VS Code devient une interface facultative. Claude Code, Codex ou un autre agent
capable d'exécuter une commande peut lire une scène, présenter une activité,
préparer un exemple, recueillir votre réponse puis laisser Studium adapter la suite.
L'API ne requiert ni MCP ni abonnement LLM pour les opérations locales déterministes.
Le modèle utilisé par votre harnais conserve ses propres conditions d'accès.

## Choisir l'interface

| Interface | Usage | Continuité |
|---|---|---|
| API HTTP locale | Harnais, scripts, outils personnalisés | Plusieurs clients peuvent reprendre le même `session_id` sur le même serveur |
| MCP stdio | Harnais disposant d'un client MCP | Chaque processus serveur possède ses sessions |
| Canal fichiers | Harnais sans MCP ni HTTP ; contexte inspectable sur disque | Garder le runner actif et suivre `task.md` et son contrat |
| Extension VS Code | Panneau scientifique, notebook et chat | Le panneau utilise son serveur MCP embarqué |

Ces interfaces partagent le moteur et les formats pédagogiques. Elles ne fusionnent
pas automatiquement les sessions de processus différents. Une reprise API depuis
un autre harnais fonctionne tant que le même serveur tourne. Un redémarrage du
serveur invalide les anciens identifiants de session. Avec le stockage durable,
`start_lesson_session` reprend au premier passage inachevé pour le même apprenant
et le même bundle ; son champ `resume` distingue `new`, `resumed` et `completed`.
Les exports restent distincts de cette continuité active.

L'ancien service REST `apps/lesson-server` (port 8010, routes `/sessions` et
`/courses`) reste compatible avec ses clients. Ses scènes utilisent également
les projections publiques. Il n'offre pas la découverte, l'authentification ni
les reçus de reprise de l'API `/v1/operations` décrite ici. Ce sont deux processus
distincts ; leurs identifiants de session ne sont pas interchangeables. Pour une
nouvelle intégration de harnais, utiliser le service décrit ci-dessous.

## Démarrer le serveur local

Depuis un checkout Studium installé (`pnpm install`), choisissez une racine de
bundles relus. Dans un terminal que vous gardez ouvert :

```sh
export BUNDLES_ROOT="/ABS/PATH/studium/fixtures"
export STUDIUM_API_TOKEN="$(openssl rand -hex 32)"
pnpm --filter @studium/lesson-mcp api
```

Le serveur écoute uniquement `http://127.0.0.1:8130`. `STUDIUM_API_PORT` permet de
changer le port. Fournissez le même token à l'environnement des clients avec votre
mécanisme local de secrets ; ne le collez pas dans la conversation ou Git.
Il faut au moins 32 caractères. Le serveur ne l'affiche pas. N'exécutez pas à
nouveau la génération du token dans chaque client : ils doivent partager la même valeur.

Cette API vise **une personne et ses harnais locaux**, pas une classe sur Internet.
Un détenteur du token peut accéder aux sessions de ce serveur. Les requêtes de
navigateur portant `Origin` sont refusées ; les viewers passent par le harnais,
sans incorporer de token dans leur HTML. Pas de CORS général, serveur distant,
proxy public, authentification par étudiant ou installation globale automatique.

Le backend modèle reste inactif par défaut, même si `LITELLM_BASE_URL` existe dans
votre environnement. Son activation exige `STUDIUM_API_LIVE=1` et une configuration
backend autorisée. Le traçage durable reste soumis aux paramètres de consentement
du moteur ; garder ces paramètres désactivés pour un premier essai.

## Découvrir puis démarrer une leçon

Depuis le checkout, dans l'environnement client :

```sh
pnpm --silent --filter @studium/lesson-mcp api:call health
pnpm --silent --filter @studium/lesson-mcp api:call operations
```

La découverte fournit les descriptions, schémas JSON des arguments et exigences
de chaque opération. L'API utilise `GET /health`, `GET /v1/operations` et
`POST /v1/operations/<nom>`. Les noms sont ceux de MCP ; les résultats gardent
leurs champs habituels, sans enveloppe MCP. Le token passe dans l'en-tête
`Authorization: Bearer …`. Un client HTTP peut appeler ces routes directement.

Créez un fichier privé `/ABS/PATH/start.json` :

```json
{
  "request_id": "lesson-start-001",
  "arguments": {
    "bundle_ref": "capsule-judgment-demo/lesson.json",
    "learner_id": "local-student",
    "presentation_language": "fr"
  }
}
```

Puis :

```sh
pnpm --silent --filter @studium/lesson-mcp api:call start_lesson_session /ABS/PATH/start.json
```

Conservez le `session_id` retourné. Dans `/ABS/PATH/context.json` :

```json
{"arguments":{"session_id":"SESSION_ID_RETOURNE"}}
```

```sh
pnpm --silent --filter @studium/lesson-mcp api:call get_operator_context /ABS/PATH/context.json
```

Ce contexte contient la scène publique, les supports, la langue, les instructions
d'expérimentation et le contrat de réponse. L'agent doit présenter ce contenu et
attendre la contribution de l'apprenant. Les exemples de réponse du contrat sont
des **gabarits à remplir**, jamais des réponses à soumettre telles quelles.

## Répondre, expérimenter et changer de harnais

Pour acquitter l'introduction, après votre confirmation, créez `answer.json` :

```json
{
  "request_id": "intro-response-001",
  "expected_scene_id": "s-intro",
  "arguments": {"session_id":"SESSION_ID_RETOURNE","input":{"kind":"ack"}}
}
```

```sh
pnpm --silent --filter @studium/lesson-mcp api:call submit_response /ABS/PATH/answer.json
```

Pour une autre scène, utilisez son identifiant et son contrat réel. Les opérations
`submit_response`, `submit_turn`, `request_hint`, `record_experiment` et
`submit_run_result` exigent `expected_scene_id`. Toutes les mutations exigent un
`request_id` unique. Une relance **identique**, avec le même ID, restitue la réponse
précédente sans répéter l'action. Une action nouvelle prend un nouvel ID. Les
arguments, y compris leur ordre JSON, doivent rester identiques lors d'une relance.
Les lectures n'exigent pas de `request_id` et sont calculées à nouveau.

| Situation | Réponse | Suite |
|---|---|---|
| `400` | JSON, schéma ou identifiant requis invalide | Corriger selon la découverte ; aucune réponse acceptée |
| `401` / `403` | Token, origine ou adresse non autorisés | Vérifier le client local ; ne pas exposer le serveur |
| `404` | Opération ou session indisponible | Vérifier serveur/session ; ne pas inventer une reprise |
| `409 stale_scene` | La scène a changé | Relire le contexte et demander la contribution appropriée |
| `409 request_conflict` | ID réutilisé pour un contenu différent | Inspecter l'action précédente avant un nouvel ID |
| `410 forgotten` | Ancien résultat effacé | Respecter l'effacement ; ne pas recréer implicitement |
| `413` / `415` | Corps trop volumineux ou mauvais type | JSON de moins de 1 Mio ; médias sous forme de références |
| `422` | Le moteur refuse l'opération | Lire l'erreur ; ne pas forcer l'avancement |
| `503` | File d'attente ou reçus pleins | Réessayer avec le même ID si occupé ; exporter avant redémarrage si reçus pleins |

Les opérations sont sérialisées. Le serveur conserve au plus 512 reçus de mutation ordinaires
pendant sa durée de vie et refuse les nouvelles mutations quand cette limite est
atteinte (ou après avoir atteint 16 Mio de résultats conservés), plutôt que d'oublier silencieusement la protection des anciennes réponses.
L'effacement d'une session reste possible et ajoute au plus un reçu supplémentaire par session existante. Une erreur réseau après envoi laisse
l'issue incertaine : réutiliser le fichier original et son ID, sans soumettre une
seconde contribution. Aucun retry automatique du client. La protection par scène
ne remplace pas une coordination humaine de deux agents intervenant simultanément
sur la même scène.

Pour alterner Claude Code et Codex, transmettre au nouveau harnais l'adresse locale,
le `session_id`, le mode (enseignement ou test synthétique), la langue et la dernière
action éventuellement en attente. Configurer le token hors conversation. Le nouveau
harnais commence par `get_operator_context` et, avec consentement, le journal.
**Ne pas redémarrer la leçon pour simplement changer de harnais.**

## Exemple agentique : comprendre un résultat scientifique

Prompt de départ adaptable :

> Utilise le skill studium-harness et l'API locale déjà configurée. Reprends la
> session indiquée et présente la scène en français. Aide-moi à explorer les
> hypothèses avec un petit exemple ou viewer si utile. Avant de montrer un
> résultat, recueille ma prédiction. Garde mes mots pour la réponse, distingue
> source scientifique, simulation et illustration, et laisse Studium décider
> de la suite. Ne réponds pas à ma place.

Le harnais peut rechercher une documentation officielle, utiliser ses skills de
domaine, préparer des dépendances ou créer une visualisation selon les outils et
permissions effectivement disponibles. Studium fournit le contexte pédagogique ;
il n'exécute pas le code généré et ne confère pas de permission supplémentaire.
Une installation, recherche ou génération multimodale n'est pas un résultat
scientifique attesté. Garder les sources, versions et limites avec le support.

Pour une reproduction : `get_run_manifest` → exécution réelle par le harnais →
`submit_run_result` avec la scène courante et un ID de requête. Pour une exploration :
`record_experiment` respecte prédiction → début → observation → conclusion, avec
consentement et contributions personnelles. Consulter le
[journal](../user/experiment-journal.md), les [templates](../../skills/studium-activity-templates/SKILL.md)
et les [supports visuels](sourced-and-generated-media.md). L'API ne contourne ni
attestation, ni validation enseignante d'un cours préparé à partir de littérature.

## Export et fin de séance

`get_experiment_journal` renvoie le journal standard, sans nouveau format HTTP
spécifique. Le client permet de le conserver pour un export local :

```sh
pnpm --silent --filter @studium/lesson-mcp api:call get_experiment_journal /ABS/PATH/context.json > /ABS/PATH/journal.json
.venv/bin/python tools/learner_report.py export /ABS/PATH/new-report --journal /ABS/PATH/journal.json
.venv/bin/python tools/learner_report.py verify /ABS/PATH/new-report
```

Le rapport réutilise ASTRA/ARA/MySTRA et son viewer ; l'export est expurgé par défaut.
Les réponses ordinaires ne deviennent pas automatiquement des entrées du journal
expérimental. Exporter explicitement les données voulues avant de fermer le serveur.

`end_session` ferme la session et conserve l'état durable, le profil inter-leçons
et le journal expérimental durable. `forget_session` demande leur effacement
irréversible. Les deux opérations invalident les résultats API mis en cache de
l'ancien identifiant ; elles ne suppriment pas les copies déjà exportées ni
l'historique du harnais. Garder le serveur actif pour reprendre le même identifiant,
ou démarrer une nouvelle session pour reprendre les données conservées. Utiliser le
[canal fichiers](../getting-started/harnesses-and-api.md#sans-mcp-et-lors-dun-changement-de-harnais)
si l'on préfère piloter la séance via des fichiers inspectables.

## Vérifier une installation de développement

Depuis le checkout, choisir des répertoires de sortie neufs :

```sh
node apps/lesson-mcp/scripts/http-smoke.mjs /ABS/PATH/new-api-audit
node tools/audit-vscode-harness.mjs /ABS/PATH/new-viewer-audit
```

Le premier démarre un serveur temporaire, emploie plusieurs processus clients,
exporte et vérifie un rapport puis arrête ce serveur. Les contributions sont
explicitement synthétiques ; aucune exécution scientifique ni génération modèle.
Le second nécessite Chrome et les dépendances de développement du dépôt. Il vérifie
le renderer du panneau, les thèmes, le rendu KaTeX et les doubles clics dans Chrome,
pas une installation réelle du VS Code Extension Host.
