# CLAUDE.md — prototype-build

Ce repo est le repo de construction du prototype Studium.
Il est piloté par le workspace de préparation `../Studium/`.

## Règles

- Lis `../Studium/AGENTS.md` pour le protocole de travail (phases, règles d'or, boucle de session).
- Chaque milestone suit un handoff dans `../Studium/docs/handoffs/m<N>-*.md`.
- TDD obligatoire (rule 002) + validation Pydantic pour tout appel LLM.
- Human-in-the-loop strict (rule 003) avant toute diffusion étudiante.
- Mise à jour `AGENT_LOG.md` à chaque commit significatif.

## Milestone active

**Roadmap complet livré sur `main` (2026-06-27, commit `e227cb5`).** 11/11 features mergées :

| Wave | Features |
|---|---|
| Learner-as-author | A1 `/studio` multi-type · A2 `/peer` UI · A3 community bundle runtime · A4 publicScene redaction |
| FSRS / modality | B1 review queue + calibration surface · B2 modality preference (VS Code) |
| Wave 1 scenes | C1 comparison · C2 summary_audit · C3 prompt_practice |
| Wave 2 scenes | D2 communication_sim |
| PeerStudio | D1 Room registry · HTTP API (lesson-server) · teacher-dashboard /room · spec doc |

Prochaine étape : M2 — voir `../Studium/docs/handoffs/m2-active-learning-peerstudio.md`.

## Toolchain requise

- Node 20+ ✅ (v25.8.2)
- pnpm 9+ ✅ (v11.0.5)
- Python 3.12+ ✅ (3.13.2 via `.venv/`)
- Rust/Cargo (Tauri 2.x) ❌ — à installer avant M3

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

# Lancer un service en dev :
uvicorn services.ingest.app:app --reload --port 8000
uvicorn services.planner.app:app --reload --port 8001
```

Le venv est dans `.gitignore` — chaque développeur doit le créer localement
via `pip install -r requirements.txt`.

## Commandes de test globales

```bash
# TypeScript (tous les packages)
pnpm test

# Python (toutes les suites : packages, services, eval, tools, fixtures)
python tools/pytest_all.py          # succès : exit 0, « N suites, 0 failing »

# Next.js build
pnpm --filter @studium/author-web build
```

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
