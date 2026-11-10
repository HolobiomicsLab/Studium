export type Locale = "fr" | "en";
export type PhraseParams = Record<string, string | number>;

// FR: learner-facing French. Entries that were still English on 2026-10-29 (feedback words,
// engine explanations) were translated by the lead; the EN catalogue keeps them in English.
// L-5 (2026-10-30): « tu » throughout, accents restored in the file-channel strings, and the table is
// typeset by frenchSpacing below — write plain spaces here. L-6: the navigation explanations are
// neutral: they name no engine notion (item, threshold, remediation, universe) and claim neither a
// correct answer nor a lack of mastery that nothing measured.
const FR = {
  planted_flaws_found: "{found}/{total} défauts plantés trouvés",
  key_points_covered: "{covered}/{total} points clés couverts",
  claims_addressed: "{covered}/{total} affirmations traitées",
  deck_detail: "{caught}/{planted} défauts plantés trouvés ; {false_positives}/{sound_total} fausses alertes",
  // RT-1 / I-1: the offline (unjudged) feedback counts nothing, and the reference it is compared with
  // (key points, planted flaws, flawed claims, model answer) is data on the verdict, worded by each
  // surface (lesson-session-host chat-display.ts referenceMarkdown), not a phrase of this catalogue.

  explanation_graph_universe_escalated: "plusieurs détours — la suite sera plus guidée",
  explanation_replay_budget_exhausted: "étape déjà revue plusieurs fois — on continue",
  explanation_graph_prereq_gate: "d'abord, retour sur une notion préalable",
  explanation_graph_prereq_gate_passed: "notion préalable travaillée — on continue",
  explanation_graph_prereq_gate_released: "notion préalable revue plusieurs fois — on continue",
  explanation_graph_prereq_unassessable: "cette notion préalable n'a pas pu être mesurée ici — on continue",
  explanation_graph_skip_mastered: "notion déjà maîtrisée — étape passée",

  tutor_justification: "Quel est le maillon le plus faible de ton raisonnement ? Quel serait le meilleur argument contre ?",
  tutor_hypothesis: "Qu'observerais-tu si c'était vrai ? Comment pourrais-tu le vérifier toi-même ?",
  tutor_question: "Bonne question — qu'est-ce que tu sais déjà qui pourrait t'orienter vers la réponse ?",
  tutor_counterexample: "Ton contre-exemple tient. Dans quels cas l'affirmation de départ resterait-elle vraie ?",
  tutor_synthesis: "Formule-le comme une seule règle, puis nomme un cas qu'elle ne couvre pas.",
  tutor_scaffold_hint: "Avance d'un pas : qu'est-ce que tu sais déjà qui pourrait t'aider, sans donner la réponse ?",

  calibration_well: "Ta confiance était bien calibrée : ton ressenti collait à ce que montrent tes réponses.",
  calibration_over: "Tu étais un peu surconfiant·e : tu te sentais plus sûr·e que ne le montrent tes réponses. Vérifie ce concept avant de passer à la suite.",
  calibration_under: "Tu étais un peu sous-confiant·e : tes réponses ont été meilleures que ta confiance ne le laissait penser. Fais-leur un peu plus confiance.",

  workspace_feedback_heading: "# Feedback",
  workspace_missing_response: "⚠️ Pas de `response.json` valide trouvé. Écris ta réponse puis relance.",
  workspace_invalid_response: "⚠️ Réponse invalide pour cette scène ({error}). Attendu : `{ \"kind\": \"{kind}\", \"text\": \"…\" }` (ou simplement `{ \"text\": \"…\" }`). Réécris `response.json` et relance.",
  workspace_run_required: "⚠️ {message}. Canal fichier : lis `run.json`, lance sa commande dans CET espace de travail, puis écris `run_result.json`.",
  workspace_run_result_invalid: "⚠️ `run_result.json` invalide ou partiel. Réécris-le (écriture atomique).",
  workspace_run_advance_failed: "⚠️ Run ingéré, mais l'avancement a échoué ({error}).",
  workspace_run_incomplete: "⚠️ Le run n'a pas abouti (`ran:false`). Provisionne l'environnement (installe les dépendances de `run.json`), relance la commande, puis réécris `run_result.json`.",
  workspace_run_checks_failed: "⚠️ Run produit mais vérifications échouées : {checks}. Corrige et relance.",
  workspace_run_checks_fallback: "voir expected_outputs",
  workspace_run_ignored: "⚠️ `run_result.json` ignoré : la scène courante n'est pas une scène à exécuter.",

  workspace_instruction_spot_the_flaw: "Audite la lecture IA ci-dessous d'un résultat RÉELLEMENT exécuté. Repère ce qui est faux (avec justification).",
  workspace_instruction_ai_critique: "Critique les affirmations ci-dessous : repère les biais et les défauts.",
  workspace_instruction_explain_back: "Explique la notion avec tes propres mots.",
  workspace_instruction_comparison: "Compare A et B et nomme les différences ou la valeur ajoutée.",
  workspace_instruction_summary_audit: "Audite le résumé IA : quelles omissions ou distorsions ?",
  workspace_instruction_prompt_practice: "Écris (ou affine) un prompt pour la tâche ci-dessous.",
  workspace_instruction_communication_sim: "Rédige la communication demandée pour la situation ci-dessous.",
  workspace_instruction_quiz: "Réponds : `{ \"kind\": \"quiz_choice\", \"choiceId\": \"<id>\" }`.",
  workspace_instruction_meta_checkpoint: "Auto-évalue ta confiance : `{ \"kind\": \"confidence\", \"value\": 0-4 }`.",
  workspace_instruction_default: "Lis, puis réponds pour avancer.",

  workspace_task_title: "# Studium — étape {step} : {title}",
  workspace_run_already_recorded: "**Run déjà enregistré** (mesure : `{landmark}`). Pas besoin de le re-provisionner :",
  workspace_run_already_recorded_action: "réponds `{ \"kind\": \"ack\" }` pour continuer, ou relance-le et écris `run_result.json` pour un résultat frais.",
  workspace_scene_type: "**Type de scène :** `{type}`",
  workspace_ai_reading: "## Lecture IA à auditer",
  workspace_source: "**Source :**",
  workspace_ai_summary: "**Résumé IA :**",
  workspace_ai_claims: "**Affirmations de l'IA à critiquer :**",
  workspace_situation: "**Situation :** {text}",
  workspace_task: "**Tâche :** {text}",
  workspace_executed_result: "## Résultat réellement exécuté (vérité terrain — audite la lecture IA CONTRE ce résultat)",
  workspace_measure: "- **Mesure (landmark) :** `{text}`",
  workspace_figure: "- **Figure :** `{text}` (rendue nativement par l'hôte ou le notebook)",
  workspace_command: "- **Commande :** `{text}`",
  workspace_checks_passed: "- **Vérifications passées :** {text}",
  workspace_respond_heading: "## Répondre",
  workspace_write_response: "Écris ta réponse dans `response.json` (ce dossier) :",
  workspace_response_shorthand: "_(ou simplement `{ \"text\": \"...\" }` — Studium déduit le bon type d'entrée.)_",

  workspace_verdict_incorrect: "✗ Faux",
  workspace_verdict_correct: "✓ Juste",
  workspace_feedback_next: "✓ Réponse enregistrée — passage à l'étape suivante (`task.md` mis à jour).",
  workspace_feedback_replay: "↻ À revoir : la prochaine tâche revient sur cette étape.",
  workspace_feedback_replay_default: "on reprend cette étape",
  workspace_feedback_remediate_alt: "↻ Autre question sur ce point.",
  workspace_feedback_remediate: "↻ Notion préalable : {reason}. Détour par une scène de cette notion{returns_to}.",
  workspace_feedback_returns_to: " ; retour ensuite à `{scene}`",
  workspace_feedback_calibration: "⚖️ Point de calibration : compare ta confiance à ce que montrent tes réponses.",
  workspace_feedback_complete: "✔ Leçon terminée — {count} scènes.",

  workspace_run_task_title: "# Studium — étape {step} : {title} (reproduction)",
  workspace_run_scene_type: "**Type de scène :** `reproduction` — exécution PAR L'APPRENANT (l'hôte provisionne, tu lances).",
  workspace_run_heading: "## Provisionne et lance (dans CET espace de travail)",
  workspace_question: "**Question :** {text}",
  workspace_capsule: "- **Capsule :** `{text}`",
  workspace_install: "- **Installe :** {text}",
  workspace_launch: "- **Lance :** `{command}`{working_dir}",
  workspace_working_dir: " (dans `{text}`)",
  workspace_expected_outputs: "- **Sorties attendues :** {text}",
  workspace_verify: "- **Vérifie :**",
  workspace_run_report_heading: "## Rends compte du run",
  workspace_run_report_instruction: "Quand le run a produit ses sorties, écris `run_result.json` (ce dossier) :",
  workspace_run_landmark_example: "<la mesure que TON run a produite, depuis stdout>",
  workspace_run_attestation: "_(Studium ne lance rien : c'est TON run réel dans l'espace de travail qui fait foi.)_",
  workspace_run_measure: " (mesure : `{text}`)",
  workspace_run_complete: "✔ Run ingéré{measure} — leçon terminée ({count} scènes).",
  workspace_run_next: "✓ Run ingéré{measure} — tu as reproduit le résultat toi-même. Étape suivante (`task.md` mis à jour).",
} as const;

export type PhraseKey = keyof typeof FR;

const EN: Record<PhraseKey, string> = {
  planted_flaws_found: "{found}/{total} planted flaws found",
  key_points_covered: "{covered}/{total} key points covered",
  claims_addressed: "{covered}/{total} claims addressed",
  deck_detail: "{caught}/{planted} planted flaws found; {false_positives}/{sound_total} false positives",

  explanation_graph_universe_escalated: "several detours — what follows will be more guided",
  explanation_replay_budget_exhausted: "step already reviewed several times — moving on",
  explanation_graph_prereq_gate: "first, back to a prerequisite",
  explanation_graph_prereq_gate_passed: "prerequisite practised — moving on",
  explanation_graph_prereq_gate_released: "prerequisite revisited several times — moving on",
  explanation_graph_prereq_unassessable: "this prerequisite could not be measured here — moving on",
  explanation_graph_skip_mastered: "concept already mastered — step skipped",

  tutor_justification: "What is the weakest link in your reasoning? What would be the strongest counterargument?",
  tutor_hypothesis: "What would you observe if it were true? How could you verify it yourself?",
  tutor_question: "Good question — what do you already know that could point you toward the answer?",
  tutor_counterexample: "Your counterexample holds. In which cases would the original claim still be true?",
  tutor_synthesis: "State it as a single rule, then name one case it does not cover.",
  tutor_scaffold_hint: "One step at a time: what do you already know that could help you, without being given the answer?",

  calibration_well: "Your confidence was well calibrated: how sure you felt matched what your answers showed.",
  calibration_over: "You were slightly overconfident: you felt more certain than your answers showed. Check this concept before moving on.",
  calibration_under: "You were slightly underconfident: your answers were better than your confidence suggested. Trust them a little more.",

  workspace_feedback_heading: "# Feedback",
  workspace_missing_response: "⚠️ No valid `response.json` was found. Write your answer, then run again.",
  workspace_invalid_response: "⚠️ Invalid answer for this scene ({error}). Expected: `{ \"kind\": \"{kind}\", \"text\": \"…\" }` (or simply `{ \"text\": \"…\" }`). Rewrite `response.json` and run again.",
  workspace_run_required: "⚠️ {message}. File channel: read `run.json`, run its command in THIS workspace, then write `run_result.json`.",
  workspace_run_result_invalid: "⚠️ `run_result.json` is invalid or incomplete. Rewrite it atomically.",
  workspace_run_advance_failed: "⚠️ Run ingested, but advancing failed ({error}).",
  workspace_run_incomplete: "⚠️ The run did not complete (`ran:false`). Provision the environment (install the dependencies from `run.json`), rerun the command, then rewrite `run_result.json`.",
  workspace_run_checks_failed: "⚠️ The run completed, but checks failed: {checks}. Fix them and run again.",
  workspace_run_checks_fallback: "see expected_outputs",
  workspace_run_ignored: "⚠️ `run_result.json` ignored: the current scene is not an executable scene.",

  workspace_instruction_spot_the_flaw: "Audit the AI reading below of an ACTUALLY executed result. Identify what is wrong and justify it.",
  workspace_instruction_ai_critique: "Critique the claims below: identify biases and flaws.",
  workspace_instruction_explain_back: "Explain the concept in your own words.",
  workspace_instruction_comparison: "Compare A and B and name the differences or added value.",
  workspace_instruction_summary_audit: "Audit the AI summary: what does it omit or distort?",
  workspace_instruction_prompt_practice: "Write or refine a prompt for the task below.",
  workspace_instruction_communication_sim: "Write the requested communication for the situation below.",
  workspace_instruction_quiz: "Respond with: `{ \"kind\": \"quiz_choice\", \"choiceId\": \"<id>\" }`.",
  workspace_instruction_meta_checkpoint: "Rate your confidence: `{ \"kind\": \"confidence\", \"value\": 0-4 }`.",
  workspace_instruction_default: "Read, then respond to continue.",

  workspace_task_title: "# Studium — step {step}: {title}",
  workspace_run_already_recorded: "**Run already recorded** (measurement: `{landmark}`). You do not need to provision it again:",
  workspace_run_already_recorded_action: "respond with `{ \"kind\": \"ack\" }` to continue, or rerun it and write `run_result.json` for a fresh result.",
  workspace_scene_type: "**Scene type:** `{type}`",
  workspace_ai_reading: "## AI reading to audit",
  workspace_source: "**Source:**",
  workspace_ai_summary: "**AI summary:**",
  workspace_ai_claims: "**AI claims to critique:**",
  workspace_situation: "**Situation:** {text}",
  workspace_task: "**Task:** {text}",
  workspace_executed_result: "## Actually executed result (ground truth — audit the AI reading AGAINST this result)",
  workspace_measure: "- **Measurement (landmark):** `{text}`",
  workspace_figure: "- **Figure:** `{text}` (rendered natively by the host or notebook)",
  workspace_command: "- **Command:** `{text}`",
  workspace_checks_passed: "- **Checks passed:** {text}",
  workspace_respond_heading: "## Respond",
  workspace_write_response: "Write your answer in `response.json` (this folder):",
  workspace_response_shorthand: "_(or simply `{ \"text\": \"...\" }` — Studium infers the correct input type.)_",

  workspace_verdict_incorrect: "✗ Incorrect",
  workspace_verdict_correct: "✓ Correct",
  workspace_feedback_next: "✓ Answer recorded — moving to the next step (`task.md` updated).",
  workspace_feedback_replay: "↻ Review needed: the next task returns to this step.",
  workspace_feedback_replay_default: "this step again",
  workspace_feedback_remediate_alt: "↻ Another question on this point.",
  workspace_feedback_remediate: "↻ Prerequisite: {reason}. Detouring through a scene on it{returns_to}.",
  workspace_feedback_returns_to: "; then returning to `{scene}`",
  workspace_feedback_calibration: "⚖️ Calibration checkpoint: compare your confidence with what your answers show.",
  workspace_feedback_complete: "✔ Lesson complete — {count} scenes.",

  workspace_run_task_title: "# Studium — step {step}: {title} (reproduction)",
  workspace_run_scene_type: "**Scene type:** `reproduction` — execution BY THE LEARNER (the host provisions it; you run it).",
  workspace_run_heading: "## Provision and run (in THIS workspace)",
  workspace_question: "**Question:** {text}",
  workspace_capsule: "- **Capsule:** `{text}`",
  workspace_install: "- **Install:** {text}",
  workspace_launch: "- **Run:** `{command}`{working_dir}",
  workspace_working_dir: " (in `{text}`)",
  workspace_expected_outputs: "- **Expected outputs:** {text}",
  workspace_verify: "- **Verify:**",
  workspace_run_report_heading: "## Report the run",
  workspace_run_report_instruction: "When the run has produced its outputs, write `run_result.json` (this folder):",
  workspace_run_landmark_example: "<the measurement YOUR run produced, from stdout>",
  workspace_run_attestation: "_(Studium runs nothing: YOUR actual run in the workspace is the evidence.)_",
  workspace_run_measure: " (measurement: `{text}`)",
  workspace_run_complete: "✔ Run ingested{measure} — lesson complete ({count} scenes).",
  workspace_run_next: "✓ Run ingested{measure} — you reproduced the result yourself. Next step (`task.md` updated).",
};

/** L-5: French typography for the French catalogue — a narrow no-break space (U+202F) before ; ! ?,
 * a no-break space (U+00A0) before : and », and after « — outside `code spans`, which stay as written.
 * The same rule as the VS Code pane catalogue (apps/studium-vscode/src/phrases.ts frenchSpacing). */
export function frenchSpacing(text: string): string {
  return text.split(/(`[^`]*`)/).map((part, index) => (index % 2 === 1 ? part : part
    .replace(/[ \u00a0\u202f]+([;!?])/g, "\u202f$1")
    .replace(/[ \u00a0\u202f]+([:»])/g, "\u00a0$1")
    .replace(/«[ \u00a0\u202f]+/g, "«\u00a0"))).join("");
}

const FR_TYPESET = Object.fromEntries(
  Object.entries(FR).map(([key, text]) => [key, frenchSpacing(text)]),
) as Record<PhraseKey, string>;

/** Every key of the catalogue, for consumers and tests that walk it. */
export const PHRASE_KEYS = Object.keys(FR) as PhraseKey[];

const CATALOGUES: Record<Locale, Record<PhraseKey, string>> = { fr: FR_TYPESET, en: EN };

/** Resolve the learner-facing locale once from bundle metadata; unsupported languages retain French. */
export function localeFromLanguage(language: string | undefined): Locale {
  return language?.trim().slice(0, 2).toLowerCase() === "en" ? "en" : "fr";
}

/** Fixed learner-facing chrome only. Bundle-authored prose must bypass this catalogue unchanged. */
export function phrase(key: PhraseKey, params: PhraseParams = {}, locale: Locale = "fr"): string {
  return CATALOGUES[locale][key].replace(/\{([a-z_]+)\}/gi, (token, name: string) => {
    const replacement = params[name];
    return replacement === undefined ? token : String(replacement);
  });
}
