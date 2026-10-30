[English](testing.md) · Français

# Tests

Lancez ces vérifications avant d'annoncer qu'une modification est verte. Ce sont les commandes de la CI :
un passage en local annonce un passage en CI. Pour tester une leçon en la parcourant plutôt qu'en lançant
des suites, voir [TESTING.fr.md](../../TESTING.fr.md).

## Avant de commencer

```bash
pnpm install
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
pnpm build:libs                # certains paquets se résolvent par ./dist, absent d'un clone neuf
export STUDIUM_EPHEMERAL=1     # l'état de l'apprenant reste en mémoire, comme en CI
```

Sans `STUDIUM_EPHEMERAL=1`, tout ce qui démarre le serveur MCP stdio écrit l'état de l'apprenant sous
`~/.studium`. Utilisez toujours le Python du virtualenv, jamais celui du système.

## Les portes

| Commande | Ce qu'elle couvre |
|---|---|
| `pnpm lint` | ESLint sur tous les fichiers `.ts` et `.tsx` ; zéro erreur attendue |
| `pnpm build` | tout l'espace de travail compile |
| `pnpm test` | tous les paquets et applications TypeScript (`pnpm -r test`), pilotes VS Code compris |
| `.venv/bin/python tools/pytest_all.py` | toutes les suites Python, un processus pytest chacune |
| `bash tools/bundle_lint.test.sh` | tests de contrat du linter de bundles |
| `node apps/lesson-mcp/scripts/headless_smoke.mjs` | un client MCP nu joue une vraie leçon en stdio |

`tools/pytest_all.py` réussit avec le code de sortie 0 et une dernière ligne de la forme
`N suites, 0 failing`.

## Suites TypeScript

Chaque paquet et chaque application a un script `test` ; `pnpm test` les lance tous. La plupart utilisent
Vitest, avec les tests à côté du code (`*.test.ts`). Pour une seule unité :

```bash
pnpm --filter @studium/lesson-session-host test
pnpm --filter @studium/lesson-mcp test
pnpm --filter @studium/lesson-mcp exec tsc --noEmit
```

Suites à connaître :

| Suite | Ce qu'elle établit |
|---|---|
| `apps/lesson-mcp/src/learn-and-review.e2e.test.ts` | de « je veux apprendre X » à la première question en six appels d'outils Studium, puis une révision une semaine plus tard après redémarrage du serveur |
| `packages/lesson-session-host` (`host.*.test.ts`, `public-scene.test.ts`) | masquage des clés, libération des passages à la sortie de scène, plan d'étude, état durable |
| `apps/lesson-server` (`server.redaction.test.ts`) | le serveur HTTP n'envoie jamais de clé de réponse |
| `apps/teacher-dashboard` | pages du tableau de bord et alternatives textuelles des graphiques (Vitest) ; `pnpm --filter @studium/teacher-dashboard test:e2e` lance les tests d'intégration Playwright |
| `packages/activity-presentation` | les aides de langue des viewers (`node --test` sur `ui/activity-language.test.mjs`) |

### Pilotes VS Code

L'extension est testée par des **pilotes** (*drivers*) : des scripts TypeScript ordinaires,
`apps/studium-vscode/src/*.driver.ts`, exécutés avec `tsx`, qui exercent l'extension sans lancer VS Code.
Certains affichent le panneau de leçon dans jsdom et cliquent sur ses commandes ;
`extension-host.driver.ts` fait tourner l'extension contre un faux module `vscode` et le vrai serveur MCP.
La liste des pilotes lancés par `pnpm test` est le script `test` de
[`apps/studium-vscode/package.json`](../../apps/studium-vscode/package.json). Pour en lancer un :

```bash
pnpm --filter studium-vscode test                                   # vérification de types, puis tous les pilotes
node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/webview-pane.driver.ts
```

## Suites Python

[`tools/pytest_all.py`](../../tools/pytest_all.py) existe parce que deux services importent chacun un
module nommé `tests.conftest` : un seul processus pytest sur `services/` échoue dès la collecte. Le script
lance un processus par suite. Les suites sont découvertes, pas listées : un dossier de premier niveau qui
contient directement des tests forme une suite (`tools/`) ; sinon, chaque sous-dossier contenant des tests
en est une (`services/planner`, `packages/lesson-bundle-schema`, `eval/tests`, etc.). L'exécution échoue si
un fichier de test n'est atteint par aucune suite.

```bash
.venv/bin/python tools/pytest_all.py              # toutes les suites
.venv/bin/python tools/pytest_all.py -- -x        # les arguments suivants vont à chaque processus pytest
.venv/bin/python -m pytest services/planner -q    # une seule suite
```

Un `pytest` nu à la racine ne collecte que `packages/` (voir `pytest.ini`) : ce n'est pas une porte.

## Autres vérifications

| Commande | Quand |
|---|---|
| `node tools/bundle_lint.mjs <lesson.json>` | après avoir modifié une leçon à la main |
| `node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/drive_check.mjs` (et les autres `*_check.mjs` du dossier) | diagnostics de la leçon de référence ; ils sortent toujours 0, lisez donc leur sortie |
| `node design/scripts/build-tokens.mjs --check` et `node design/scripts/check-contrast.mjs` | après une modification des jetons de design |
| `node apps/lesson-mcp/scripts/http-smoke.mjs <nouveau dossier>` | après une modification de l'adaptateur HTTP ; écrit son rapport dans un dossier qui ne doit pas encore exister |
| `tools/audit-*.mjs` | audits d'interface sur données synthétiques ; voir [le document d'audit](../design-records/audits/live-ui-audits.md) |

Le banc d'évaluation sous [`eval/`](../../eval/README.md) mesure des leçons et des parcours ; ce n'est pas
une porte.

## CI

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) tourne à chaque push et sur les pull requests
vers `main`, avec `STUDIUM_EPHEMERAL=1` pour tous les jobs.

| Job | Quand | Étapes |
|---|---|---|
| Lint + Test | à chaque push | installation `--frozen-lockfile`, audit bloquant des alertes critiques de production, lint, build, tests TypeScript, lint des bundles, test MCP sans interface, suites Python, validateur ASTRA, construction du graphe du planificateur, tests de l'Observatory |
| Tester onboarding path | à chaque push | `./setup.sh` sur un clone neuf, puis les pilotes VS Code |
| VSIX + standalone MCP server | à chaque push | empaquetage et contrôle du VSIX, démarrage du `lesson-mcp.cjs` autonome en stdio, dépôt des deux fichiers (voir [publication](release.fr.md)) |
| Tauri build, Demo M6 | à la demande uniquement | l'application de bureau gelée sur macOS et Linux, puis la démo de bout en bout |

Dependabot ouvre chaque semaine des pull requests de mise à jour groupées pour npm, pip et GitHub Actions.

## Règles

Les tests font partie du contrat. Modifier un test existant est une décision que vous énoncez dans le
message de commit, jamais l'effet de bord d'une réparation. Un comportement nouveau arrive avec un test qui
échoue sans lui.
