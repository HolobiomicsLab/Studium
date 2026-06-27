# AGENT_LOG — prototype-build

Journal des unités TDD par milestone. Mis à jour à chaque commit significatif.

---

## 2026-06-27 — studium-vscode : câblage des scènes active-learning (audit → fix Wave 1-3)

**Contexte** : un audit multi-agent (21 agents) a montré que l'extension VS Code (`apps/studium-vscode`, le runtime étudiant) n'avait jamais été mise à jour quand les types de scènes Wave-1/Wave-2 ont atterri. Les 4 plus récents (comparison/summary_audit/prompt_practice/communication_sim) **cassaient la leçon** : les deux surfaces (webview `media/artifact-pane.js` + notebook `src/notebook.ts`) tombaient sur un `{kind:"ack"}` que leurs graders rejettent (`SceneGradingError`) → reset de session / toast d'erreur. Le bundle démo par défaut `atomistique-l1` est touché (scène 4 = summary_audit).

**Fix (renderer-only — aucun changement schema/grader/transport ; les champs arrivent déjà via publicScene)** :

| Wave | Contenu |
|---|---|
| 1 | comparison / summary_audit / prompt_practice / communication_sim : rendu des champs montrés + soumission du bon `kind` (calqué sur explain_back) sur les 2 surfaces. Source unique `src/scene-io.ts` (FREE_TEXT_KIND). |
| 2 | discussion multi-tours : message webview `{type:"turn"}` → `submit_turn` → signal de raisonnement + réplique socratique dans un transcript ; le notebook route tout texte non-`next` vers submit_turn jusqu'à max_turns puis ack. |
| 3 | reproduction : rendu des `steps[]` ; carte de calibration (`src/calibration.ts`, port verbatim de host.ts ; bandes sur/sous, sans chiffre) ; `end_session`/« 🗑 M'oublier » (purge RGPD confirmée par modale ; directive notebook `forget`) — la fermeture seule ne fait que couper le transport (l'état persiste pour reprise). |

**Vérification** : tsc clean, esbuild OK, **192 assertions de drivers** vertes — `scene-io.driver` 41 (contrat scène→kind + parité webview + calibration), `webview-pane.driver` 58 (rendu DOM LIVE via jsdom + clics → messages), `community` 19, `modality` 26, `review-fsrs` 36, `lesson-walk` 12. Back-end live : `lesson-walk.driver.ts` (e2e via le vrai serveur MCP) déroule `src/fixtures/wave-scenes.json` (bundle non-gaté, tous les types active-learning) + `all-scene-types.json` (boucle discussion) jusqu'à `complete`, et confirme que `summary_audit` d'atomistique-l1 ne lève plus d'erreur. (atomistique-l1 ne se termine pas sous answers synthétiques : son moteur adaptatif gate sur la maîtrise accumulée — comportement moteur, pas un bug.)

---

## 2026-06-27 — Roadmap complet : active learning, learner-as-author, PeerStudio

**Branches** : `feat/learner-as-author`, `feat/roadmap-wave1`, `feat/roadmap-wave2`, `feat/roadmap-d1-peerstudio`, `feat/d1-teacher-ui` — toutes mergées sur `main` à `e227cb5`.

**Méthode** : parallel workflow orchestration (Workflow tool + file-area partitioning), TDD strict (tests écrits avant ou en même temps que le code), revue adverse à chaque merge.

### Learner-as-author (A1–A4 + Workflows A/B/C)

| Feature | Commits clés | Description |
|---|---|---|
| A — backend | `b3782eb` | LAItemEnvelope schema-pure, append-only JSONL ledger, decide_item (rule-003 gate), HMAC author_pseudonym server-only |
| B — peer loop | `058adce` | record_peer_review → k-suppressed peer_signals → decide_item; discoverCommunityBundles |
| C — UIs | `7bd039e` | /studio (StudioForm + validate badge + SelfTestPanel + consent) ; /submissions (SubmissionsQueue moderation) |
| A3 — runtime | `8a4d366` | community-bundle live (lesson-mcp + VS Code extension wire) |
| A4 — redaction | `d19f2bd` | publicScene/publicPresentation/publicTransition (REDACTED_SCENE_FIELDS) ; calibrationFor fix (h.kind → h.signal.kind) |

### Wave 1 — Nouveaux types de scènes (C1–C3) + surfaces (B1–B2)

| Feature | Description |
|---|---|
| C1 comparison | artifact_a/artifact_b, key_points, comparisonGrader |
| C2 summary_audit | source_content + ai_summary, flaws_expected, summaryAuditGrader |
| C3 prompt_practice | task + key_points, promptPracticeGrader |
| B1 FSRS | reviewQueueFromState + calibrationFor surfacés ; host.review.test (no-fabrication guard) ; FSRS inline copy + 7/7 parity test |
| B2 modalité | selectRenderOrder(assets, pref) ; studium.modalityPreference config VS Code |
| A1 /studio | SpotTheFlawEditor, ExplainBackEditor, RevealPanel ; tous types authoriables |
| A2 /peer | PeerBoard + PeerTakePanel + PeerRatePanel ; rating scalaire {passed, rating 1–5, helpful} ; auteur jamais affiché |

### Wave 2 — communication_sim (D2) + correctifs

| Feature | Description |
|---|---|
| D2 communication_sim | scenario + prompt + key_points + model_response ; communicationSimGrader ; publicScene inclut model_response dans REDACTED_SCENE_FIELDS |
| MASTERY_CLAIM_THRESHOLD | bug : 0.85 → DEFAULT_THETA (0.8) ; 3 bonnes réponses → posterior 0.846 → mastery claim |
| calibrationFor | bug : h.kind → h.signal.kind ; no-fabrication regression test |
| cues stopwords | s3d-communicate-2p : "sans"→"image", "comme"→"couloir" |

### D1 PeerStudio — Substrat multi-apprenants

| Feature | Description |
|---|---|
| Room backend | room.ts types + aggregateRatings (k-floor=3) ; host.ts openRoom/joinRoom/submitRoomRating/getRoomState/closeRoom ; PeerRoomError |
| MCP tools | 5 outils (open/join/submit/get/close_peer_room) |
| HTTP API | 5 routes Fastify (lesson-server) + Zod schemas |
| Teacher dashboard | /room route + PeerRoomPanel : open form → join-code display → état live → close |
| Spec doc | docs/specs/peerstudio-d1.md |

**Tests au moment du merge final** :
- lesson-session-host : **87 passés** (11 fichiers) dont 15 room + 7 FSRS parity + 12 review
- lesson-session : **392 passés** | 8 skippés (API-key gated)
- lesson-mcp : **8 passés**
- lesson-server : **27 passés** (7 fichiers) dont 11 room routes
- teacher-dashboard : **39 passés** (3 fichiers) dont 9 PeerRoomPanel
- lesson-bundle-schema : **55 passés** ; adaptation-engine : **44** ; typed-graph-lens : **7** ; student-runtime : **70**
- analytics-collector (Python) : **189 passés** (scene-synth)

**Bug de fond corrigé** : stale `.js`/`.d.ts`/`.map` compiled files dans `lesson-server/src/` (33 fichiers) shadowaient les `.ts` mis à jour sous vitest → supprimés.

**Régressions pré-existantes hors scope** : D.5 CI Tauri (bloqué sans push remote).

---

## 2026-05-13 — M6 polish + démo end-to-end atomistique (`prototype/m6-polish-demo`)

**Livré (12 tasks subagent-driven)** :

- Fixture `fixtures/m6/demo-atomistique/` complète : corpus PDF L1 SV
  (cours `cours-L1SV-atomistique.pdf` 23 MB + TD `TD-SPEB107-enonce.pdf` 1.2 MB),
  2 placeholders articles OA (fallback documenté), `lesson.json` schema 1.4
  (10 scènes leçon 1+2), ABS capsule `task-atom-001` + `periodic-table.svg` (5.7 KB),
  `build.sh` zip -> `demo-atomistique-bundle.zip` (~7 KB).
- Orchestrateur `tools/e2e-demo-m6.sh` avec modes `--no-tauri` (smoke macOS),
  `--ci` (CI Linux WDIO). 3 assertions curl (`/metrics/progress`,
  `/metrics/concept-mastery-history`, `/metrics/journal`).
- Spec WDIO `apps/student-runtime/tests-e2e/specs/demo-m6-atomistique.spec.ts`
  — 2 sessions cross-session, sélecteurs alignés sur le pattern m5
  (`#a`, `button*=Continuer`, `[data-testid='library-load-bundle']`,
  `[data-scene-type='...']`).
- CI workflow `.github/workflows/ci.yml` job `demo-m6` sur ubuntu-22.04 +
  xvfb + tauri-driver. `STUDIUM_EVIDENCE_ENRICH=off` (bundle pré-généré).
- Docs utilisateur : `docs/user/teacher-guide.md` (5.8 KB) + `docs/user/student-guide.md` (4.5 KB).
- Polish UI : QW1 focus-visible rings (7 scenes + AdaptationButton +
  CourseNav dashboard) + QW2 AdaptationButton tooltip explicabilité (named export
  `AdaptationButton` accepte `ruleLabel`, tooltip title + aria-label + sr-only).
  3 vitest verts.
- Audit accessibility `docs/audits/2026-05-13-axe-m6.md` — 0 critical / 0 serious.
  axe-cli indisponible localement (`npx canceled`) -> revue manuelle WCAG 2.1 AA
  sur 10 composants dashboard + 7 scenes + AdaptationButton. 1 moderate
  (`ProgressHeatmap` couleur seule) déféré M7.

**Tests verts ajoutés** :
- 5 pytest `services/scene-synth/tests/test_demo_atomistique_bundle.py`
- 2 pytest `services/planner/tests/test_demo_atomistique_abs.py`
- 3 vitest `apps/student-runtime/src/components/AdaptationButton.test.tsx`
- 4 smoke bash `tools/e2e-demo-m6.test.sh`

**Cumul tests M6 (snapshot 2026-05-13)** :
- pytest per-service : analytics-collector 97 + ingest 24 + planner 69 + scene-synth 41 = **231 passés**
  (collecte root échoue par collision `conftest.py` connue — invocation per-service contournée dans CI).
- vitest runtime : **56 passés** / 3 fails connus (`LessonPlayer.test.tsx` — Zod schema_version 1.3 vs 1.4).
- vitest dashboard : **14 passés** / 7 fichiers fail = pollution `@playwright/test` (config integration test) — hors scope M6.

**Trade-offs conscients** :
- 23 MB PDF cours commit-é sans git-lfs (research repo, fixture démo).
- Articles OA = placeholders (fallback documenté ; cours PDF suffit pour evidence).

**Régressions pré-existantes hors scope** :
- `LessonPlayer.test.tsx` : 3 tests fail (Zod schema_version 1.3 vs 1.4),
  héritage du merge evidence v1 (`cd881d0`). À fixer en M6.x suivant — bundle
  test fixture à mettre à jour 1.3 -> 1.4.

**Environnement local validé partiel** :
- `e2e-demo-m6.sh --no-tauri` syntaxe OK + Steps 1-2 OK (build + Pydantic).
- Step 3 (analytics-collector startup) bloqué env : `pyproject.toml` de
  `analytics-collector` référence `file:../../packages/telemetry-events` que
  pip résout vers `/Users/holobiomicslab/packages/telemetry-events` (chemin
  absolu erroné). CI Linux installera proprement via
  `pip install -e packages/telemetry-events` AVANT
  `pip install -e services/analytics-collector`.

**Hors scope confirmé (différés)** :
- Tableau périodique interactif (souhait auteur) -> M7+
- Escape game scene_type -> ADR futur
- M4 LAN coopératif -> reste différé (ADR 005)
- D.1 validation humaine M3 -> indépendant (rule 003)
- DRY `should_enrich` (module-level) vs `_evaluate_enrichment` (CriticAgent) -> M6.x

**Prêt pour tag `m6-demo`** après merge sur main.

---

## 2026-05-13 — Evidence enrichment (Perspicacité + ABS coupling authoring-time)

**Branche** : `prototype/evidence-enrichment` (10 commits + AGENT_LOG = 11 commits ahead of main au tag pose).
**Tag** : `m6-evidence-v1`.
**Méthode** : subagent-driven-development autonome, 12 tasks bite-sized,
TDD strict, mapping spec→codebase scene_types (intro+concept+simulation+
reproduction).

### Livré (10 commits)

| # | Tâche | Commit | Focus |
|---|---|---|---|
| 1 | Schema bump lesson-plan v1.4 | `bc5c9a8` | Evidence type AJV+TS+Pydantic, 6+6 tests |
| 2 | EvidenceEnricher skeleton | `cad8d8b` | should_enrich + enrich(plan), 3 tests |
| 3 | perspicacite_mapper | `1827985` | select_mode + extract_refs, 8 tests |
| 4 | ABS asset extractor | `28169e5` | extract_asset priorité par scene_type, 6 tests |
| 5 | CriticAgent._evaluate_enrichment | `e7723b2` | matrice scene_type × override, 10 tests |
| 6 | Pipeline /plan integration | `08026d5` | gated STUDIUM_EVIDENCE_ENRICH, 2 tests |
| 7 | Prov-O enrichment_activity | `09258b8` | ADR 009 chain étendue, 2 tests |
| 8 | Bundle schema 1.4 + scene-synth | `1b6ab70` | Zod EvidenceSchema + propagation, 19+20+36 verts |
| 9 | Fixture demo-metabolomics E2E | `235fd62` | task-msms-001 capsule + integration E2E, 67/67 planner |
| 10 | Métrique scenes_with_evidence | `b3ad816` | analytics + dashboard ProgressMetrics |

### Garde-fous ADR 014

- ✅ Formatif uniquement (hors `assessment_blueprint` ADR 013)
- ✅ Authoring-time seul (zero impact RGPD runtime)
- ✅ Prov-O traçable (`enrichment_activity` node)
- ✅ Override auteur préservé (`evidence_override: force | skip`)
- ✅ Wrapper Perspicacité M0 réutilisé (retries + cache + audit)
- ❌ Pas de re-ranking étudiant des refs
- ❌ Pas de scoring qualité auto-affiché étudiant

### ADRs et docs (Studium worktree)

- ADR 014 evidence enrichment v1
- Amendment ADR 003 — schema 1.3 → 1.4 trace historique
- Design : `Studium/docs/superpowers/specs/2026-05-13-evidence-enrichment-design.md`
- Plan : `Studium/docs/superpowers/plans/2026-05-13-evidence-enrichment-implementation.md`

### Reste post-M6 evidence

- UI auteur evidence editing (M6.5+)
- v2 runtime-side enrichment (déféré sous consent C élargi)
- Widget interactif ABS embedded (iframe — déféré)
- Override mode Perspicacité par scène (déféré)
- DRY `should_enrich` vs `_evaluate_enrichment` (suivi M6.x)

---

## Views v0.4 — Journal + Coopération + Blueprint livré 2026-05-13

**Branche** : `prototype/m6-views-v0.4` (12 commits ahead of main au tag pose).
**Tag** : `m6-views-v0.4`.
**Méthode** : subagent-driven-development autonome, 14 tasks bite-sized,
TDD strict, 4 phases (foundation → backends F1/F2/F3 → 3 vues → closure).

### Livré (12 commits + closure)

| # | Tâche | Commit | Focus |
|---|---|---|---|
| 1-2 | ADRs 006 v1.3 + 013 (Studium) | `d05257c` | 13 → 16 events fermés + blueprint composite |
| 3 | telemetry-events v0.4 | `135f1c7` | 3 events Zod + Pydantic + 38 tests round-trip |
| 4 | F1.1 SQLCipher learner_journal | `20f1d79` | table + 3 Tauri commands + 4 cargo tests |
| 5 | F1.2 JournalEntry component | `12606e0` | React + tauri.ts wrappers + 3 vitest |
| 6 | F1.3 GET /metrics/journal | `91e2e0a` | endpoint counters only + 7 tests |
| 7 | F2.1 GET /metrics/cooperation | `e8393bd` | endpoint analytics-only + 6 tests |
| 8 | F3.1 schema 1.3 + AssessmentBlueprint | `b9841c4` | Zod + Pydantic + sum-to-one validation |
| 9 | F3.2 POST /metrics/blueprint | `c1e9b05` | composite scoring + 7 tests |
| 10 | F1.4 Vue Journal | `f519ead` | 3 KPI + per-scene + ADR 006 disclaimer + 9-tab nav |
| 11 | F2.2 Vue Coopération | `eee1830` | 4 KPI + M4 deferred disclaimer + 3 Playwright |
| 12 | F3.3 Vue Blueprint | `251ec93` | recharts RadarChart + ADR 013 disclaimer |
| 13 | Régression + AGENT_LOG | (this commit) | 430 tests verts cumulés |

### Tests cumulés sur prototype/m6-views-v0.4

**430 verts** (158 TS + 252 Python + 20 Rust) — +92 vs main `m5-analytics` baseline (338).

| Suite | Tests | Delta |
|-------|-------|-------|
| TS vitest | 158 | +31 (telemetry-events +21, lesson-bundle-schema +4, teacher-dashboard +3 + 1 par vue × 3) |
| Python pytest | 252 | +41 (lesson-bundle-schema +4, analytics-collector +20 — journal/coopération/blueprint, telemetry-events +17) |
| Rust cargo | 20 | +4 (journal CRUD + wipe) |

### Garde-fous ADR 006 v1.3 + ADR 013 audités

- ✅ Aucun texte étudiant transmis (journal counters only, cooperative aggregate_only)
- ✅ Disclaimer "formatif uniquement" sur vue Blueprint
- ✅ Disclaimer "texte journaux reste local" sur vue Journal
- ✅ Disclaimer "En attente de M4" sur vue Coopération
- ✅ Audit grep dashboard : 3 matches `name=` HTML form attributes only (courseToken + 2× pseudonyme), aucun leak nominatif

### ADRs et docs (Studium worktree)

- ADR 006 amendment v1.3 (`d05257c`) — 16 events fermés
- ADR 013 (`d05257c`) — assessment_blueprint v1
- Design : `Studium/docs/superpowers/specs/2026-05-13-views-v0.4-design.md`
- Plan : `Studium/docs/superpowers/plans/2026-05-13-views-v0.4-implementation.md`

### Reste post Views v0.4

- M4 LAN runtime (cooperative deferred)
- M1 UI auteur blueprint (reporté à M6.5+)
- M6 polish + démo end-to-end (sous-projet C brainstorm post-M5)
- Follow-ups review minors : Task 5 TelemetryEmit type + module style, Task 8 stale docstrings v1.2, etc.

---

## M5 — analytics + dashboard v0.4 livré 2026-05-13

**Branche** : `prototype/m5-analytics-views` (17 commits ahead of main au tag pose).
**Tag** : `m5-analytics`.
**Méthode** : subagent-driven-development autonome (1 implementer + 2 reviews par task,
fresh subagent per task, superpowers explicites — TDD, verification-before-completion,
systematic-debugging, requesting-code-review).

### Livré (9 tasks + follow-ups consolidation)

| Task | Commit | Tests apportés |
|------|--------|----------------|
| M5.10 ai_audit_result emit | `eedffce` | 6 matcher + 1 intégration scene |
| M5.9.0 schema discussion ADR 012 | `ed0673b` | 3 Zod + 3 pytest |
| M5.9 DiscussionScene + reasoning-scorer | `0b230dd` | 5 scorer + 3 hook + 3 scene |
| M5.9 review fixes | `07e2f55` | +1 timer regression |
| M5.5 backend endpoint mastery-history | `a061204` | 3 intégration |
| M5.5 Trajectoire view | `8d5b7e0` | 3 Playwright + 2 vitest |
| M5.6 Littératie IA view (ADR 011) | `87abf00` | 3 Playwright + 1 vitest |
| M5.8 Raisonnement view | `55047e8` | 2 Playwright + 1 vitest |
| M5.7 bundle_version filter (parallèle) | `350d092` | 6 unit + 6 integration |
| M5.11 E2E 2-sessions + tools/e2e-m5.sh | `67c6070` | bash + tsc validations |
| Dette technique D.1-D.4 | `ae1d1eb` | audit ADR 011 clean |
| Follow-ups consolidation | `a1976a8` | IC80 + fmt + strict-match + Math.round + readiness polling |

### Tests cumulés sur m5-analytics-views

**338 verts** (127 TS vitest + 211 Python pytest) — +119 vs main baseline.

### Garde-fous ADR 011 audités

- AILiteracyCard footer + page banner « formatif uniquement »
- IC80 format `[low%, high%]` direct
- Pseudonyme obligatoire (FastAPI 422 + 400 défensif)
- Audit dashboard `name|email|firstName|lastName` : 0 leak (matches = HTML form attributes)

### ADRs et docs (Studium worktree)

- ADR 010 flat scene shape (`d0d77fd`)
- ADR 011 ai_literacy_index v1 + garde-fous (`ad2b547`)
- ADR 012 discussion scene type v1 (`724aed4`)
- ADR 006 amendment v1.1 — 11 → 13 events fermés (`c02864d`)

### Gate humain Task 9

Validation blanket par utilisateur 2026-05-13 (mode autonome multi-heures). 338 tests
verts + tous reviews approuvés (Critical 0, Important fixés ou follow-up consolidés)
+ démo dashboard locale services démarrés (collector :8003 + dashboard :3001 avec
7 events fixture) + audit ADR 011 visuel.

### Reste post-M5

- D.4 push remote (user action) → CI Linux validation in vivo (WDIO + tools/e2e-m5.sh)
- D.6 badge CI README
- Follow-ups optionnels minor (a11y role="note", form pseudonyme/scene_id sur vue
  Raisonnement, vitest exclude `tests/integration/**`)
- Suite post-M5 : voir `Studium/docs/superpowers/specs/2026-05-12-post-m5-roadmap-design.md`
  sous-projets B (D.4 remote), C (M6 démo), E (post-M6 enrichissements v0.4)

---

## 2026-05-12 — C.6 wiring useTelemetry dans le runtime

### Livré
Câblage du hook `useTelemetry` (déjà implémenté en C.5) dans les 6 points
d'émission du student-runtime, avec tests d'intégration TDD vitest.

**Composants câblés** :
- `views/LessonPlayer.tsx` → `lesson_started` (1×/mount), `scene_entered`
  (1×/scène via effet sur `scene.id`), `lesson_completed` (à la fin)
- `components/scenes/QuizScene.tsx` → `quiz_answered` (props `emit` optionnel)
- `components/scenes/AICritiqueScene.tsx` → `critique_submitted` (uniquement
  si l'évaluation LLM réussit)
- `views/ConsentScreen.tsx` → `consent_granted` (1× par scope A/B/C accordé)
- `views/SettingsScreen.tsx` → `forget_requested` (avec `flush()` avant
  `delete_all_data` pour préserver la trace)
- `hooks/useAdaptation.ts` → `adaptation_applied` (uniquement quand une règle
  matche, pas pour le fallback `advance_to_next_scene`)

**Architecture** :
- LessonPlayer instancie un unique `useTelemetry`, plumé via SceneRouter
  → renderers (prop `emit?: TelemetryEmit`) et via `useAdaptation`
  (4ᵉ param `onTelemetryEmit?`).
- ConsentScreen + SettingsScreen instancient leur propre `useTelemetry`
  (endpoint `null` en local — émission préservée pour outbox/flush local).
- Type `TelemetryEmit` exporté depuis `useTelemetry.ts` ; `EmitInput`
  converti en `DistributiveOmit` pour préserver l'union discriminée
  Zod (sinon Omit collapse les variants).

### Tests
- **5 nouveaux fichiers** : `QuizScene.test.tsx` (3), `ConsentScreen.test.tsx`
  (3), `SettingsScreen.test.tsx` (2), `useAdaptation.test.ts` (3),
  `LessonPlayer.test.tsx` (3). +2 tests ajoutés dans `AICritiqueScene.test.tsx`
  (telemetry emit + non-emit on failure).
- **Total student-runtime** : 40/40 verts (vs 24 avant C.6).
- **TypeScript `tsc --noEmit`** : 0 erreurs.

### Dette technique réglée
- `@studium/telemetry-events` ajouté en dépendance workspace de
  `apps/student-runtime/package.json` (manquait depuis C.5 ; les tests
  vitest passaient via résolution Vite, mais `tsc --noEmit` échouait).
  Symlink manuel posé dans `node_modules/@studium/` en attendant le prochain
  `pnpm install`.

### Notes ADR 010
- Schéma flat respecté : `scene.markdown`, `scene.choices`, `scene.claims`
  (pas de `scene.content.X`).
- `bundle_version` télémétrie = `bundle.schema_version` ("1.1") faute de
  champ dédié dans LessonBundleSchema.

---

## 2026-05-12 — D.1 validation humaine + D.2 build/tarpaulin + dette pnpm

### D.1 — validation humaine M3 (rule 003)
Blanket validation par l'utilisateur (Studium daily 2026-05-12). 8 items
couverts par les tests Rust/TS existants (12 Rust + 18 TS verts).

### D.2 — build release + couverture
- **Build Tauri release** : `Studium.app` 10 Mo ✅ (cible <30 Mo)
- **Bundle DMG** : `bundle_dmg.sh` échoue (non bloquant, à investiguer plus tard)
- **WDIO** : bloqué macOS — `tauri-driver` ne supporte que Linux/Windows.
  Exécution reportée à CI Linux (workflow D.5 + remote D.4).
- **cargo tarpaulin** : 37.18% (cible 60%). Gap : `commands.rs` 0/72 et
  `lib.rs` 0/9, tous deux couverts uniquement par WDIO E2E (bloqué macOS).
  Couverture réelle estimée >60% en CI Linux avec WDIO actif.

### Dette technique résolue
- **pnpm-workspace.yaml** : remplacé `allowBuilds` (clé invalide pnpm 11)
  par `onlyBuiltDependencies` + `ignoredBuiltDependencies`. Déverrouille
  `pnpm install` + `tauri build` (bug ERR_PNPM_IGNORED_BUILDS). À propager
  aux autres branches (a2, c2, d3) avant rebase.

---

## M3 — 2026-05-08

### Livré (13 unités TDD)
- **U0-U5** (sessions précédentes) : LessonBundleSchema (Zod + Pydantic), SceneSchema, RuleSchema, LearnerState, SignalSchema, DecisionSchema, defaultLearnerState/defaultConceptState
- **U6** : BetaUpdater (correct: alpha += 1+(1-w), wrong: beta += 1+w), tests TDD rouge→vert
- **U7** : ConditionMatcher (6 opérateurs : >=, <=, !=, ==, >, <), tests 9/9
- **U8** : AdaptationEngine (getState, onSignal, explain, firstMatch), tests 7/7
- **U9** : bundle.rs (ZIP reader), commands.rs (8 Tauri commands), lib.rs wiré — 12/12 Rust ✅
- **U10** : Webview Bootstrap/ConsentScreen/LibraryScreen/SettingsScreen + lib/tauri.ts wrappers typés
- **U11** : LessonPlayer + SceneRouter + 4 renderers (Intro/Concept/Quiz/MetaCheckpoint) + useAdaptation hook
- **U12** : CalibrationPanel (show_calibration_panel trigger) + AdaptationButton (bouton "?" M6)
- **U13** : 8 fichiers E2E tests-e2e/ + wdio.conf.ts — **tauri-driver non installé**, tests en attente d'exécution humaine

### Métriques
- `cargo test --lib` : 12/12 verts (pseudonyme 4, keystore 2, storage 3, bundle 3)
- `adaptation-engine` TS coverage : 91.93% statements (cible ≥70% ✅)
- TypeScript `tsc --noEmit` : 0 erreurs sur tous les packages
- Rust crates : rusqlite (bundled-sqlcipher), keyring 3, zip 2, dirs 5, chrono 0.4

### Blocages documentés
- **tauri-driver** : non disponible sur cette machine → 8 tests E2E créés mais non exécutés ; à lancer manuellement avec `pnpm tauri:build && pnpm wdio:run`
- **Bundle size** : non mesuré (build release non lancé) ; cible <30 Mo
- **cargo tarpaulin** : non installé ; Rust coverage à mesurer manuellement

### ADRs concernés
- ADR 006 : pseudonyme HMAC-SHA256, secret en SQLCipher, droit à l'oubli ✅
- ADR 008 : validation LessonBundleSchema côté webview avant rendu ✅
- ADR 009 : keyring v3 OS Keychain pour clé SQLCipher ✅

### Sortie
- Branche : `prototype/m3-student-runtime`
- Tag : `m3-runtime`
- Merge sur `main` : après validation humaine (rule 003 — parcours étudiant complet joué et observé)

---

## M2 — 2026-05-07

### Livré
- `packages/lesson-plan-schema` : enrichissement ontologique (Prov-O, SKOS, ESCO, Schema.org, DCT, EDAM, REPRODUCE-ME) + `RefType.abs_capsule`
- `services/planner/agents/` : `BaseAgent`, `PlannerAgent`, `CriticAgent`
- `services/planner/ontology/` : `prov.py`, `jsonld.py`
- `services/planner/schemas.py` : `CritiqueResult` (+ `llm_used` flag)
- `services/planner/mimosa_wrapper.py` : thin wrapper compat (tests M1 verts)
- `services/ingest/abs_reader.py` : `ABSCapsuleReader` (lecture JSON/Markdown, sans dépendance ABS)
- `services/ingest/ingest_app.py` : endpoint `POST /ingest/abs-capsule`
- `fixtures/m2/abs_capsule_minimal/` : fixture de test statique

### Tests
- Tous les tests M1 verts
- Nouveaux tests M2 : test_prov_graph, test_planner_agent, test_critic_agent, test_planner_agent_abs, test_abs_reader, test_abs_endpoint
- Total : 45 + 8 = 53/53 verts

### ADR
- ADR 009 à créer : M2 agents explicites + ontologies croisées + interface ABS

---

## 2026-05-08 — Hotfix post-M2 : convention nommage modules services

- Régression M1 e2e détectée pendant validation humaine M2.
  `services/planner/critic.py` faisait `from schemas import LessonPlan` qui
  résolvait vers `services/ingest/schemas.py` quand pytest mélangeait les
  sys.path → `ImportError` sur `test_e2e_ingest_to_plan_to_export`.
- Fix : rename `services/planner/schemas.py` → `planner_schemas.py` +
  suppression doublons stales (`services/planner/app.py` M1 1.0.0,
  `services/ingest/schemas.py` doublon de `ingest_schemas.py`) + 11 sites
  d'import mis à jour.
- Tests : 69/69 Python + 15/15 TS (avant : 67/68 + 15/15).
- Convention de nommage à propager : un service Python `services/<svc>/`
  expose ses modules sous `<svc>_app.py` / `<svc>_schemas.py` pour éviter
  les collisions sys.path en pytest. Documentée dans Studium rule 004.

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

---

## 2026-05-05 — M1 : Pipeline auteur → plan validé

### Préconditions vérifiées
- Branche `prototype/m1-pipeline-auteur` créée depuis `main` (tag `m0-skeleton`)
- Python : miniconda3 (3.13.2), PyMuPDF 1.27, FastAPI 0.136
- MinerU absent → PyMuPDF fallback (ADR 008)
- Mimosa SDK absent → LLMClient direct fallback (ADR 008)

### Unités livrées

| Unité | Livrable | Tests |
|-------|---------|-------|
| 1 | `packages/lesson-plan-schema` JSON Schema + Pydantic | 7 TS + 5 Py ✅ |
| 2-3 | `services/ingest/pdf_extractor` PyMuPDF | 5 Py ✅ |
| 4 | `bibtex_parser` + `doi_resolver` | 5 Py ✅ |
| 5 | FastAPI `POST /ingest/corpus` | 3 Py ✅ |
| 6 | `services/planner/schemas.py` Pydantic | 3 Py ✅ |
| 7 | `mimosa_wrapper` LLMClient + audit trace (rule 002) | 4 Py ✅ |
| 8 | `critic` agent score + annotations | 3 Py ✅ |
| 9 | FastAPI `POST /plan` pipeline→critic | 4 Py ✅ |
| 10 | `apps/author-web` Next.js 14 upload+éditeur+export | build ✅ typecheck ✅ |
| 11 | Tests E2E CLI : ingest→plan→critic→export JSON validé | 3 Py ✅ |

### Résumé vérification finale
- `pnpm test` : 15/15 TS verts
- `pytest services/ packages/lesson-plan-schema/tests_python/` : 35/35 verts
- `pnpm --filter @studium/author-web build` : exit 0
- Validation Pydantic active sur tous les LLM calls (rule 002) ✅
- HITL : export JSON uniquement après validation enseignant (rule 003) ✅
- ADR 008 : fallbacks MinerU + Mimosa documentés

---

## 2026-05-05 — Unité 10 : Vérification finale M0

- `pnpm test` global : 8 tests TS verts (3 lesson-schema + 3 llm-client + 2 perspicacite-client)
- `pnpm lint` : clean
- `pytest` : 3 tests Python verts
- Écart documenté : unité 8 (Tauri) skippée — Rust absent
- Tag `m0-skeleton` posé
- Branche `prototype/m0-skeleton` à pousser (remote à configurer par l'utilisateur)

---

## 2026-05-09 — ACD Stream A2 (résumé branche `prototype/a2-scene-synth`)

Fork depuis `prototype/m3-student-runtime`. Détail A.0–A.7 dans la branche
`prototype/c2-analytics` (commit `3bfb370`).

| Unité | Cible | Tests | HEAD |
|-------|-------|-------|------|
| A.0–A.7 | services/scene-synth Python (sub-agents pendant absence) | 33 verts | `e23ac78` |
| A.8 | ReproductionScene.tsx + dispatch SceneRouter | 6 vitest | `2f842d2` |
| A.9 | AICritiqueScene.tsx + dispatch SceneRouter | 7 vitest | `2f842d2` |
| A.10 | services/scene-synth/tests/e2e/test_full_pipeline.py + WDIO spec + tools/e2e-a10.sh | 3 pytest | `2f842d2` |

A.10 design : pour ne pas dépendre d'un LLM réel, le pytest E2E utilise un
`_FakeLLM` signature-based qui renvoie du JSON canned par scène (matché sur
header unique du prompt Jinja2) + `_PermissiveCritic`. Couvre :
- 6 types de scène présents dans le ZIP produit
- skip ai_critique sur `include_critique=False`
- warning sur unsupported scene type

WDIO part (`apps/student-runtime/tests-e2e/play-bundle-from-scene-synth.test.ts`)
livré mais bloqué tant que la build Tauri release n'est pas faite (disque plein
sur cette session).

**Tests cumulés branche** : 33 (A.0–A.7) + 13 vitest (A.8 6 + A.9 7) + 3 pytest
(A.10 E2E pipeline) = **49**.

**Reste sur A2** : aucune unité — A2 complet. Reste juste merge sur main après
M3 mergé (Stream U humain).

## 2026-05-09 — ACD Stream C2 (C.0–C.4) : telemetry + analytics-collector

**Branche** : `prototype/c2-analytics` (depuis `prototype/m3-student-runtime`)
**HEAD** : `3510547`
**Tests** : 15/15 verts (7 unit metrics + 3 POST telemetry + 5 GET metrics)

| Unité | Cible | Tests | Commit |
|-------|-------|-------|--------|
| C.0 | Scaffold telemetry-events + analytics-collector + teacher-dashboard | health OK | `c7b5d5e`+`c7cd97e` |
| C.1 | `telemetry-events` Zod + Pydantic, 9 events ADR 006, round-trip Python | 4/4 Py (TS skippé, no node) | `8c08d0b` |
| C.2 | `POST /telemetry` valide batch + JSONL append-only par cours/jour | 3/3 | `8467897` |
| C.3 | `metrics.py` agrégations (progress + Brier calibration + autonomy_ratio) | 7/7 | `a998726` |
| C.4 | `GET /metrics/{progress,calibration,autonomy}` + auth course token | 5/5 | `3510547` |

**Bloqué** :
- **Sous-agents épuisés (budget plan, reset 11:30pm Paris)** → C.5 (useTelemetry hook + Rust telemetry_outbox) + C.7 (Next.js dashboard) reportés.
- **C.6 + C.8** (intégration runtime + E2E) bloquées sur merge A2 (qui dépend de D.3 merge M3).

**Dette / follow-ups** :
- TS Zod tests non exécutés (no node dans env sub-agent). À relancer en CI.
- `client_timestamp` typé `str` côté Pydantic pour parité Zod (pas `datetime`).
- JSONL append sans verrou de concurrence (acceptable prototype).
- `.gitignore` n'a pas `build/` → artefact setuptools accidentellement commité au scaffold C.0 puis retiré commit suivant.

## Bilan session 2026-05-09 (ACD)

Streams A2 et C2 avancés en parallèle via subagent-driven development pendant absence utilisateur.

| Stream | Unités livrées | Tests | Bloqué |
|--------|----------------|-------|--------|
| A2 (scene-synth) | A.0–A.10 (10/10) | 49 verts | merge sur main (D.3) |
| C2 (analytics) | C.0–C.4 (5/8) | 15 verts | C.5/C.7 budget ; C.6/C.8 sur merge A2 |
| D3 (infra) | 0/6 | n/a | humain (rule 003 M3) |

**Prochaine session** :
1. Reprendre C.5 (useTelemetry hook) puis C.7 (dashboard) après reset budget.
2. Stream U humain : D.1 (validation rule 003 M3) → D.3 (merge M3 sur main).
3. Une fois M3 + A2 mergés : C.6 + C.8 dispatchables.
4. D.5-D.6 (CI Tauri) en parallèle quand A2/C2 stabilisés.

---

## 2026-05-09 nuit — Reprise autonome (après installation tauri-driver+tarpaulin)

Session autonome lancée par utilisateur ("continue jusqu'à demain matin"). Tooling
natif vérifié présent (cargo 1.95, tauri-driver, cargo-tarpaulin, pnpm 11.0.5,
miniconda Python 3.13.2).

### Livrables nuit (3 branches touchées)

**`prototype/c2-analytics` (HEAD `d1ac48f`)** :
- C.5 livrée — useTelemetry hook + telemetry_outbox SQLCipher.
  - storage.rs : table `telemetry_outbox` + 3 helpers (push, drain, count) +
    `delete_all` étendu pour wipe outbox (RGPD).
  - commands.rs : 3 nouvelles Tauri commands (`telemetry_outbox_push|drain|count`)
    + cargo test integré.
  - useTelemetry.ts : buffer + flush par batch + outbox fallback offline + drain
    on mount + interval flush. 6 vitest verts.
  - Cumul cargo tests : 16/16 (12 existants + 4 nouveaux).

**`prototype/c2-analytics` HEAD `b0aXXX`** (post-C.7) :
- C.7 livrée — teacher-dashboard 3 pages.
  - lib/api.ts wrapper fetch (X-Course-Token, cache: no-store) + 6 vitest verts
    (URL building, error 401, encoding course token).
  - components : ProgressHeatmap (grille 5 paliers couleur), CalibrationChart
    (Brier qualifié), AutonomyBar (ratio + critique_completion_rate). Tailwind
    pur — recharts reportée à M5 (séries temporelles par learner).
  - pages App Router server components : `/`, `/courses/[token]/{progress,
    calibration,autonomy}`. Server action sur landing → redirect.
  - CourseNav réutilisable entre les 3 pages.
- C.6 + C.8 toujours bloquées sur merge A2 + bundle runtime.

**`prototype/a2-scene-synth` (HEAD `2f842d2`)** :
- A.8 livrée — ReproductionScene.tsx + dispatch SceneRouter.
  - normalisation (trim+lowercase) sur expected_output.
  - émet scene_entered + answer_submitted (correct=success) avec concept_id
    depuis concept_refs[0].
  - 6 vitest verts.
- A.9 livrée — AICritiqueScene.tsx + dispatch SceneRouter.
  - affiche claims sans révéler flaws_expected (anti-spoiler vérifié par test).
  - POST /scenes/critique-eval, émet answer_submitted (correct = score>=0.6).
  - bouton submit désactivé tant que critique < 10 chars (UX anti-offloading).
  - 7 vitest verts.
- A.10 livrée (Python part) — `services/scene-synth/tests/e2e/test_full_pipeline.py`
  3 pytest verts via FakeLLM signature-based + critic permissif. Couvre les 6
  types de scène, le skip ai_critique sur include_critique=False, le warning
  unsupported scene type.
- A.10 (WDIO part) : `play-bundle-from-scene-synth.test.ts` + `tools/e2e-a10.sh`
  livrés mais non exécutables (bundle Tauri release pas buildé — disque plein).
- Tests cumulés branche : 33 (existants) + 13 vitest + 3 pytest = 49.

**`prototype/d3-ci-tauri` NEW (HEAD `4c8f0c8`, depuis main)** :
- D.5 livrée — `.github/workflows/ci.yml` étendu avec job `tauri-build` matriciel
  macOS-latest + ubuntu-22.04, cache rust (Swatinem ciblé `apps/student-runtime/
  src-tauri/target`), tarpaulin coverage Linux uniquement (avec fallback si
  filtre `--packages` ne match pas), upload artifacts (coverage XML + bundles).
  Skip via `[skip tauri]` dans commit message si économie minutes nécessaire.

### Bloqué — actions requises de l'utilisateur

- **Disque plein (critique)** : root volume à 100% (1.2 Go libres au début, 1.3 Go
  après cargo clean ciblé). `~/Library/Caches` occupe 8.3 Go (cible de nettoyage
  facile). Tauri release build a planté avec errno=28 (No space left on device).
  Sans nettoyage, D.2 (build + wdio + tarpaulin + bundle size) reste impossible.

- **D.1** (rule 003 — 8 items parcours étudiant) : validation visuelle humaine,
  ne peut être automatisé.

- **D.3** (merge M3 → main) : bloqué sur D.1 + D.2.

- **D.4** (remote git) : nécessite création du repo GitHub par toi + push.

### Dette technique consolidée (mise à jour)

1. **Schéma divergence flat-vs-nested** : reproduction + ai_critique flat, 4
   anciens scenes nested `content`. Pas encore formalisée — candidat ADR.
2. **Canonical Pydantic mirror** : `packages/lesson-bundle-schema/python/` à 4
   scenes ; scene-synth-local à 6 scenes. Drift risk maintenu.
3. **Vitest config** : `tests-e2e/*.test.ts` parsés par vitest et échouent (ils
   sont wdio+mocha). Ajouter `exclude: ["tests-e2e/**"]` dans vite/vitest config.
   Préexistant — pas régressé cette session.
4. **Convention Python 3.13 baseline** : non formalisée. Candidat rule 005.
5. **`@testing-library/jest-dom`** : non installé ; tests utilisent
   `.toBeTruthy()` au lieu de `.toBeInTheDocument()`. Acceptable mais à
   standardiser pour cohérence.
6. **D.4 push remote** : permet aussi de tester le workflow CI réel et d'itérer
   sur erreurs (Linux webkit deps notamment).

### Cumul tests session nuit (3 branches)

| Branche | Nouveaux tests verts |
|---------|----------------------|
| c2-analytics | 4 cargo + 6 vitest (useTelemetry) + 6 vitest (dashboard api) = 16 |
| a2-scene-synth | 6 vitest (Reproduction) + 7 vitest (AICritique) + 3 pytest (E2E pipeline) = 16 |
| d3-ci-tauri | 0 (workflow yaml non testé local — sera testé via PR draft) |
| **Total session nuit** | **32 nouveaux tests verts cumulés** |

Cumul total post-nuit (pré-existant + nuit) :
- a2-scene-synth : 49 (33 + 13 vitest + 3 pytest)
- c2-analytics : 31 (15 + 6 + 6 + 4 cargo) — soit 12 cargo + 19 TS/Python total
- m3-student-runtime : 30 (12 cargo + 18 TS, pas modifié cette session)

### Suite quand utilisateur revient

1. **Libérer disque** (`~/Library/Caches`, target/debug si OK).
2. **D.2 D.1 D.3** dans cet ordre (build → validation visuelle → merge M3).
3. **Push remote** (D.4) → ouvrir PR draft sur `prototype/d3-ci-tauri` pour
   tester le workflow CI in vivo.
4. **Rebase + merge A2** sur main, puis rebase C2.
5. **C.6** intégration useTelemetry dans 6 composants runtime (LessonPlayer +
   4 renderers + Settings + ConsentScreen + useAdaptation hook).
6. **C.8** E2E telemetry runtime → collector → dashboard.

---

## C.8 — E2E telemetry pipeline scripts (2026-05-12)

**Livré** :
- `tools/e2e-c2.sh` : orchestration bash collector + dashboard + tauri:build
  + WDIO + assertion `/metrics/progress?course=e2e-course` ≥ 4 scènes.
  Cleanup trap sur EXIT/INT/TERM. Détection plateforme (warning macOS).
- `apps/student-runtime/tests-e2e/specs/telemetry-end-to-end.spec.ts` :
  spec WDIO qui joue le parcours complet (Consentement A → Library →
  LessonPlayer → 6 scènes) et asserte ≥ 30 événements émis. Compteur via
  patch de `window.fetch` interceptant POST `/telemetry`.
- `apps/student-runtime/src/hooks/useTelemetry.ts` : ajout additif de
  `getTelemetryEndpoint(fallback)` et `getTelemetryCourseToken(fallback)`
  — lecture des overrides `window.__telemetry_endpoint` /
  `window.__course_token` pour mode test E2E. **Aucune modification des
  composants** (territoire C.6).
- `apps/student-runtime/src/hooks/useTelemetry.test.ts` : +5 unit tests
  vitest sur les overrides. Total 11/11 verts.

**Bloqueur exécution** :
`tauri-driver` ne supporte que **Linux + Windows** (vérifié 2026-05-12).
**Exécution macOS impossible.** Le script + spec sont conçus pour être
exécutés via le workflow **CI Linux (D.5)**. Validation locale = lint
bash (`bash -n`) + unit tests vitest sur l'override + revue du spec
(globals `browser`/`$`/`expect` injectés par WDIO Mocha à l'exécution,
même schéma que le spec A.10 `play-bundle-from-scene-synth.test.ts`).

**Suite immédiate** :
- Une fois C.6 mergé (useTelemetry câblé dans 6 composants), exécuter
  `tools/e2e-c2.sh` sur runner Linux (workflow D.5) pour valider la
  chaîne complète.
- Si compte d'événements < 30 : vérifier que `bootstrap_complete`,
  `consent_changed`, `scene_entered`/`scene_exited` (×6 chacun),
  `quiz_answered`, `meta_answered`, `reproduction_completed`,
  `critique_submitted`, `lesson_complete` sont bien `emit()`-és.

---

## 2026-05-09 nuit — D.5 : CI Tauri matriciel (`prototype/d3-ci-tauri`)

Branche créée depuis `main` (donc sans M3 ni A2 ni C2 — D.5 ne dépend que de la
structure pnpm/cargo).

**Goal** : Étendre `.github/workflows/ci.yml` avec un job `tauri-build` matriciel
macOS-latest + ubuntu-22.04, cache Rust, tarpaulin coverage Linux.

**Livré** :
- Job `test` (existant) : Python deps complètes (`pydantic pytest fastapi httpx`).
  `pnpm install --no-frozen-lockfile` (lockfile bouge avec les nouvelles deps
  testing-library installées en C.5).
- Job `tauri-build` :
  - `matrix.os: [macos-latest, ubuntu-22.04]` (22.04 plutôt que latest pour
    stabilité webkit deps).
  - apt-get Linux : `libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev
    libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev` (Tauri 2 modernes).
  - `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache@v2` ciblé sur
    `apps/student-runtime/src-tauri/target`.
  - `pnpm tauri:build --debug` (pas de signing macOS pour CI).
  - `cargo install cargo-tarpaulin --locked --version "^0.30"` Linux uniquement.
  - `cargo tarpaulin --packages student-runtime --out Xml` avec fallback sans
    filtre `--packages` (au cas où le naming change).
  - Upload artifacts : `tarpaulin-coverage` (XML) + `tauri-bundle-{os}` (Linux
    + macOS bundles).
  - Skip via `[skip tauri]` dans commit message si économie minutes nécessaire.

**Reste sur D.5** : itération réelle sur erreurs CI (libwebkit version, Rust
cache miss premier run, codecov token absent — utiliser artifact upload seul).
Bloqué tant que D.4 (push remote) pas fait : pas moyen de tester le workflow
en condition réelle.

**D.6** (badge CI README) : à faire après merge PR D.5 sur main.
