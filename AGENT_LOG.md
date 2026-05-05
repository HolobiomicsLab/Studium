# AGENT_LOG — prototype-build

Journal des unités TDD par milestone. Mis à jour à chaque commit significatif.

---

## 2026-05-05 — Unité 0 : Init repo prototype-build

- Fichiers : `CLAUDE.md`, `AGENT_LOG.md`, `tools/memory_cli.py`, `.memory/INDEX.md`
- Structure `.memory/{decisions,entries,rules,daily,templates}/` créée
- Toolchain au démarrage : Node v25.8.2 ✅, pnpm v11.0.5 ✅, Python 3.13.2 ✅, Rust/Cargo ❌
- **Écart unité 8** : Tauri hello world skippé — Rust/Cargo absent. À installer avant M1/M3. Warning loggué ici.
- Suite : Unité 1 — pnpm workspace + lint + tsconfig
