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

M1 — Pipeline auteur (`prototype/m1-pipeline-auteur`) — **TERMINÉE, mergée sur main**
Prochaine : M2 — voir `../Studium/docs/handoffs/m2-*.md` (à créer).

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

# Lancer les tests Python :
pytest services/ packages/lesson-plan-schema/tests_python/

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

# Python (services + schemas)
pytest services/ packages/lesson-plan-schema/tests_python/

# Next.js build
pnpm --filter @studium/author-web build
```

## Mémoire

`.memory/` géré par `tools/memory_cli.py`. Voir `../Studium/.memory/INDEX.md` pour la mémoire du workspace de préparation.

## Convention nommage modules Python

Pour éviter les conflits `sys.path` entre services lors des runs pytest multi-services :
- `services/ingest/ingest_app.py` (pas `app.py`) — entrée FastAPI ingest
- `services/ingest/ingest_schemas.py` (pas `schemas.py`) — modèles Pydantic ingest
- `services/planner/planner_app.py` (pas `app.py`) — entrée FastAPI planner
- Les tests importent `from ingest_app import app` / `from planner_app import app`
