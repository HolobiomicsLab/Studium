# Choisir et connecter son harnais

Studium expose une [API HTTP locale](../guides/api-and-harness.md), un serveur MCP
**stdio** et un canal fichiers. Ici, « visuel » désigne **Visual Studio Code**,
pas Visual Studio IDE ; « Open » désigne **OpenCode**. Le moteur pédagogique est
commun ; comptes, outils et permissions appartiennent au harnais.

Terminer l'[installation](installation.md) avec la révision fournie pour le pilote.
Les recettes MCP utilisent le serveur compilé, sans `tsx` global. Remplacer chaque
`/ABS/PATH/studium` par le chemin réel du clone, avec ses assets.

## Choisir sa route

| Route | Compte nécessaire | Usage |
|---|---|---|
| [Panneau ou notebook VS Code](installation.md#panneau-ou-notebook-vs-code) | Aucun compte LLM pour la démo | Première leçon visuelle |
| [VS Code + Copilot](copilot.md) | Avantage Education activé ou offre compatible | Agent dans l'éditeur |
| [Claude Code](#claude-code) | Authentification et offre compatibles | Agent local en terminal/éditeur |
| [Codex](#codex) | Accès ChatGPT admissible ou clé API | Agent local dans l'application, le CLI ou l'IDE |
| [OpenCode](#opencode) | Fournisseur configuré dans le client | Alternative avec son choix de modèle |
| [API directe](#api-directe-et-changement-de-harnais) | Token local Studium ; compte du harnais distinct | Scripts ou reprise entre harnais |
| [Canal fichiers](#canal-fichiers) | Selon le harnais choisi | Boucle inspectable sans MCP ni HTTP |

Un avantage Copilot ne fournit pas une clé API générale. Dans Codex, connexion
ChatGPT et clé API sont deux modes ; l'usage par clé est facturé séparément selon
[l'authentification officielle](https://learn.chatgpt.com/docs/auth). La génération
backend Studium est encore un choix distinct, décrit plus bas. Aucun tarif ni
quota n'est figé dans le cours.

Ces recettes concernent un **harnais local**. Un agent cloud ne voit pas les
fichiers ni `127.0.0.1` de votre ordinateur. Aucun tunnel ou service de classe
distant n'est configuré par ces étapes.

## Vérifier une connexion avant d'apprendre

1. Vérifier que le client voit le checkout et le bundle de même révision.
2. Lire les opérations réellement accessibles : `tools/list` pour MCP,
   `/v1/operations` pour l'API.
3. Appeler `start_lesson_session`, puis `get_operator_context` avec le
   `session_id` retourné. La réponse doit contenir la scène publique et son contrat.
4. Présenter l'activité et attendre la contribution de l'étudiant. L'agent ne
   remplit pas la prédiction ni la confiance pour tester la connexion.

Continuer avec la [première séance](../tutorials/first-lesson.md). Une entrée de
configuration ou un skill découvert ne prouve pas qu'un serveur est connecté.

## Claude Code

Installer et authentifier le client selon la [procédure officielle](https://code.claude.com/docs/en/setup).
Ouvrir le clone Studium dans le terminal et lancer `claude` pour compléter la
connexion si nécessaire. Fusionner [l'exemple MCP](../examples/mcp.claude.json)
dans `.mcp.json`, ou utiliser depuis ce projet :

```sh
claude mcp add --transport stdio --scope project --env BUNDLES_ROOT=/ABS/PATH/studium/fixtures --env LITELLM_BASE_URL= studium -- node /ABS/PATH/studium/apps/studium-vscode/dist/lesson-mcp.cjs
claude mcp list
```

En mode non interactif (`claude -p`), le serveur se passe sur la ligne de commande
et les outils doivent être autorisés explicitement (vérifié le 2026-10-29,
Claude Code 2.1.304 ; une séance de six scènes coûte de l'ordre de 0,15 $ avec
un modèle Sonnet) :

```sh
claude -p --mcp-config mcp.studium.json --strict-mcp-config \
  --allowedTools "mcp__studium__*" --permission-mode dontAsk --max-budget-usd 2 \
  "Appelle get_server_info, puis start_lesson_session sur atomistique-l1/lesson.json …"
```

Inspecter la connexion avec `/mcp`. Les options avant le nom du serveur et la
structure `mcpServers` suivent la [documentation Claude Code MCP](https://code.claude.com/docs/en/mcp).
Ce parcours vise Claude Code ; il ne configure pas automatiquement Claude Desktop.

> Lis `skills/studium-student/SKILL.md`, vérifie la connexion Studium et accompagne
> ma première leçon en français. Attends mes propres réponses.

Pour préparer un cours, utiliser `studium-teacher` et le
[tutoriel littérature](../tutorials/literature-to-course.md).

## Codex

Installer le client local depuis le [démarrage officiel Codex](https://learn.chatgpt.com/docs/quickstart).
Dans le CLI, `codex login` lance la connexion et `codex login status` indique son
mode. Dans l'application ou l'extension IDE, utiliser le parcours de connexion de
cette interface. Ouvrir le clone Studium comme projet local.

Ajouter le serveur, ou fusionner [l'exemple TOML](../examples/codex.toml) dans la
configuration appropriée, sans écraser les serveurs existants :

```sh
codex mcp add studium --env BUNDLES_ROOT=/ABS/PATH/studium/fixtures --env LITELLM_BASE_URL= -- node /ABS/PATH/studium/apps/studium-vscode/dist/lesson-mcp.cjs
codex mcp list
```

Vérifier les outils dans la session après reconnexion. Référence :
[MCP dans Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

**Politique d'approbation.** Un profil Codex à `approval_policy = "never"` refuse
*chaque* appel d'outil MCP d'un serveur stdio local avec
`MCP tool call requires approval, but approval policy is never` (observé le
2026-10-29, Codex CLI 0.154.0). En mode non interactif, lancer avec
`--approve-for-me` (incompatible avec `-s/--sandbox`), ou laisser la politique
`on-request` d'une session interactive répondre aux demandes. Le serveur Studium
n'écrit que dans `STUDIUM_DATA_DIR` (état durable de l'apprenant) ; il n'exécute
jamais de capsule.

Pour un essai hors configuration (bundles d'un autre dossier), tout se passe
par `-c` :

```sh
codex exec --approve-for-me --skip-git-repo-check -C /ABS/WORKDIR \
  -c 'mcp_servers.studium.command="node"' \
  -c 'mcp_servers.studium.args=["/ABS/PATH/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]' \
  -c 'mcp_servers.studium.env={BUNDLES_ROOT="/ABS/BUNDLES",LITELLM_BASE_URL="",STUDIUM_DATA_DIR="/ABS/DATA"}' \
  - < prompt.md
```

Dans une exécution TypeScript depuis les sources, la CLI `tsx` ouvre un socket IPC.
Si le bac à sable le refuse (`listen EPERM`), utiliser le chargeur sans IPC :

```sh
node --import /ABS/PATH/studium/apps/lesson-mcp/node_modules/tsx/dist/loader.mjs \
  /ABS/PATH/studium/apps/lesson-mcp/src/session-runner-cli.ts \
  capsule-run-demo/lesson.json --dir=/ABS/WORKDIR/.studium-session
```

## Contrat d'une séance

Les choix d'un quiz sont remélangés et relettrés à chaque session : envoyer
l'identifiant **affiché dans la scène courante**, jamais celui mémorisé depuis le
bundle ou une autre session. Un `reference_result` ou `executed_result` est la
preuve à juger, pas un corrigé.

Quand une scène porte `run_manifest`, appeler `get_run_manifest`, exécuter la
capsule dans l'espace de travail, puis `submit_run_result`. Avant un run attesté,
`submit_response` renvoie exactement `run required: call get_run_manifest, run it,
then submit_run_result`. Pour préparer l'environnement, placer `UV_CACHE_DIR` dans
l'espace de travail et lancer `uv venv`. Si `requirements: []`, ne lancer aucune
commande `uv pip install` ; le venv suffit. Installer seulement lorsque la liste
contient réellement des dépendances.

```sh
export UV_CACHE_DIR="$PWD/.uv-cache"
uv venv .venv
# Seulement si requirements n'est pas vide :
uv pip install --python .venv/bin/python REQUIREMENT_1 REQUIREMENT_2
```

**Test de fumée (tout harnais).** Avant une séance, demander au harnais d'appeler
`get_server_info` : la réponse donne la version, l'origine du build (`source` ou
`bundled`, avec sa date) et la liste des outils. Un `dist/lesson-mcp.cjs` ou un
VSIX reconstruits avant le dernier `git pull` manquent des outils récents sans
autre symptôme ; `pnpm --filter studium-vscode build` les met à jour.

> Utilise `$studium-student` pour vérifier ma connexion et démarrer le cours fourni.
> Lis la scène publique et attends ma réponse avant toute soumission.

Si le skill n'est pas découvert, demander la lecture explicite de
`skills/studium-student/SKILL.md`. Le [guide des skills](skills.md) décrit cette
solution de repli. Une commande d'ajout réussie ne prouve pas que l'application,
l'extension IDE ou le CLI déjà ouvert a rechargé ses outils.

## OpenCode

Installer et connecter le fournisseur selon le [démarrage OpenCode v2](https://opencode.ai/v2/docs).
Vérifier la version installée. Pour **v2**, fusionner [l'exemple dédié](../examples/opencode-v2.json)
dans `opencode.jsonc` à la racine du projet. Sa structure est `mcp.servers`, avec
`type: "local"`, un tableau `command` et `environment`. Ce n'est pas le JSON de
Claude Code. Les anciennes versions nécessitent leur propre configuration ou migration.

Depuis ce projet, `opencode mcp list` affiche les connexions ; dans l'interface,
`/mcps` permet de les inspecter. Suivre le nom d'exécutable de son installation
s'il diffère. Référence : [MCP OpenCode v2](https://opencode.ai/v2/docs/mcp-servers).

> Lis `skills/studium-harness/SKILL.md`, vérifie les outils Studium, présente la
> scène publique en français puis attends ma réponse.

Un modèle ouvert peut être choisi si le fournisseur du harnais le propose ; cela
ne garantit ni gratuité, ni exécution locale, ni qualité équivalente des réponses.

## Cursor

Fusionner le bloc `mcpServers` de l'[exemple Claude](../examples/mcp.claude.json)
dans `.cursor/mcp.json`, avec les chemins remplacés. Suivre la
[documentation MCP Cursor](https://cursor.com/docs/mcp) pour activer les outils.
Le transport MCP ne garantit pas le rendu du panneau VS Code.

Les recettes Claude Code, Codex et OpenCode ont été confrontées aux sources
officielles le **12 septembre 2026** ; la recette Cursor date du 11. Elles n'ont
pas toutes fait l'objet d'une séance authentifiée complète.

## API directe et changement de harnais

Suivre le [guide API](../guides/api-and-harness.md) pour démarrer le serveur et
transmettre son token aux environnements clients sans l'insérer dans un prompt.
Ce token autorise le client local ; ce n'est pas une clé de fournisseur LLM.
Depuis le checkout, avec cet environnement configuré :

```sh
pnpm --silent --filter @studium/lesson-mcp api:call health
pnpm --silent --filter @studium/lesson-mcp api:call operations
```

Le harnais utilise ensuite les schémas et fichiers de requête documentés.

> Lis `skills/studium-harness/SKILL.md` et le guide API. Utilise le serveur local
> configuré dans ton environnement. Vérifie sa disponibilité sans afficher le
> token. Démarre le bundle fourni en français, puis attends mes réponses.

Pour reprendre, fournir le `session_id` existant au lieu de demander un démarrage.
Le nouveau harnais relit le contexte avant d'agir. Le serveur doit rester actif
et les clients utiliser le même token. Un redémarrage perd les `session_id` actifs ;
un nouveau `start_lesson_session` avec le même apprenant et le même bundle peut
reprendre le premier passage inachevé depuis l'état durable. Les journaux consentis
et exports ont une conservation distincte.

Les routes `/v1/operations` sont une **API JSON**, pas un transport MCP HTTP : ne
pas les déclarer avec `codex mcp add --url`. Le guide précise relances identiques,
conflits de scène, capacité du serveur et oubli. Le panneau VS Code et les serveurs
MCP indépendants ne partagent pas automatiquement cette séance API.

## Canal fichiers

Le [skill Studium](../../skills/studium-harness/SKILL.md) décrit `.studium-session` :
le runner écrit une tâche ; le harnais lit son contexte public et dépose la
réponse suivant le contrat. Cet essai automatisé teste la plomberie :

```sh
apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --dir=/ABS/PATH/new-session --stub
```

Le répertoire doit être nouveau. Sans `--stub`, le runner attend les réponses
externes. Garder le runner actif et suivre les formats et écritures atomiques de
`task.md`. Le test stub contient des réponses synthétiques, pas celles d'un étudiant.
Changer de harnais en conservant ce runner n'est pas restaurer une session après
son arrêt. Ne pas déclarer une reprise exacte sans avoir retrouvé l'état réel.

## Fournisseur backend : option avancée

Le harnais peut lire les sources et proposer un plan avec son propre modèle.
Ajouter un second fournisseur n'est pas nécessaire au [parcours littérature](../tutorials/literature-to-course.md).

Pour les agents du planner, `STUDIUM_LLM_MODE=mock` est le départ. Le mode
`litellm` utilise `LITELLM_BASE_URL`, éventuellement `LITELLM_API_KEY`, et un endpoint
compatible `/v1/chat/completions`. Le proxy doit router les alias autorisés :
notamment `planner`, `critic`, `graph-builder` pour les agents Python ; le client
TypeScript utilise `studium/planner`, `studium/scene-synth`, `studium/critic`,
`studium/teacher-review`, `studium/runtime-tutor`.

Voir le [planner](../../services/planner/agents/base.py) et le
[client LLM](../../packages/llm-client/src/index.ts). Le serveur MCP stdio active
son backend live si `LITELLM_BASE_URL` est non vide ; les exemples la laissent
vide. L'API HTTP exige en plus `STUDIUM_API_LIVE=1`.

Garder les clés dans le mécanisme local de secrets, jamais dans Git ou un prompt.
Faire un essai borné avec le budget convenu. Examiner les indicateurs de fallback :
certains agents retombent en mock après un échec ; HTTP 200 ne prouve pas le live.
