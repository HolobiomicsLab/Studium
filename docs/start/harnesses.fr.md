[English](harnesses.md) · Français

# Connecter votre assistant

Studium fonctionne comme un serveur MCP que votre assistant IA lance sur votre ordinateur. Une fois la
connexion faite, vous pouvez dire « je veux apprendre X avec Studium » : l'assistant prépare, joue et
planifie vos leçons avec les outils de Studium. Cette page donne une configuration prête pour chaque
assistant pris en charge (le client de l'assistant est appelé *harnais* ; voir le
[glossaire](../concepts/glossary.fr.md)), puis l'API HTTP directe et le canal fichiers pour les scripts.

## Avant de commencer

Terminez l'[installation](installation.fr.md). Toutes les configurations ci-dessous lancent le serveur
construit `apps/studium-vscode/dist/lesson-mcp.cjs` avec `node` ; remplacez `/path/to/studium` par le chemin
absolu de votre clone. Le serveur dialogue par stdio : il n'ouvre aucun port et n'affiche aucune page web.

| Réglage | Effet |
|---|---|
| Pas de `BUNDLES_ROOT` (recommandé) | les leçons vivent dans `~/.studium/library`, la progression dans `~/.studium/data` |
| `BUNDLES_ROOT=/path/to/studium/fixtures` | jouer les leçons de démonstration du dépôt ; les leçons que votre assistant prépare vont toujours dans `~/.studium/library` |
| `LITELLM_BASE_URL=""` | aucun modèle juge, même si votre shell en définit un (voir [Modèle juge facultatif](#modèle-juge-facultatif)) |
| `STUDIUM_EPHEMERAL=1` | garder la progression en mémoire seulement, pour une démonstration ou un test |

Les fichiers de [docs/examples](../examples/) sont des exemples complets qui ajoutent `BUNDLES_ROOT` pour les
leçons de démonstration : [codex.toml](../examples/codex.toml), [mcp.claude.json](../examples/mcp.claude.json),
[mcp.vscode.json](../examples/mcp.vscode.json) et [opencode-v2.json](../examples/opencode-v2.json).
Fusionnez-les dans le fichier de votre client, sans écraser les autres serveurs déjà déclarés. Toutes les
variables sont décrites dans [Configuration](../reference/configuration.fr.md).

## Vérifier la connexion

Une entrée de configuration, ou un skill découvert par le client, ne prouve pas que le serveur est
connecté. Demandez :

```text
Appelle l'outil Studium get_server_info et donne-moi la version, la date du build, le nombre d'outils et
si ma progression est durable. Appelle ensuite get_study_plan.
```

La réponse doit annoncer 40 outils (25 de leçon, 5 d'étude, 3 de rédaction, 2 pour l'enseignant, 1 de formulaires, 3 de panneau, 1 d'accompagnement ; voir
[Outils MCP](../reference/mcp-tools.fr.md)) et `persistence.durable: true`. Si `durable` vaut false, la
progression est perdue à l'arrêt du serveur. À la connexion, l'assistant reçoit aussi les instructions de
Studium (montrer chaque `display_markdown` tel quel, attendre votre propre réponse, ne jamais répondre ni
noter à votre place) et deux prompts, `learn` et `review`, dans les clients qui prennent en charge les
prompts MCP.

## Garder des réponses rapides

Studium note une réponse et choisit l'écran suivant en quelques millisecondes. Ce que vous attendez, c'est
l'assistant qui relaie. Trois choix décident de l'essentiel de cette attente :

- **Une session pour la leçon.** Jouez une leçon dans une session neuve et courte, pas à la fin d'une longue
  conversation de travail : chaque réponse traîne toute la conversation derrière elle.
- **Un modèle rapide.** Relayer ne demande aucun raisonnement, puisque Studium note et oriente. Gardez le
  grand modèle pour une question qui demande une vraie explication.
- **La connexion MCP** décrite sur cette page, et non des appels shell à l'API HTTP : chaque appel shell
  lance un processus.

Mesuré sur la leçon de démonstration `atomistique-l1` avec `tools/latency_bench.py` (Claude Code, médianes
sur six réponses, 6 novembre 2026) :

| Qui relaie | Fin de la réponse | Premier mot |
|---|---|---|
| un grand modèle, par appels shell, à la fin d'une longue session de travail (essai réel, application de bureau) | 27 s | environ 20 s |
| le même grand modèle, session courte, outils MCP | 8,2 s | 5,4 s |
| le modèle rapide, session courte, outils MCP | 5,4 s | 2,0 s |
| l'agent de leçon `studium-lesson` comme session (voir [Claude Code](#claude-code)) | 5,5 s | 1,9 s |
| un grand modèle qui confie chaque réponse à cet agent rapide | 16,1 s | 13,5 s |

Une exécution par ligne : un écart d'une seconde entre deux lignes n'est pas établi. Le banc mesure un
relais dans Claude Code ; il ne mesure ni les autres clients de cette page, ni ce que quiconque apprend.
Baisser l'effort de raisonnement n'a rien changé de mesurable. La dernière ligne est le piège : un agent
placé entre vous et le serveur fait écrire chaque écran par deux modèles.

Un prototype va un pas plus loin : là où le client sait afficher des formulaires (élicitation MCP),
`play_in_forms` laisse Studium poser lui-même les questions. Vous lisez un écran ou choisissez une réponse
dans un formulaire, le verdict ouvre le formulaire suivant, et aucun modèle n'écrit entre les deux ; la
conversation reprend quand une étape demande vos propres mots ou quand vous fermez un formulaire pour poser
une question. Quand la leçon possède une carte des notions, chaque formulaire d'étape propose `map` : le
formulaire de carte liste chaque notion avec son identifiant, revient à l'étape intacte s'il est validé vide,
ou prend `contest_concept` et `claim` (`known` ou `unsure`) pour poser les questions de contrôle avant de
reprendre cette étape. Seuls un indice, une question ou une proposition demandent encore la conversation,
comme l'indique la ligne d'aide. Un formulaire ne vous demande jamais de dire « continuer », puisqu'on ne
peut rien y dire. Demandez à votre assistant de « jouer les prochaines étapes en formulaires ». La façon dont
un vrai client affiche un écran long, une formule ou ce formulaire de carte n'a pas encore été observée.

Sans modèle entre les deux, la part du serveur est petite : une réponse donnée dans un formulaire ou sur un
panneau reçoit son verdict en moins de 20 ms au 95e centile, transport compris (même script, `--mode forms`
et `--mode panel`, trois exécutions de 32 à 40 réponses chacune, l'état de l'apprenant enregistré sur
disque, 6 novembre 2026). Le temps qu'un client met ensuite à dessiner l'écran n'est pas dans ce chiffre et
n'a pas été mesuré.

## Codex

Installez Codex et connectez-vous selon le [démarrage Codex](https://learn.chatgpt.com/docs/quickstart) ;
les options MCP sont dans [MCP dans Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Ajoutez
ensuite le serveur depuis votre clone :

```bash
codex mcp add studium --env LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
codex mcp list
```

ou fusionnez ceci dans `~/.codex/config.toml` :

```toml
[mcp_servers.studium]
command = "node"
args = ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]

[mcp_servers.studium.env]
LITELLM_BASE_URL = ""
```

Un profil Codex avec `approval_policy = "never"` refuse tout appel à un serveur MCP stdio local
(`MCP tool call requires approval, but approval policy is never`). Répondez aux demandes d'approbation dans
une session interactive, ou lancez en mode non interactif avec `codex exec --approve-for-me` (incompatible
avec `-s/--sandbox`). Pour un essai ponctuel avec un autre dossier de leçons, passez tout par `-c` :

```bash
codex exec --approve-for-me --skip-git-repo-check -C /path/to/workdir \
  -c 'mcp_servers.studium.command="node"' \
  -c 'mcp_servers.studium.args=["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]' \
  -c 'mcp_servers.studium.env={BUNDLES_ROOT="/path/to/lessons",LITELLM_BASE_URL=""}' \
  - < prompt.md
```

Le serveur Studium n'écrit que dans son dossier de données ; il n'exécute jamais lui-même une capsule.

## Claude Code

Installez Claude Code et connectez-vous selon la [procédure officielle](https://code.claude.com/docs/en/setup).
Depuis votre clone :

```bash
claude mcp add --scope project studium -e LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
claude mcp list
```

`--scope project` écrit `.mcp.json` à la racine du projet, sous cette forme :

```json
{
  "mcpServers": {
    "studium": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"],
      "env": { "LITELLM_BASE_URL": "" }
    }
  }
}
```

Dans une session, `/mcp` montre la connexion. Pour une exécution non interactive, passez le fichier de
configuration et autorisez explicitement les outils Studium :

```bash
claude -p --mcp-config .mcp.json --strict-mcp-config \
  --allowedTools "mcp__studium__*" --permission-mode dontAsk --max-budget-usd 2 \
  "Appelle get_server_info, puis get_study_plan, et montre-moi le résultat."
```

### L'agent de leçon

Le dépôt fournit deux définitions d'agent dans `.claude/agents/`. `studium-lesson` joue une leçon ou une
révision en relais strict sur le modèle rapide : il montre chaque écran tel que Studium l'a écrit, envoie
vos mots et n'ajoute rien. `studium-explainer` est un modèle plus fort qu'il appelle quand votre question
demande une vraie explication ; la leçon continue pendant que l'explication s'écrit. Son texte s'ouvre par
« Explication générée », pour que vous le distinguiez de celui de la leçon. L'agent de leçon ouvre une
leçon sur la meilleure surface que votre client sait afficher (un panneau ou un volet, des formulaires, ou
la conversation). Quand vous revenez vers lui après y avoir joué, il lit d'abord ce que vous avez fait,
pour ne pas vous remontrer un écran. Un client qui affiche les MCP Apps peut montrer le panneau même quand
la leçon se joue dans la conversation ou en formulaires : le panneau le dit alors (« Cette leçon se joue dans
la conversation », « Le panneau n'est pas la surface négociée pour cette séance. ») et ne dessine ni
scène ni contrôle de réponse, pour que vous répondiez là où la leçon se joue. Son bouton « Jouer ici »,
présent quand votre client sait afficher le panneau, demande au serveur de passer la séance sur le
panneau. Depuis le checkout :

```bash
claude --agent studium-lesson
```

Pour les utiliser depuis n'importe quel dossier, liez-les une fois à vos agents personnels :

```bash
mkdir -p ~/.claude/agents
ln -s "$PWD/.claude/agents/studium-lesson.md" "$PWD/.claude/agents/studium-explainer.md" ~/.claude/agents/
```

Dans un dossier qui ne sert qu'à étudier, `{"agent": "studium-lesson"}` dans `.claude/settings.json` fait de
chaque session une session de leçon. Dans une session déjà ouverte, `/model haiku` le temps de la leçon
apporte l'essentiel du même gain. Ne demandez pas à un grand modèle de confier chaque réponse à l'agent
(voir [Garder des réponses rapides](#garder-des-réponses-rapides)).

### La ligne d'état

En mode durable, Studium note où en est la leçon dans `status.json`, dans votre dossier d'apprenant, à
chaque écran et à chaque réponse. Le script `tools/studium_statusline.mjs` en affiche la ligne, celle qui
termine chaque écran :

```text
Les atomes · étape 2/3 · 3 min · à toi de répondre
```

La ligne tient en 80 caractères au plus. Un long titre de leçon est coupé avant son dernier séparateur qui
tient (« Atomistique L1 — Chapitre 1 (atomes, orbitales) » devient « Atomistique L1 — Chapitre 1 »), pour ne
pas changer d'un écran à l'autre. Pendant les questions de vérification d'une notion que vous avez contestée,
l'étape laisse la place à « contrôle 1/2 » (« check 1/2 » dans une leçon en anglais).

Pour l'afficher dans la ligne d'état de Claude Code, ajoutez ceci à `~/.claude/settings.json` :

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /path/to/studium/tools/studium_statusline.mjs"
  }
}
```

Le script ne demande aucune installation et n'affiche rien quand aucune leçon n'est en cours : séance
fermée, serveur arrêté, ou progression gardée en mémoire seulement (`STUDIUM_EPHEMERAL=1`), où rien n'est
écrit. Il trouve le dossier de données comme le serveur (`STUDIUM_DATA_DIR`, sinon `<STUDIUM_HOME>/data`) ;
`--data-dir=DOSSIER` en désigne un autre. Si vous avez donné `STUDIUM_DATA_DIR` ou `STUDIUM_HOME` au serveur
dans `.mcp.json`, donnez le même au script. Avec plusieurs leçons ouvertes sur une machine, il montre celle
qui a bougé en dernier, dans toutes les fenêtres de Claude Code.

Cette configuration vise Claude Code, pas l'application de bureau Claude.

## Copilot dans VS Code

Copilot Chat en mode agent lit les serveurs MCP dans `.vscode/mcp.json`. Ouvrez le clone comme espace de
travail et fusionnez :

```json
{
  "servers": {
    "studium": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/apps/studium-vscode/dist/lesson-mcp.cjs"],
      "env": { "LITELLM_BASE_URL": "" }
    }
  }
}
```

Dans la palette de commandes, lancez **MCP: List Servers**, sélectionnez `studium` et démarrez-le ; son
journal montre les erreurs. VS Code utilise la clé `servers`, pas la clé `mcpServers` de Claude Code et de
Cursor. Référence : [serveurs MCP dans VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

Les étudiants peuvent obtenir Copilot par GitHub Education : demandez la vérification étudiante
([GitHub Education pour les étudiants](https://docs.github.com/en/education/about-github-education/github-education-for-students/apply-to-github-education-as-a-student)),
puis activez Copilot Student dans vos paramètres Copilot
([configurer Copilot pour les étudiants](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students)).
Vérification et activation sont deux étapes distinctes, et l'avantage peut mettre plusieurs jours à
apparaître : vérifiez l'état de votre demande avant de payer. Les enseignants vérifiés ont leur propre
parcours ([enseignants](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-teachers-and-os-maintainers)).
Envoyez vos justificatifs à GitHub uniquement, jamais dans un dépôt de cours. Offres, modèles et limites
sont fixés par GitHub et évoluent.

Le panneau de leçon de l'extension Studium lance son propre serveur. Le client MCP de Copilot et le panneau
ne partagent pas la scène courante : pilotez une leçon depuis l'un des deux à la fois. Voir
[VS Code](vscode.fr.md).

## OpenCode

Installez OpenCode et configurez un fournisseur selon la
[documentation OpenCode v2](https://opencode.ai/v2/docs) et sa [page MCP](https://opencode.ai/v2/docs/mcp-servers).
Pour OpenCode v2, fusionnez ceci dans `opencode.jsonc` à la racine du projet :

```json
{
  "mcp": {
    "servers": {
      "studium": {
        "type": "local",
        "command": ["node", "/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"],
        "environment": { "LITELLM_BASE_URL": "" }
      }
    }
  }
}
```

`opencode mcp list` affiche la connexion. Les versions antérieures d'OpenCode utilisent une autre forme de
configuration. Un modèle ouvert proposé par votre fournisseur n'est par défaut ni gratuit, ni local, ni de
qualité équivalente.

## Cursor

Fusionnez ceci dans `.cursor/mcp.json` et activez les outils comme l'explique la
[documentation MCP de Cursor](https://cursor.com/docs/mcp) :

```json
{
  "mcpServers": {
    "studium": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"],
      "env": { "LITELLM_BASE_URL": "" }
    }
  }
}
```

## API HTTP directe

Pour les scripts et les clients sur mesure, Studium fonctionne aussi comme une API JSON locale. Elle sert
26 opérations : les 25 opérations de leçon et `rate_recall`, afin d'enregistrer l'auto-évaluation demandée
par une transition HTTP. Les autres outils d'étude (`get_study_plan`, `list_lessons`,
`start_review_session`) et tous les outils de rédaction et enseignant sont réservés à MCP dans cette
version. Lancez-la dans un terminal que vous gardez ouvert :

```bash
export STUDIUM_API_TOKEN="$(openssl rand -hex 32)"   # au moins 32 caractères, partagé avec vos clients
pnpm --filter @studium/lesson-mcp api
```

Elle n'écoute que `http://127.0.0.1:8130` (`STUDIUM_API_PORT` change le port), refuse les requêtes de
navigateur qui portent un en-tête `Origin` et lit les leçons dans `BUNDLES_ROOT` (par défaut le dossier
`fixtures/` du clone). La progression reste en mémoire sauf si `STUDIUM_DATA_DIR` est défini, et le modèle
juge reste inactif sauf avec `STUDIUM_API_LIVE=1`. Gardez le jeton dans votre environnement, jamais dans une
conversation ni dans Git. Ensuite, depuis le clone :

```bash
pnpm --silent --filter @studium/lesson-mcp api:call health
pnpm --silent --filter @studium/lesson-mcp api:call operations
pnpm --silent --filter @studium/lesson-mcp api:call start_lesson_session start.json
```

avec `start.json` :

```json
{
  "request_id": "lesson-start-001",
  "arguments": { "bundle_ref": "capsule-judgment-demo/lesson.json", "learner_id": "local-student", "presentation_language": "fr" }
}
```

Chaque mutation demande un `request_id` unique ; renvoyer la même requête avec le même identifiant
restitue le premier résultat au lieu d'agir deux fois, ce qui rend sûre une relance après une erreur
réseau. `submit_response`, `submit_turn`, `request_hint`, `record_experiment` et `submit_run_result`
demandent aussi `expected_scene_id`. `rate_recall` demande un `request_id`, mais pas
`expected_scene_id` : passez la scène demandée dans `arguments.scene_id`. Routes, codes de statut et limites sont dans la
[référence de l'API HTTP](../reference/http-api.fr.md). L'ancien service REST `apps/lesson-server`
(port 8010, corrigés masqués) est un processus distinct dont les identifiants de session ne sont pas
interchangeables avec ceux de cette API ; utilisez cette API pour intégrer un nouveau harnais.

Pour changer d'assistant au milieu d'une leçon, gardez le même serveur actif et donnez au nouvel assistant
le `session_id`, la langue et l'éventuelle action en attente ; il lit `get_operator_context` avant d'agir.
Ne redémarrez pas la leçon. Un redémarrage du serveur met fin à ses sessions : un appel sur un ancien
`session_id` répond `session not found` et dit comment reprendre. Avec un stockage durable, un
nouveau `start_lesson_session` pour le même apprenant et la même leçon reprend à la première étape non
terminée. Sur un panneau ou un volet, l'action suivante de l'apprenant sur l'ancienne session remplace la
scène par « Séance perdue (le serveur a redémarré ou la séance a été fermée). Rouvre la leçon : ta
progression est conservée. » et un bouton pour rouvrir : celui du panneau MCP Apps et celui du volet
Claude Code ouvrent la même leçon pour le même apprenant (le volet Claude Code donne aussi
`/studium <bundle_ref>`), celui du volet VS Code le ferme et ouvre la leçon dans un nouveau volet. Rien
n'est relancé tout seul.

Exportez ce que vous voulez garder avant d'arrêter un serveur en mémoire. Avec `context.json` contenant
`{"arguments":{"session_id":"<id>"}}` :

```bash
pnpm --silent --filter @studium/lesson-mcp api:call get_experiment_journal context.json > journal.json
.venv/bin/python tools/learner_report.py export new-report --journal journal.json
```

Voir [Rapport de l'apprenant](../learn/learner-report.fr.md) pour le contenu du rapport.

## Canal fichiers

Sans MCP ni HTTP, un runner écrit chaque étape dans `task.md`, dans un dossier de session, et attend
`response.json`, écrit de façon atomique (`response.json.tmp`, puis renommage). Pour l'essayer avec un
opérateur fictif :

```bash
apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --dir=/path/to/new-session --stub
```

Le dossier doit être nouveau. Sans `--stub`, le runner attend de vraies réponses. Le
[skill harnais](../../skills/studium-harness/SKILL.md) décrit les formats.

## Modèle juge facultatif

Par défaut, aucun modèle ne note les réponses ouvertes : vous recevez la référence pour vous comparer, et
aucun retour n'affirme une couverture que rien n'a mesurée. Un juge est un point d'accès compatible OpenAI
(par exemple un proxy LiteLLM) défini par `LITELLM_BASE_URL` et, si besoin, `LITELLM_API_KEY`. Le serveur
MCP l'utilise dès que la variable n'est pas vide ; l'API HTTP exige en plus `STUDIUM_API_LIVE=1`. Gardez
les clés dans votre gestionnaire de secrets local et vérifiez les indicateurs de repli d'un essai réel : un
HTTP 200 ne prouve pas qu'un modèle a répondu. Un proxy doit router les alias de modèles qu'appelle
Studium : `studium/planner`, `studium/critic`, `studium/graph-builder`, `studium/scene-synth`,
`studium/teacher-review` et `studium/runtime-tutor`.
