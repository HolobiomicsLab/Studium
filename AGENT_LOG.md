# AGENT_LOG — prototype-build

Journal des unités TDD par milestone. Mis à jour à chaque commit significatif.

---

## 2026-05-05 — Unité 0 : Init repo prototype-build

- Fichiers : `CLAUDE.md`, `AGENT_LOG.md`, `tools/memory_cli.py`, `.memory/INDEX.md`
- Structure `.memory/{decisions,entries,rules,daily,templates}/` créée
- Toolchain au démarrage : Node v25.8.2 ✅, pnpm v11.0.5 ✅, Python 3.13.2 ✅, Rust/Cargo ❌
- **Écart unité 8** : Tauri hello world skippé — Rust/Cargo absent. À installer avant M1/M3. Warning loggué ici.
- Suite : Unité 1 — pnpm workspace + lint + tsconfig

---

## 2026-05-05 — Unité 1 : pnpm workspace + lint + tsconfig

- Fichiers : `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.eslintrc.json`, `.prettierrc.json`
- `pnpm install` ✅, `pnpm lint` ✅
- Suite : Unité 2 — lesson-schema tests rouges

---

## 2026-05-05 — Unité 2 : lesson-schema tests rouges

- Fichiers : `packages/lesson-schema/tests/schema.test.ts`
- 3 tests rouges écrits (validateLesson vide, validateLesson valide, loadSchema $schema)
- Suite : Unité 3 — impl

---

## 2026-05-05 — Unité 3 : lesson-schema JSON Schema + Ajv + sample

- Fichiers : `packages/lesson-schema/src/schema.json`, `src/index.ts`, `architecture/examples/lesson_sample.json`
- JSON Schema Draft 2020-12, 8 types de scène (ADR 003), Ajv2020
- Sample métabolomique : 5 scènes (intro, concept, quiz, ai_critique, meta_checkpoint)
- Tests : 3/3 verts
- Suite : Unité 4 — Pydantic mirror

---

## 2026-05-05 — Unité 4 : Pydantic mirror lesson-schema

- Fichiers : `packages/lesson-schema/python/lesson_schema/__init__.py`, `pytest.ini`
- Pydantic v2, enums stricts, validateur objective_refs croisé
- Tests Python : 3/3 verts
- Suite : Unité 5-6 — llm-client

---

## 2026-05-05 — Unités 5-6 : llm-client

- Fichiers : `packages/llm-client/src/index.ts`, `tests/llm-client.test.ts`
- Interface LLMClient, 4 aliases whitelist, mock + LiteLLM adapter (ADR 002)
- Tests : 3/3 verts (mock mode + aliases + rejet alias inconnu)
- Suite : Unité 7 — perspicacite-client

---

## 2026-05-05 — Unité 7 : PerspicaciteClient

- Fichiers : `packages/perspicacite-client/src/index.ts`, `tests/perspicacite-client.test.ts`
- Mode mock (fixture statique) + mode real (retries 3, backoff exp 200ms, timeout 10s, fallback offline)
- Tests : 2/2 verts (mock fixture, fallback offline sur port inexistant)
- Suite : Unité 8 (SKIP) + Unité 9 CI

---

## 2026-05-05 — Unité 8 : SKIP Tauri (Rust absent)

- Rust/Cargo absent sur cette machine → unité 8 (student-runtime hello world) non exécutée.
- Action requise : installer `rustup` + `cargo` avant M1/M3.
- Aucun code applicatif Tauri produit. Bloquant seulement pour M3 (runtime étudiant).

---

## 2026-05-05 — Unité 9 : CI workflow

- Fichier : `.github/workflows/ci.yml`
- Steps : Node 20 + pnpm 9 + Python 3.12 → install → lint → pnpm test → pytest
- Pas de Tauri build en CI (attendu M3)

---

## 2026-05-05 — Unité 10 : Vérification finale M0

- `pnpm test` global : 8 tests TS verts (3 lesson-schema + 3 llm-client + 2 perspicacite-client)
- `pnpm lint` : clean
- `pytest` : 3 tests Python verts
- Écart documenté : unité 8 (Tauri) skippée — Rust absent
- Tag `m0-skeleton` posé
- Branche `prototype/m0-skeleton` à pousser (remote à configurer par l'utilisateur)
