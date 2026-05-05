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

M0 — Squelette (`prototype/m0-skeleton`)
Handoff : `../Studium/docs/handoffs/m0-skeleton.md`

## Toolchain requise

- Node 20+ ✅ (v25.8.2)
- pnpm 9+ ✅ (v11.0.5)
- Python 3.12+ ✅ (3.13.2)
- Rust/Cargo (Tauri 2.x) ❌ — unité 8 skippée, à installer avant M1/M3

## Mémoire

`.memory/` géré par `tools/memory_cli.py`. Voir `../Studium/.memory/INDEX.md` pour la mémoire du workspace de préparation.
