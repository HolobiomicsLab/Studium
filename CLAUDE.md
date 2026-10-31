# CLAUDE.md — prototype-build

Ce repo est le repo de construction du prototype Studium. Le remote est
`HolobiomicsLab/studium` ; le nom de répertoire `prototype-build` est historique.

Il est piloté par le **hub de développement `../studium_dev/`** (privé ; facultatif pour
contribuer, indispensable pour l'état courant) : point d'entrée `MANIFEST.yaml`, état courant
`STATUS.md`, travaux en cours et décidés dans `docs/superpowers/intents/`. Sans le hub, ce repo
suffit pour construire, tester et modifier le code : voir `docs/develop/` (architecture, tests,
publication, style de la documentation). `../Studium/` est le repo de *conception* antérieur — concept,
architecture, specs et plans d'origine, superseded par ce repo pour l'implémentation. Ses
pointeurs résolvent toujours et `AGENTS.md` y fait toujours foi.

## Règles

- Lis `../Studium/AGENTS.md` pour le protocole de travail (phases, règles d'or, boucle de session).
- TDD obligatoire (rule 002) + validation Pydantic pour tout appel LLM.
- Human-in-the-loop strict (rule 003) avant toute diffusion étudiante.
- Mise à jour de `docs/internal/agent-log.md` (anciennement `AGENT_LOG.md` à la racine) à chaque
  commit significatif. L'ancien `HANDOFF.md` racine est archivé dans `docs/internal/handoff-history.md`.
- Les milestones M0–M3 ont un handoff dans `../Studium/docs/handoffs/` ; **il n'y en a pas
  au-delà de `m3-student-runtime.md`**. Le travail postérieur est piloté par intent
  (`INT-STUDIUM-<n>`) depuis le hub, pas par handoff de milestone.

## Où est le travail — et où le lire

**Sur `dev`, pas sur `main`.** `dev` porte le travail courant ; `main` reçoit des intégrations
par lots, à intervalles irréguliers. Aucun numéro n'est donné ici : ce fichier ne porte pas
d'instantané (voir juste en dessous), les commandes ci-dessous en donnent un frais.

**Et il faut `fetch` avant de comparer.** La recette qui figurait ici lisait la ref `main`
LOCALE, qui dans un clone où l'on ne sort jamais de `dev` n'est jamais mise à jour : elle
répondait `0293287` (2026-06-27) trois mois après que `origin/main` avait avancé, et un relevé
de statut mené avec elle a conclu l'inverse de la vérité sur onze intents. La ref locale d'une
branche sur laquelle on ne travaille pas ne se met pas à jour toute seule.

```bash
git fetch origin                                                  # d'abord, toujours
git log -1 --format='%h %ad %s' --date=short origin/main dev
git rev-list --count origin/main..dev
git ls-remote origin main dev                                     # la source, sans intermédiaire
```

**L'état courant se lit dans `../studium_dev/STATUS.md`, pas ici.** Ce fichier-ci ne porte plus
d'instantané de jalon, et c'est délibéré : il en portait un — « Prochaine étape : M2 », alors
que le travail avait dépassé la démo M6 — parce qu'un instantané épinglé dans un fichier que
personne ne relit vieillit en silence. Le remplacer par un instantané plus frais reproduit le
défaut avec un délai. Ce qui reste ici est ce qui se vérifie depuis le repo lui-même :
commandes, conventions, environnement.

Le jalon livré sur `main` (11 features : learner-as-author A1–A4, FSRS/modalité B1–B2, scènes
wave 1 C1–C3 et wave 2 D2, PeerStudio D1) est sur les deux branches ; il n'est pas l'état
d'avancement.

## Toolchain requise

Les versions ci-dessous sont les versions **déclarées par le repo**, pas celles d'une machine :
les numéros exacts qui figuraient ici étaient faux sur les quatre lignes (Rust était donné
absent alors que le build Tauri est vert sur les deux plateformes CI depuis `f16cfcd`,
2026-09-08).

| Outil | Exigence | Déclarée dans |
|---|---|---|
| Node | 22 (LTS) | `.nvmrc` et les jobs CI ; `engines.node` reste `>=20` |
| pnpm | 9.15.9 | `packageManager` (épinglé, INT-STUDIUM-031), `engines.pnpm` (`>=9`) |
| Python | 3.12 | `python-version` des jobs CI ; `requires-python = ">=3.12"` des paquets |
| Rust / Cargo | Tauri 2.x | `apps/student-runtime/src-tauri/Cargo.toml` |

```bash
node -v && pnpm -v && python -V && cargo --version   # ce que cette machine a réellement
```

## Environnement Python

**Toujours utiliser le virtualenv `.venv/`** — ne pas utiliser `python3` système.

```bash
# Première fois (déjà fait) :
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# À chaque session :
source .venv/bin/activate   # ou .venv\Scripts\activate sur Windows

# Lancer TOUS les tests Python (un processus pytest par suite) :
python tools/pytest_all.py          # succès : exit 0, « N suites, 0 failing »

# Lancer un service en dev (depuis le dossier du service) :
(cd services/ingest && uvicorn ingest_app:app --reload --port 8000)
(cd services/planner && STUDIUM_LLM_MODE=mock uvicorn planner_app:app --reload --port 8001)
# sans STUDIUM_LLM_MODE=mock ni modèle configuré, le planner répond 503
```

Le venv est dans `.gitignore` — chaque développeur doit le créer localement
via `pip install -r requirements.txt`.

## Commandes de test globales

```bash
export STUDIUM_EPHEMERAL=1          # l'état apprenant reste en mémoire (comme en CI), rien sous ~/.studium

# TypeScript (tous les packages, pilotes VS Code compris)
pnpm build:libs                     # sur un clone neuf : certains paquets se résolvent par ./dist
pnpm lint
pnpm test

# Python (toutes les suites : packages, services, eval, tools, fixtures)
python tools/pytest_all.py          # succès : exit 0, « N suites, 0 failing »

# Lint des bundles et documentation
bash tools/bundle_lint.test.sh
node tools/docs/check.mjs

# Next.js build (tableau de bord enseignant ; author-web est héritée)
pnpm --filter @studium/teacher-dashboard build
```

Le détail de chaque suite et des jobs CI est dans `docs/develop/testing.md`.

## Mémoire

`.memory/` géré par `tools/memory_cli.py`. Voir `../Studium/.memory/INDEX.md` pour la mémoire du workspace de préparation.

## Convention nommage modules Python

Deux `conftest.py` de services différents s'importent sous le même nom de module, donc un seul
processus pytest sur `services/` avorte à la collecte (`ImportPathMismatchError`). C'est la raison
d'être de `tools/pytest_all.py` : une suite = un processus, et les suites sont **découvertes**, pas
listées à la main — un répertoire de tests ajouté demain tourne sans qu'on pense à l'inscrire
quelque part (INT-STUDIUM-011).

Pour éviter les conflits `sys.path` entre services lors des runs pytest multi-services :
- `services/ingest/ingest_app.py` (pas `app.py`) — entrée FastAPI ingest
- `services/ingest/ingest_schemas.py` (pas `schemas.py`) — modèles Pydantic ingest
- `services/planner/planner_app.py` (pas `app.py`) — entrée FastAPI planner
- Les tests importent `from ingest_app import app` / `from planner_app import app`
