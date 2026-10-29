# Autres harnais et accès API

Studium expose un serveur MCP standard en **stdio**. Le moteur est indépendant du
client ; authentification, permissions et configuration restent propres à chaque
harnais. Terminer d'abord l'[installation](installation.md). Les recettes utilisent
le serveur compilé, sans dépendre d'un `tsx` global ni du dossier courant.

## Choisir une route

| Route | Accès à prévoir | Usage |
|---|---|---|
| Panneau Studium, exemple local | Aucun compte LLM pour la démonstration | Première leçon et rendus scientifiques |
| VS Code + Copilot | Avantage étudiant/enseignant ou offre du compte | [Parcours recommandé](copilot.md) |
| Claude Code | Authentification et offre compatibles | Même MCP et procédure Studium |
| Codex | Connexion ChatGPT admissible ou clé API | Même MCP ; coût selon le mode choisi |
| Cursor / OpenCode | Selon le client et son fournisseur | Alternative à configurer et vérifier |
| Backend Studium avec LLM | Fournisseur compatible et budget séparé | Génération ou tutorat backend avancé |

Un avantage Copilot ne fournit pas une clé API générale. La connexion ChatGPT de
Codex et son utilisation par clé API sont deux modes ; l'API est facturée séparément.
Voir l'[authentification Codex](https://learn.chatgpt.com/docs/auth). Aucun tarif ou
quota n'est figé ici : vérifier les conditions du compte avant une séance de groupe.

## Claude Code

Installer et authentifier le client selon la [procédure officielle](https://code.claude.com/docs/en/setup).
Remplacer `/ABS/PATH/studium` dans [cet exemple](../examples/mcp.claude.json), puis
fusionner son entrée dans `.mcp.json` à la racine du projet. Autre possibilité :

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

Inspecter la connexion avec `/mcp`. Les paramètres avant le nom du serveur et
la structure `mcpServers` suivent la [documentation Claude Code MCP](https://code.claude.com/docs/en/mcp).
Lire le skill Studium puis utiliser le prompt de [première séance](../tutorials/first-lesson.md).

## Codex

Se connecter avec le mode choisi, puis ajouter le serveur, ou fusionner
[l'exemple TOML](../examples/codex.toml) dans la configuration MCP appropriée :

```sh
codex mcp add --env BUNDLES_ROOT=/ABS/PATH/studium/fixtures --env LITELLM_BASE_URL= studium -- node /ABS/PATH/studium/apps/studium-vscode/dist/lesson-mcp.cjs
codex mcp list
```

Ne pas écraser une configuration existante. Remplacer les chemins absolus et
vérifier les outils dans la session après reconnexion. Référence :
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

## Cursor et OpenCode

Pour Cursor, fusionner le bloc `mcpServers` de l'[exemple Claude](../examples/mcp.claude.json)
dans `.cursor/mcp.json`, après remplacement des chemins. Suivre la
[documentation MCP Cursor](https://cursor.com/docs/mcp) pour activer et inspecter
les outils. Le transport MCP ne garantit pas le rendu du panneau VS Code.

Pour **OpenCode v2**, utiliser [l'exemple dédié](../examples/opencode-v2.json)
dans `opencode.jsonc`. Sa structure est `mcp.servers`, avec `type: "local"`,
un tableau `command` et `environment`. Ce n'est pas le JSON de Claude Code.
Pour une autre version, suivre sa documentation : [MCP OpenCode v2](https://opencode.ai/v2/docs/mcp-servers).
Ces recettes ont été confrontées aux sources officielles le 11 septembre 2026 ;
chaque application n'a pas fait l'objet d'une séance authentifiée complète.

## Fournisseur backend : option avancée

Le harnais peut lire les sources et proposer le plan avec son propre modèle.
Ajouter un second fournisseur n'est donc pas nécessaire au
[parcours littérature](../tutorials/literature-to-course.md).

Pour les agents de génération du planner, `STUDIUM_LLM_MODE=mock` est le mode de
départ. Le mode `litellm` utilise `LITELLM_BASE_URL`, éventuellement `LITELLM_API_KEY`,
et un endpoint compatible `/v1/chat/completions`. Un proxy doit router les alias
vers des modèles autorisés : les agents planner emploient notamment `planner`,
`critic`, `graph-builder` ; le client TypeScript utilise `studium/planner`,
`studium/scene-synth`, `studium/critic`, `studium/teacher-review`, `studium/runtime-tutor`.

Voir les contrats du [planner](../../services/planner/agents/base.py) et du
[client LLM](../../packages/llm-client/src/index.ts). Copier une URL sans vérifier
chemin d'API et modèles ne suffit pas. Le serveur lesson-mcp active son backend
live si `LITELLM_BASE_URL` est non vide ; les exemples la laissent vide.

Conserver les clés dans le mécanisme local de secrets du client, jamais dans les
fichiers versionnés, prompts ou captures. Faire d'abord un essai borné avec un
budget décidé. Examiner les traces et indicateurs de fallback : certains agents
retombent en mock après un échec ; un HTTP 200 ne prouve pas un appel distant réussi.

## Sans MCP et lors d'un changement de harnais

Le [skill Studium](../../skills/studium-harness/SKILL.md) décrit le canal fichier
`.studium-session` : le runner écrit une tâche, le harnais lit le contexte public
et dépose la réponse suivant le contrat. L'exemple automatisé suivant teste la
plomberie ; il ne remplace pas une séance étudiante :

```sh
apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --dir=/ABS/PATH/new-session --stub
```

Le répertoire doit être nouveau. Sans `--stub`, le runner attend les réponses
externes. Suivre ses formats et écritures atomiques. Un `session_id` appartient
au serveur qui l'a créé. Pour alterner, conserver bundle/révision, objectif,
preuves et contexte public, puis vérifier l'état retrouvé dans le nouveau client.
Ne pas déclarer une reprise exacte sans l'avoir observée.
