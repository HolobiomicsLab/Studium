# AGENT_LOG — prototype-build

Journal des unités TDD par milestone. Mis à jour à chaque commit significatif.

---

## 2026-06-28 — Régénération du jugement PAR-RUN : lève le caveat de déterminisme

Lève le caveat de déterminisme de la boucle opération→jugement : un `spot_the_flaw` avec `reference_from_run` + `regenerate_from_run` voit son `flawed_content` + `claims` RÉGÉNÉRÉS depuis le run RÉEL de l'apprenant (côté serveur) — les défauts plantés collent à SES chiffres, même pour une capsule STOCHASTIQUE.

- `lesson-bundle-schema` (TS + mirror Python) : `spot_the_flaw.regenerate_from_run` (optionnel).
- `lesson-session` : `setSceneOverride(sceneId, override)` + `scene()` fusionne l'override EN PREMIER (présentation ET notation voient le jugement régénéré), puis l'overlay reference_result.
- `lesson-session-host` : port `JudgmentGenerator` + `StubJudgmentGenerator` (déterministe, key-free ; le générateur LIVE est LLM-backed → clé requise). `SessionHostOptions.judgmentGenerator` (opt-in). `host.ingestRunResult` (quand l'apprenant lance la capsule) régénère les `spot_the_flaw` en aval (reference_from_run===task_card && regenerate_from_run) depuis le run de l'apprenant → `setSceneOverride`. La clé-réponse régénérée reste CÔTÉ SERVEUR (publicScene strip claims/model_correction).

**Vérification** : lesson-session-host 113 (régénéré depuis le landmark de l'apprenant ; clé-réponse non-fuitée ; sans générateur → défauts d'auteur inchangés ; trust alimenté) ; `tsc` 3 packages ; scene-synth 206 (mirror) ; suite TS complète exit 0. Revue adverse (workflow 2 lentilles). HONNÊTETÉ : la qualité de régénération LIVE nécessite une clé ; le mécanisme + le stub sont prouvés key-free.

---

## 2026-06-28 — Colonne vertébrale de COURS : séquençage multi-leçons

Ferme le dernier blocker « cours » de l'analyse de gaps : aucune couche au-dessus du bundle (pas de course_outline / lesson_sequence / next_lesson). Une COLONNE de cours séquence les leçons par-dessus le profil cross-lesson.

- `lesson-bundle-schema/course.ts` : `CourseSchema` (course_id, title, lessons:[{lesson_id, bundle_ref, title?, prerequisite_lesson_ids[]}]) + routeur PUR `nextCourseLesson(course, completedLessonIds)` (première leçon non-faite dont TOUS les prérequis sont faits ; null si fini/bloqué — linéaire, DAG, sans-prérequis) + `isCourseComplete`.
- `learner-state` : `LearnerProfile.completed_lessons` (optionnel, rétro-compatible) + `recordCompletedLesson` pur (dédupliqué, non-mutant).
- `lesson-session-host` : `host.respond`(complete) enregistre la leçon complétée dans le profil ; `host.nextLesson(course, learnerId)` lit `completed_lessons` (pseudonyme niveau-apprenant) → routeur ; `resolveCourse(bundlesRoot, courseRef)` charge + valide `course.json`. Fixture `fixtures/courses/decay-course.json` (capsule-run-demo → capsule-loop-demo qui le requiert).

**Vérification** : lesson-bundle-schema 62 (routeur : linéaire/DAG/prérequis/fini ; parse) + learner-state 30 + lesson-session-host 111 (e2e : complète A → next B → complète B → null ; par-apprenant ; resolveCourse charge le fixture) ; `tsc` 3 packages ; suite TS complète exit 0. Revue adverse (workflow 2 lentilles + réfutation par finding).

---

## 2026-06-28 — Profil apprenant CROSS-LESSON : démarrage à chaud entre leçons

Ferme un blocker original de l'analyse de gaps : l'état était keyé par (pseudonyme, bundle) → un concept maîtrisé en leçon A repartait À FROID en leçon B. Un PROFIL apprenant (niveau-apprenant) agrège l'état des concepts entre bundles.

- `learner-state` : `LearnerProfile` (concept_states keyés par concept_id + pseudonyme + updated_at) + helpers PURS `seedConceptStatesFromProfile` (warm-start : copie l'état du profil pour les concepts du bundle ABSENTS de l'état per-bundle — le per-bundle a la PRIORITÉ, jamais écrasé) + `mergeConceptStatesIntoProfile` (carry-forward latest-wins, non-mutant).
- `lesson-session-host` : `LearnerProfileStore` (InMemory par défaut — persiste entre sessions d'une instance host ; `FileLearnerProfileStore` = `<dataDir>/<pseudonyme>/profile.json` en mode durable). Le pseudonyme du PROFIL est salé par un scope FIXE (`__learner_profile__`), donc STABLE entre leçons (le pseudonyme per-bundle est salé par bundle_id). `host.create` SEED l'état initial depuis le profil (avant `session.start`) ; `host.respond` (complete) MERGE l'état de la leçon dans le profil ; `host.forget` (RGPD) efface AUSSI le profil cross-lesson.
- HYPOTHÈSE documentée : un concept de même id entre bundles EST le même concept (espace de concepts partagé — le composeur de cours assigne des ids partagés) ; si les ids sont locaux au bundle, ça ne seed simplement pas.

**Vérification** : learner-state 30 (seed/merge purs : warm/cold, précédence per-bundle, non-mutation, round-trip) + lesson-session-host 109 (e2e : concept travaillé en A → chaud en B ; non-apparenté reste froid ; isolation par apprenant ; forget efface le profil) ; `tsc` host ; suite TS complète exit 0. Revue adverse (workflow 3 lentilles + réfutation).

---

## 2026-06-28 — Opérateur agentique RÉEL (LLM-backed) + démo bout-en-bout

L'opérateur n'est plus seulement stub/watch : un VRAI opérateur LLM pilote une leçon complète run+jugement. Il POSSÈDE l'exécution — Studium n'exécute jamais.

- `lesson-session-host/session-runner.ts` : `makeLlmOperator({ llm, runCapsule })` — sur une scène `reproduction(run_manifest)` il lit le manifeste et LANCE la capsule via `runCapsule` injecté (l'opérateur exécute, pas Studium) ; sur un `spot_the_flaw` il appelle `llm` pour JUGER la lecture IA défectueuse du run de l'apprenant ; quiz/meta/contrôle = réponse déterministe ; la clé-réponse n'entre jamais dans le prompt. `OperatorLlm = {complete(prompt)}` (découplé du provider) + `writeRunResult` exportés.
- Démo `apps/lesson-mcp/llm-operator-demo.ts` : câble un VRAI run de capsule (`python3 tools/capsule_runner.py`, uv venv isolé) + LLM (placeholder key-free par défaut ; `--live` = LiteLLM via LITELLM_BASE_URL). **EXÉCUTÉE bout-en-bout sans clé sur `capsule-loop-demo` : `next → next → complete ✔`, trust_calibration alimenté (1 sample de run jugé).** Le run de capsule est RÉEL ; la qualité du jugement live nécessite une clé (frontière d'honnêteté).

**Vérification** : lesson-session-host 107 (l'opérateur LLM pilote la boucle key-free : capsule lancée sur la scène run, LLM-jugée sur le spot_the_flaw ancré, trust alimenté ; aucun appel LLM sur un run échoué) ; démo réellement exécutée (capsule réelle, key-free) ; `tsc` host+mcp ; suite TS complète exit 0. Revue adverse (workflow 3 lentilles + réfutation par finding) : 0 must-fix ; appliqués — should-fix (runner démo parse STDOUT de capsule_runner → gracieux sur `deferred`/`no-executable` au lieu d'un crash ENOENT) + 2 nits (override `LITELLM_MODEL` ; `.studium-session/` gitignored).

---

## 2026-06-28 — Parité canal MCP : protocole de run pour VS Code natif

Donne au canal MCP (surface VS Code native, MCP-only) la parité avec le canal fichier pour le protocole de run apprenant — pour que l'extension studium-vscode puisse piloter la boucle run + jugement. Studium n'exécute JAMAIS.

- `apps/lesson-mcp/server.ts` : 2 nouveaux outils — `get_run_manifest` (le manifeste de provisioning/run de la scène courante, NON porteur de réponse, ou null) et `submit_run_result` (ingère le run de l'opérateur ; gate sur ran&&passed ; renvoie {status, learner_run_recorded, transition? redacted}).
- `lesson-session-host/host.ts` : cœur PARTAGÉ `ingestRunResult(id, result)` (gate ran&&passed → recordLearnerRun(task_card_id) → avance via ack ; garde-fou `not_a_run_scene`) utilisé par les DEUX canaux (l'outil MCP + `SessionWorkspace.ingestRun` REFACTORISÉ pour l'appeler — pas de dérive) ; + `runManifest(id)`.
- REDACTION : une scène de run (run_manifest présent) RETIENT son run d'auteur — `publicScene` drop `reference_result` + `host.sceneArtifacts` filtre `executed_result` (parité avec le canal fichier ; l'apprenant produit frais). Le jugement `reference_from_run` reste ancré sur le run de l'APPRENANT côté MCP, et la clé-réponse reste redacted.

**Vérification** : lesson-mcp 12 (parité : manifeste null/présent ; gate ran&&passed + self-heal ; passing→avance + jugement ancré sur le run apprenant + trust_calibration alimenté ; not_a_run_scene) + lesson-session-host 105 (redaction publicScene/sceneArtifacts) + canal fichier inchangé (refacto sans régression) ; `tsc --noEmit` host+mcp ; suite TS complète exit 0. Revue adverse multi-lentilles (workflow : 4 lentilles + réfutation par finding).

---

## 2026-06-28 — Boucle opération→jugement : ancrer un jugement sur le run de l'APPRENANT

Ferme la boucle nord-star : l'apprenant lance la capsule lui-même (protocole de run), PUIS audite une lecture IA défectueuse de SON PROPRE résultat exécuté — et ce jugement alimente `trust_calibration`. « Opération réelle = véhicule ; jugement calibré d'un artefact réel = destination. »

- `lesson-bundle-schema` (TS + mirror Python) : `spot_the_flaw` gagne un champ optionnel `reference_from_run` (un task_card_id) — le jugement est ancré sur le run capturé de l'apprenant. + export du type `ReferenceRun`.
- `lesson-session` : `recordLearnerRun(taskCardId, run)` mémorise le run de l'apprenant ; le SEUL point d'injection est `scene()` (accesseur unique présentation+notation) : pour un `spot_the_flaw` avec `reference_from_run` ET un run enregistré, renvoie une copie avec `reference_result` = le run de l'apprenant — donc l'évidence affichée ET le `flawGrader` (qui pose `judgment_audit` quand reference_result≠null → `trust_calibration`) voient le run de l'apprenant. Aucun run → scène d'auteur inchangée (non-ancrée, pas de fabrication).
- `lesson-session-host` : `host.recordLearnerRun` ; `SessionWorkspace.ingestRun` projette le `run_result` de l'opérateur en `ReferenceRun` (`runResultToReferenceRun`) et l'enregistre sous le task_card_id de la scène run AVANT d'avancer.
- Fixture `fixtures/capsule-loop-demo` (intro → reproduction(run_manifest) → spot_the_flaw(reference_from_run)).

HONNÊTETÉ : les défauts plantés (claims) supposent un résultat CANONIQUE ; l'ancrage sur le run de l'apprenant n'est sain que pour une capsule DÉTERMINISTE (même landmark à chaque run) — vrai pour `capsule-demo` (seed fixe).

**Vérification** : lesson-session 3 (overlay ancré→reference_result injecté ; sans run→non-ancré ; notation→trust_calibration) + lesson-session-host e2e 1 (run → tâche jugement affiche le landmark de l'APPRENANT → noté → trust alimenté) ; lesson-session 213 · lesson-session-host 102 · lesson-bundle-schema 59 · scene-synth 206 ; `tsc --noEmit` 3 packages ; suite TS complète exit 0. Revue adverse (Opus) en cours.

---

## 2026-06-28 — Exécution PAR L'APPRENANT : protocole de run (délégation agentique pure)

Ferme le gap « no-host-learner-time-execution » : l'apprenant provisionne + exécute lui-même la capsule (via l'opérateur agentique dans l'espace de travail VS Code), Studium n'exécute JAMAIS (brain-only, pas de sandbox Studium). « Opération réelle = véhicule. » Décision utilisateur : DÉLÉGATION AGENTIQUE PURE (Studium émet un manifeste, l'opérateur installe + lance).

- `lesson-bundle-schema` (TS + mirror Python `scene_synth_schemas`) : `RunManifest` + champ optionnel `run_manifest` sur `ReproductionScene` — instructions de provisioning/run NON porteuses de réponse (capsule_ref / install / cmd / noms de fichiers produits / vérifs d'existence), JAMAIS les valeurs attendues ni le landmark de l'auteur.
- Canal fichier `.studium-session/` (`SessionWorkspace`) : pour une scène reproduction avec `run_manifest`, `writeStep` émet `run.json` + une tâche « provisionne & lance » (statut `awaiting_run`) en RETENANT le landmark de l'auteur (l'apprenant produit un résultat frais). L'opérateur lance dans l'espace de travail puis écrit `run_result.json` ; `ingestRun` le valide, GATE l'avancement sur `ran && passed` (enregistre le run de l'apprenant en statut `ran` + landmark/artifacts) et s'auto-répare (absent → attente ; `ran:false`/vérifs échouées → consommé + feedback correctif, jamais bloqué). `run-result.ts` (RunResultSchema + parseRunResult lenient).
- Harnais `runStudiumSession` rendu run-aware (`OperatorCtx.expects`) ; `stubOperator` écrit un run PLACEHOLDER passant (n'exécute rien), `watchOperator` attend `run_result.json` ; `writeRunResult` (atomique). Le CLI `--watch`/`--stub` marche sans changement.
- Fixture `fixtures/capsule-run-demo/lesson.json` (intro + reproduction-with-run_manifest, dérivée de `capsule-demo`). Doc `agentic-session-protocol.md` mise à jour.

**Délégation pure** : aucun process lancé côté Studium — l'e2e prouve le PROTOCOLE (run simulé par l'opérateur/stub) ; l'exécution réelle est celle de l'opérateur agentique dans VS Code.

**Vérification** : run-protocol host 4 + harnais 2 ; lesson-bundle-schema 59 (RunManifest) ; lesson-session-host 100 ; `tsc --noEmit` host+schema ; scene-synth 200 (mirror Python round-trip) ; suite TS complète exit 0. Revue adverse (Opus) en cours.

---

## 2026-06-27 — Calibration du jugement-sur-artefact : `trust_calibration`, dimension d'engine de première classe

Atteint la DESTINATION nord-star : « dans un monde où l'opération scientifique est conduite par l'IA, la compétence durable n°1 est la confiance CALIBRÉE dans une sortie ». Une nouvelle dimension `trust_calibration` — DISTINCTE de `confidence_calibration` — mesure si la confiance de l'apprenant dans une lecture IA défectueuse d'un RÉSULTAT EXÉCUTÉ RÉEL suit la vérité-terrain, et GATE dessus.

- `packages/learner-state` : `ConceptState.trust_calibration`/`_samples` (optionnels, rétro-compatibles) ; `recordJudgmentAudit` (over-trust = défauts ratés `+`, over-distrust = faux positifs `−` ; cap fp≤planted ; EWMA λ=0.5 ; clamp [-1,1] ; planted=0 ⇒ no-op) ; `isTrustCalibrated`/`isTrustMiscalibrated`/`isOverTrusting` (mesuré + bande, mirrors confidence). `answer_submitted` gagne `judgment_audit?` (grounded/planted/caught/false_positives).
- `packages/adaptation-engine/engine.ts` : un `answer_submitted` portant `judgment_audit.grounded` plie la confiance-dans-l'artefact dans `trust_calibration` (indépendant de la confiance-en-soi) ; `buildContext` expose `trust_calibration(+abs)` pour les règles.
- `lesson-session/grading/graders.ts` : `flawGrader` attache `judgment_audit` UNIQUEMENT quand la scène est ancrée (`reference_result` présent) — une scène de jugement non-ancrée ne nourrit JAMAIS la dimension de confiance.
- **GATE certification** (`mastery-claims.ts`) : OVER-TRUST-SEUL — retient la claim d'un apprenant compétent MAIS systématiquement crédule (a raté les défauts d'une lecture IA d'un vrai résultat) ; la sur-méfiance n'est jamais retenue (mirrors overconfiance-seule). La compétence seule ne certifie pas : le jugement calibré EST la destination évaluée.
- **GATE skip** (`graph-nav.ts buildLwgCalibration`) : nudge symétrique de recalibration sur la mal-calibration de confiance OU de trust.

**HONESTY BOUNDARY** : seul l'OVER-TRUST est alimenté en LIVE aujourd'hui — le matcher renvoie `false_positives=0` (il porte la clé-réponse des défauts plantés, pas les affirmations SAINES nécessaires pour détecter le sur-signalement), donc en production `trust_calibration` ne monte que ≥0. La dimension signée + le gate symétrique sont prêts ; la capture de l'over-distrust attend un signal « affirmations saines » du matcher.

**Vérification** : learner-state 26 · adaptation-engine 50 · lesson-session 210 ; `tsc --noEmit` 3 packages ; suite TS complète exit 0 (25 packages/apps, zéro régression). Revue adverse (Opus) : math CORRECTE, 0 must-fix, ship-with-fixes — le should-fix (honnêteté over-distrust) appliqué en commentaires.

---

## 2026-06-27 — Chaîne de composition : planner → scene-synth → bundle de jugement ancré

Ferme le blocker « le planner et scene-synth sont deux services disjoints que rien ne chaîne ; le planner ne peut même pas demander une scène de jugement ». Une seule passe in-process transforme (manifeste corpus + capsule) en bundle gradé incluant une scène `spot_the_flaw` ancrée sur une EXÉCUTION RÉELLE. « Opération scientifique réelle = véhicule ; jugement calibré d'un artefact réel = destination. »

- `lesson-plan-schema` (Python + mirror TS `src/index.ts` & `src/schema.json`) : `SceneType` gagne `spot_the_flaw` — le planner peut enfin DEMANDER une scène de jugement.
- `planner_agent._enrich_from_abs` : avec `emit_judgment_scenes`, émet une scène `spot_the_flaw` par task card (à côté de la reproduction), pointant sur la même capsule. Défaut OFF (les cours existants gardent leur forme exacte).
- `scene-synth/orchestrator.py` : injection `capsule_runner` ; `_synthesize_judgment` résout la capsule via `corpus_refs`, l'exécute UNE fois (mémoïsée), enrichit l'outline avec le `reference_run` vérifié (le LLM lit des valeurs réelles, ne les invente pas) + le cadran de fiabilité, et attache le run exécuté comme `reference_result` (attaché PAR CODE, non-hallucinable). Non-ancré ⇒ warning honnête, jamais fabriqué.
- `SynthesizeOptions` : cadran `judgment_n_flaws`/`judgment_level`/`judgment_guidance` (fiabilité paramétrable par l'auteur).
- `capsule_runner.py` : expose `research_question` dans le résultat (pour le prompt du juge).
- `tools/compose_lesson.py` : l'entrée de la chaîne (planner → orchestrateur ancré → bundle) ; isolation `sys.modules`/`sys.path` pour la collision de packages `agents` planner vs scene-synth.

**Vérification** : orchestrator-grounding 3 (run réel mémoïsé + non-ancré averti) · planner-abs (judgment émis/omis) · chaîne e2e RÉELLE sur `fixtures/capsule-demo` (vrai uv venv, landmark `k_fit=` vérifié, non-halluciné) ; scene-synth 200 · planner 190 · lesson-plan-schema 13 (TS) ; zéro régression. Revue adverse (Opus) = ship-with-fixes ; should-fix corrigés (warning si projecteur de grounding absent ; `_resolve_capsule` 2-passes exact-match-d'abord ; restore `sys.path`).

---

## 2026-06-27 — Tap de confiance per-réponse + EWMA glissant (calibration continue LIVE)

Ferme le follow-up de la tranche #3 : la capture de calibration per-réponse passe de « prête » à **LIVE** dans les deux surfaces.
- **Webview** (`media/artifact-pane.js` + `.css`) : sélecteur « Ta confiance : 0–4 » sur les scènes quiz + free-text ; la confiance tapée chevauche l'input soumis (`withConf`). Omise si non tapée.
- **Notebook** (`src/notebook.ts`) : token optionnel `conf:N` (0–4) en fin de cellule → extrait par `extractConfidence` (pur, testable, dans `scene-io.ts`) et attaché à l'input ; aide d'intro mise à jour ; un chiffre nu (meta_checkpoint) n'est PAS un token.
- **Moteur** (`learner-state` + `adaptation-engine`) : `CALIBRATION_ANSWER_LAMBDA=0.4` ; la voie per-réponse utilise λ<1 → MOYENNE GLISSANTE (plus last-write-wins) ; la voie `meta_checkpoint` reste λ=1.0 (auto-jugement délibéré = signal plein, déclenche la règle 0.4). `updateCalibration`/`recordConfidenceSample` prennent un λ.
- `ResponseInput` (scene-io.ts) gagne `confidence?` sur les kinds-réponses.

**Vérification** : tsc ; learner-state 18 (test EWMA glissant vs last-write-wins) · adaptation-engine 47 · studium-vscode scene-io 51 (extractConfidence + parité) · webview-pane 68 (tap → `input.confidence` dans les 2 surfaces) ; zéro régression (lesson-session 408, lesson-session-host 188, lesson-mcp tsc). La calibration-gating est désormais alimentée en continu PAR RÉPONSE, plus seulement au meta_checkpoint.

---

## 2026-06-27 — Calibration-gating : calibration = dimension de première classe, évaluée + GATING

**Tranche #3 de la pivot capsule-backed (décision verrouillée).** `confidence_calibration` devient une dimension SAMPLE-COMPTÉE qui GATE ; capture per-réponse plumbée bout-en-bout (prête, pas encore alimentée par UI).

- `packages/learner-state` : `ConceptState.calibration_samples` (optionnel, rétro-compatible) ; `CALIBRATION_WELL_BAND=0.4` ; `recordConfidenceSample` (updateCalibration + samples++) ; `isCalibrated` / `isMiscalibrated` (mesuré + bande, symétrique) / `isOverconfident` (mesuré + sur-confiance seule). `answer_submitted` gagne `confidence?` optionnel.
- `packages/adaptation-engine/engine.ts` : `confidence_declared` → `recordConfidenceSample` (compte les samples) ; un `answer_submitted` portant un `confidence` capture aussi (per-réponse, contre la maîtrise POST-réponse).
- **GATE certification** (`mastery-claims.ts`) : OVERCONFIANCE-SEULE (`isOverconfident`) — on ne retient JAMAIS la claim d'un maître sous-confiant (par l'arithmétique, pour actual≥θ seule la sous-confiance dépasse la bande ⇒ un gate symétrique ne frapperait que les maîtres sous-confiants = pénalité de compétence). Inerte pour un vrai maître ; ne mord qu'une sur-confiance.
- **GATE skip** (`graph-nav.ts` `buildLwgCalibration` + param `calibrated` ; câblé `session.ts`) : SYMÉTRIQUE — skip-on-mastery ne saute PAS un concept maîtrisé-mais-mal-calibré (replay = nudge de recalibration peu coûteux). Conservateur : ne bloque jamais (au pire, atterrit SUR la scène).
- `ResponseInput` (types.ts + response-input-schema.ts) + `grade()` : portent un `confidence?` optionnel de l'entrée → signal.
- Cohérence « mesuré » : `host.ts calibrationVerdict` (+ port studium-vscode) renvoie `null` sans sample (sinon « bien calibrée » fabriqué pour un concept jamais auto-évalué).

**Vérification** : tsc 5 packages ; learner-state 17 · adaptation-engine 47 · lesson-session 408 · lesson-session-host 188 · 209 assertions drivers studium-vscode (e2e lesson-walk inclus) ; zéro régression (~660 tests back-end). Revue adverse (2 lentilles × Opus) = ship-with-fixes ; **2 must-fix corrigés** (le verdict learner-facing partage la déf « mesuré » ; gate certification overconfiance-seule + documenté) + should-fix (commentaires « continu » honnêtes ; λ=1.0 = last-write-wins documenté, pas EWMA).

**NON construit (suivi honnête)** : l'affordance UI du tap de confiance per-réponse (plumbing prêt+testé mais aucune UI ne l'alimente — seul le `meta_checkpoint` alimente la calibration en vrai aujourd'hui) ; EWMA glissant (λ<1) lié à cette UI ; diagnostic auditable des concepts retenus-pour-calibration.

---

## 2026-06-27 — Rendu inline de la figure `executed_result` (notebook)

Le contrôleur notebook (`apps/studium-vscode/src/notebook.ts`) rend désormais les assets `executed_result` (et `image`) comme **image native inline** — lecture du fichier depuis le dossier du bundle + légende (landmark / checks) — au lieu d'une simple note `📎`. La logique pure chemin+MIME est extraite dans `src/asset-path.ts` (testable) ; le câblage `vscode.*` reste tsc-only (Extension Host). Nouveau driver `asset-path` (8 assertions) ajouté au runner. Ferme le follow-up « rendu natif » du canal `.studium-session/`. Vérif : tsc + **208 assertions** drivers studium-vscode.

---

## 2026-06-27 — Harnais opérateur de session (`runStudiumSession` + CLI)

**Suite du canal `.studium-session/`** : un harnais *runnable* qui pilote une session complète avec un opérateur ENFICHABLE — le canal fichier devient utilisable, pas seulement testé.
- `packages/lesson-session-host/src/session-runner.ts` — `runStudiumSession(host, bundleRef, dir, operator)` boucle `writeStep → operator → ingest` jusqu'à `complete`. Opérateurs : `stubOperator` (placeholder déterministe sans clé, pour démos/tests), `watchOperator({pollMs,timeoutMs})` (ATTEND qu'un agent EXTERNE — Claude Code / Copilot / Codex / humain — écrive `response.json` ; Studium n'appelle aucun modèle), `writeResponse` (écriture atomique tmp+rename). La rédaction de la clé de réponse est héritée de `SessionWorkspace`.
- `apps/lesson-mcp/src/session-runner-cli.ts` — CLI : `tsx … <bundleRef> [--dir=] [--bundles-root=] [--stub]`. Défaut `--watch` (l'assistant du workspace pilote).
- `docs/agentic-session-protocol.md` — section « Run it » ; le harnais passe de follow-up à **livré**.

**Vérification** : lesson-session-host tsc + lesson-mcp tsc + **186 vitest** (3 nouveaux session-runner : session-stub-complète-avec-rédaction-tenue · watch-retourne-sur-réponse-externe · watch-timeout). **Run live** : la CLI `--stub` déroule `capsule-judgment-demo` jusqu'au bout (`next → next → complete`, 3 étapes) en laissant un vrai `.studium-session/` (task.md/feedback.md/index.json ; log : intro graded → 2× spot_the_flaw graded → complete).

---

## 2026-06-27 — Canal de session agentique fichier (`.studium-session/`) — outsourcing exécution/rendu

**Vision** : la leçon capsule-backed n'embarque PAS son propre sandbox d'exécution ni sa pile de rendu ; elle les délègue à l'**hôte VS Code** + un **opérateur agentique enfichable** (Copilot / Claude Code / Codex / opencode). Studium reste le *cerveau* (routage adaptatif, maîtrise, calibration, scènes de jugement + ancrage). Deux canaux : **MCP** (déjà existant, `apps/lesson-mcp`, déjà rédacté) et **fichiers** (nouveau, universel).

**Construit (branche `feat/capsule-judgment-slice`)** :
- `packages/lesson-session-host/src/session-workspace.ts` — conducteur `SessionWorkspace` du protocole `.studium-session/` : `writeStep()` écrit un `task.md` RÉDACTÉ (via `publicScene`) + le résultat réellement exécuté (landmark/figure, allowlist) + `index.json` (mémoire/log) ; `readResponse()` mappe `response.json` → ResponseInput (coercition du `kind`) ; `ingest()` note via le vrai grader, écrit `feedback.md`, avance. **Self-heal** : une `response.json` invalide/mal typée est consommée + `feedback.md` correctif (le canal ne se bloque pas).
- `tools/build_capsule_judgment_demo.py` émet aussi `fixtures/capsule-judgment-demo/lesson.json` (bundle chargeable : intro + 2 `spot_the_flaw` ancrés, rules:[] → avance linéaire).
- `docs/agentic-session-protocol.md` — les deux canaux + layout `.studium-session/` + quick-start opérateur (n'importe quel assistant) + garantie de rédaction.

**Invariant clé (vérifié)** : la clé de réponse (claims/flaws_expected/model_*) n'atteint JAMAIS l'opérateur via task.md/feedback.md/index.json. `publicScene` rédacte les champs de scène ; `renderTask` ne surface QUE l'asset `executed_result` + une allowlist de meta (landmark/path/cmd/passed), car `host.sceneArtifacts` n'est pas rédacté (asymétrie connue, commentée).

**Vérification** : lesson-session-host tsc + **180 vitest** (3 nouveaux : round-trip ancré rédacté · self-heal · no-leak-toutes-scènes) ; lesson-mcp build ; 200 assertions drivers studium-vscode (aucune régression). Revue adverse (2 lentilles × Opus) = ship-with-fixes ; **2 must-fix corrigés** (self-heal anti-blocage ; cette entrée AGENT_LOG) + 4 should-fix (allowlist commentée · écriture atomique documentée · prose rendu-natif resserrée · clause quick-start « pas de harnais opérateur »).

**NON construit (suivi honnête)** : rendu inline de la figure `executed_result` dans le notebook (aujourd'hui une note de référence ; le contrôleur n'a pas de cas `executed_result`) ; harnais opérateur réel (Claude Code/Copilot) ; intégration du `work/` opérateur dans l'évaluation de processus.

---

## 2026-06-27 — Slice « capsule-backed judgment » (vision capsule-backed lessons, tranche 1)

**Vision (verrouillée en discussion ; mémoire `studium-capsule-backed-lessons`)** : l'opération scientifique réelle est le *véhicule*, le jugement calibré est la *destination*. Première tranche de dé-risquage : prouver qu'un composeur agentique peut produire une scène de jugement ANCRÉE sur une exécution réelle.

**Construit (branche `feat/capsule-judgment-slice`)** :
- **Carrier TS** : `reference_result` (ReferenceRunSchema) optionnel sur `SpotTheFlawSceneSchema` ; `sceneRenderAssets` généralisé (`"reference_result" in scene`) → une scène de jugement ancrée expose le run réel comme asset `executed_result` (même carrier que `reproduction`).
- **Composeur** : nouvel agent génératif `SpotTheFlawAgent` + `prompts/spot_the_flaw.j2` (le type était schema-only ; l'orchestrateur le sautait — désormais 7 agents). Le prompt injecte le landmark RÉEL + un cadran de fiabilité auteur (`n_flaws`).
- **Ancrage** : `tools/ground_judgment.py::ground_spot_the_flaw` attache le `reference_result` depuis un vrai run `tools/capsule_runner.py` ; le LLM n'écrit que l'*interprétation*, le *résultat* est attaché par code (non hallucinable).
- **Miroir Python** : `ReferenceRun` ajouté (corrige le drift TS↔Python signalé par l'audit) + `reference_result`/`image_path` sur ReproductionScene & SpotTheFlawScene.
- **Démo e2e** : `tools/build_capsule_judgment_demo.py` exécute la VRAIE capsule (`fixtures/capsule-demo`, venv uv isolé) puis génère 2 scènes ancrées (subtle=1 défaut, blatant=3) → `fixtures/capsule-judgment-demo/{scenes.json,decay.png,README.md}`. Landmark réel `k_fit=0.4212`.

**Vérification** : 25 pytest scene-synth (agent + intégration ancrage + round-trip) ; 56 vitest lesson-bundle-schema (dont nouveau cas `executed_result` spot_the_flaw) ; tsc lesson-session/host/mcp ; 200 assertions drivers studium-vscode (aucune régression). Revue adverse (3 lentilles × Opus) = **ship-with-fixes, 0 must-fix** ; le seul should-fix corrigé : README + docstring n'impliquent plus que la démo déterministe prouve le *cadran de prompt* (le stub honore `n_flaws` via l'outline, pas le prompt rendu ; l'authorabilité du cadran est prouvée par test unitaire ; bout-en-bout = `--live`).

**NON prouvé (assumé, honnêtement signalé)** : qualité de génération avec un vrai modèle (pas de clé API dans ce shell — `--live` requis). Reportés (séparables) : calibration-as-gating + capture de confiance CONTINUE (décision « continuous » verrouillée pour la tranche suivante), provenance span-level, environnement capsule installé.

---

## 2026-06-27 — studium-vscode : câblage des scènes active-learning (audit → fix Wave 1-3)

**Contexte** : un audit multi-agent (21 agents) a montré que l'extension VS Code (`apps/studium-vscode`, le runtime étudiant) n'avait jamais été mise à jour quand les types de scènes Wave-1/Wave-2 ont atterri. Les 4 plus récents (comparison/summary_audit/prompt_practice/communication_sim) **cassaient la leçon** : les deux surfaces (webview `media/artifact-pane.js` + notebook `src/notebook.ts`) tombaient sur un `{kind:"ack"}` que leurs graders rejettent (`SceneGradingError`) → reset de session / toast d'erreur. Le bundle démo par défaut `atomistique-l1` est touché (scène 4 = summary_audit).

**Fix (renderer-only — aucun changement schema/grader/transport ; les champs arrivent déjà via publicScene)** :

| Wave | Contenu |
|---|---|
| 1 | comparison / summary_audit / prompt_practice / communication_sim : rendu des champs montrés + soumission du bon `kind` (calqué sur explain_back) sur les 2 surfaces. Source unique `src/scene-io.ts` (FREE_TEXT_KIND). |
| 2 | discussion multi-tours : message webview `{type:"turn"}` → `submit_turn` → signal de raisonnement + réplique socratique dans un transcript ; le notebook route tout texte non-`next` vers submit_turn jusqu'à max_turns puis ack. |
| 3 | reproduction : rendu des `steps[]` ; carte de calibration (`src/calibration.ts`, port verbatim de host.ts ; bandes sur/sous, sans chiffre) ; `end_session`/« 🗑 M'oublier » (purge RGPD confirmée par modale ; directive notebook `forget`) — la fermeture seule ne fait que couper le transport (l'état persiste pour reprise). |

**Balayage de complétude (no gaps overlooked)** : re-audit indépendant (agent) → 2 surfaces × 13 types × tools × render-kinds. Tout câblé SAUF un résidu réel **trouvé + corrigé** : le panneau webview ne rendait pas l'énoncé `quiz.question` ni `meta_checkpoint.pre_question`/`scale_labels` (le notebook le faisait) → l'élève voyait les boutons-réponses sans la question. Corrigé dans `renderPane` + libellés d'échelle ; gardé par 3 assertions de parité + 5 assertions DOM. Parité notebook ajoutée aussi : `presentation.explanation` (rationale d'adaptation) + directive `hint`. `explain_last_adaptation` (MCP) = redondant (la rationale est déjà poussée via `presentation.explanation`) — pas un gap.

**Vérification** : tsc clean, esbuild OK, **200 assertions de drivers** vertes (`pnpm --filter studium-vscode test`) — `scene-io` 44 (contrat scène→kind + parité webview + calibration), `webview-pane` 63 (rendu DOM LIVE via jsdom + clics → messages), `community` 19, `modality` 26, `review-fsrs` 36, `lesson-walk` 12. Back-end live : `lesson-walk.driver.ts` (e2e via le vrai serveur MCP) déroule `src/fixtures/wave-scenes.json` (bundle non-gaté, tous les types active-learning) + `all-scene-types.json` (boucle discussion) jusqu'à `complete`, et confirme que `summary_audit` d'atomistique-l1 ne lève plus d'erreur. (atomistique-l1 ne se termine pas sous answers synthétiques : son moteur adaptatif gate sur la maîtrise accumulée — comportement moteur, pas un bug.)

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
