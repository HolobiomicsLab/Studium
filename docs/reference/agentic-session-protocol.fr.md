[English](agentic-session-protocol.md) · Français

# Protocole de session agentique

Un assistant qui travaille dans l'espace de travail de l'apprenant (Copilot, Claude Code, Codex,
OpenCode) peut piloter une leçon Studium et exécuter lui-même la vraie science. Studium reste le
cerveau de la leçon : il choisit la scène suivante, note les réponses et met à jour la maîtrise.
L'assistant, appelé ici opérateur, exécute le code dans le terminal ou le notebook de l'espace de
travail, et l'éditeur affiche les figures. Studium n'exécute jamais de code lui-même et n'a besoin
d'aucun bac à sable par apprenant.

Cette page décrit les deux canaux entre Studium et un opérateur, puis le canal fichiers en détail.
Les noms de fichiers, de champs et de statuts restent en anglais, tels que le code les attend.

## Deux canaux

| Canal | Surface | Pour qui |
|---|---|---|
| MCP (typé, en direct) | les [outils MCP](mcp-tools.fr.md) d'`apps/lesson-mcp` : `start_lesson_session`, `get_current_scene`, `get_scene_artifacts`, `submit_response`, `submit_turn`, `request_hint`, `get_run_manifest`, `submit_run_result`, `end_session` | un assistant ou un éditeur qui parle MCP |
| Fichiers (universel) | un dossier `.studium-session/` | tout assistant capable de lire et d'écrire des fichiers |

Les deux appliquent la même expurgation : la clé de réponse (affirmations, défauts attendus,
réponses modèles, choix correct d'un quiz) est retirée avant que quoi que ce soit n'atteigne
l'opérateur. L'opérateur audite une lecture faite par une IA sans recevoir la solution.

## Le canal fichiers

```text
.studium-session/
  task.md                 Studium -> opérateur  l'étape courante, expurgée : quoi faire et la référence de l'artefact réel
  response.json           opérateur -> Studium  la réponse de l'apprenant, p. ex. {"text": "..."} ou {"kind": "flaw_report", "text": "..."}
  run.json                Studium -> opérateur  un manifeste d'exécution côté apprenant (scènes de reproduction seulement)
  run_result.json         opérateur -> Studium  {"ran": true, "passed": true, "landmark": "...", "artifacts": [...], "checks": [...]}
  feedback.md             Studium -> opérateur  le résultat noté et si la leçon a avancé
  index.json              journal partagé       une entrée par étape : {step, scene_id, scene_type, status}
  experiment-action.json  opérateur -> Studium  {session_id, scene_id, input} : une prédiction, un début, une observation ou une conclusion
  experiment.json         Studium -> opérateur  le journal d'expérimentation privé (mode 0600), dès qu'il a des entrées
  session-language.json   opérateur -> Studium  {session_id, presentation_language} : changer la langue de présentation
```

Le `status` d'une étape dans `index.json` vaut `awaiting_response`, `graded`, `awaiting_run`, `ran`
ou `complete`.

### La boucle

1. Studium écrit `task.md` (la scène expurgée, plus la référence d'un vrai résultat exécuté quand la
   scène en a un) et consigne l'étape en `awaiting_response`.
2. L'opérateur lit `task.md`, fait le travail dans l'espace de travail et écrit la réponse de
   l'apprenant dans `response.json`.
3. Studium la note, écrit `feedback.md`, marque l'étape `graded` et écrit le `task.md` suivant, ou
   une entrée `complete` à la fin.

Un `response.json` mal formé ou décalé n'est pas bloquant : Studium le consomme et écrit un
`feedback.md` correctif, pour que l'opérateur réessaie.

### Consignes pour un opérateur

> Lis `.studium-session/task.md`. Fais ce qu'il demande dans cet espace de travail (exécute le
> code, examine le vrai résultat que montre l'éditeur). Écris la réponse de l'apprenant dans
> `.studium-session/response.json` sous la forme `{"text": "<le jugement, avec sa justification>"}`,
> en écrivant d'abord `response.json.tmp` puis en le renommant, pour que Studium ne lise jamais un
> fichier à moitié écrit. Lis ensuite `.studium-session/feedback.md` et, s'il y a un nouveau
> `task.md`, continue. Ne cherche pas la clé de réponse : elle n'est pas là.

### Exécutions côté apprenant

Une scène `reproduction` peut porter un `run_manifest` : la capsule, l'installation et la commande,
les fichiers attendus et les vérifications à mener, jamais les valeurs attendues. Sur une telle
scène, Studium écrit `run.json` et un `task.md` « préparer et exécuter », et consigne
`awaiting_run`. L'opérateur prépare l'environnement, installe les dépendances, exécute la capsule
dans l'espace de travail et écrit `run_result.json`.

| Résultat | Ce que fait Studium |
|---|---|
| `ran` et `passed` | Enregistre l'exécution propre à l'apprenant (`status: "ran"`, avec son repère et ses artefacts) et avance. |
| absent ou partiel | Continue d'attendre. |
| `ran: false` ou vérifications échouées | Le consomme et écrit un `feedback.md` correctif ; l'opérateur corrige et relance. |

Le repère de référence de l'auteur est retenu, pour que l'apprenant produise un résultat neuf. Par
MCP, le même échange passe par `get_run_manifest` puis `submit_run_result`.

## Lancer le harnais

`runStudiumSession(host, bundleRef, dir, operator)` dans `@studium/lesson-session-host` pilote la
boucle avec un opérateur interchangeable. Le lanceur en ligne de commande l'enveloppe :

```bash
# Mode attente (par défaut) : Studium écrit task.md et attend que vous ou un assistant écriviez response.json
apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --dir=.studium-session

# Mode stub : un opérateur factice, sans clé, mène la boucle jusqu'au bout (test rapide)
STUDIUM_EPHEMERAL=1 apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --stub --dir=reports/session
```

Le dossier `--dir` doit être nouveau. Sans `--stub`, le runner attend de vraies réponses. Le
[skill harnais](../../skills/studium-harness/SKILL.md) décrit les formats.

Options : `--bundles-root=DIR` (par défaut `BUNDLES_ROOT`, sinon `./fixtures`), `--dir=DIR` (par
défaut `./.studium-session`), `--language=BCP47` (langue de présentation).

| Opérateur | Comportement |
|---|---|
| `watchOperator({pollMs, timeoutMs})` | Attend qu'un assistant extérieur écrive `response.json` ou `run_result.json`. Studium n'appelle jamais de modèle. |
| `stubOperator` | Un substitut déterministe ; sur une scène d'exécution, il écrit un résultat réussi sans rien exécuter. |
| `makeLlmOperator({llm, runCapsule})` | Un opérateur adossé à un modèle, qui prend l'exécution en charge : il exécute la capsule d'une scène de reproduction et demande au modèle de juger la lecture IA de sa propre exécution. Les deux dépendances sont injectées. |

La démonstration avec modèle exécute la vraie capsule avec `tools/capsule_runner.py` et un modèle
factice, ou un vrai modèle avec `--live` et `LITELLM_BASE_URL` :

```bash
apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/llm-operator-demo.ts capsule-loop-demo/lesson.json --dir=reports/session
```

## L'exécution et l'affichage reviennent à l'éditeur

- L'exécution a lieu dans le terminal ou le noyau de notebook de l'espace de travail, pilotée par
  l'opérateur. `tools/capsule_runner.py` produit encore une fois l'exécution de référence de
  l'auteur, pour fonder une scène ; les exécutions de l'apprenant sont demandées par `run.json` (ou
  `get_run_manifest`) et rapportées en retour.
- L'affichage est natif : le contrôleur de notebook VS Code montre une figure `executed_result` ou
  une image en ligne avec une légende, et le canal fichiers transporte la même référence.

## Ce qui est couvert

L'aller-retour par fichiers est testé sur `fixtures/capsule-judgment-demo`, sans clé de réponse
dans aucun `task.md`, et l'exécution côté apprenant sur `fixtures/capsule-run-demo` : le manifeste
ne porte aucune réponse, le repère de l'auteur est retenu, et une exécution échouée ou absente se
rattrape. Une exécution réussie est enregistrée comme le résultat propre de l'apprenant, sur lequel
une scène `spot_the_flaw` ultérieure peut se fonder (`reference_from_run` dans le
[format du bundle de leçon](lesson-bundle.fr.md#spot_the_flaw)).
