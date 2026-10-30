export type Locale = "fr" | "en";
export type PhraseParams = Record<string, string | number>;

// FR: learner-facing French. Entries that were still English on 2026-10-29 (feedback words,
// engine explanations) were translated by the lead; the EN catalogue keeps them in English.
const FR = {
  planted_flaws_found: "{found}/{total} défauts plantés trouvés",
  key_points_covered: "{covered}/{total} points clés couverts",
  claims_addressed: "{covered}/{total} affirmations traitées",
  deck_detail: "{caught}/{planted} défauts plantés trouvés ; {false_positives}/{sound_total} fausses alertes",
  // RT-1 / I-1: the offline (unjudged) feedback counts nothing, and the reference it is compared with
  // (key points, planted flaws, flawed claims, model answer) is data on the verdict, worded by each
  // surface (lesson-session-host chat-display.ts referenceMarkdown), not a phrase of this catalogue.

  explanation_graph_universe_escalated: "remédiations répétées — passage à l'univers de remédiation",
  explanation_replay_budget_exhausted: "revu plusieurs fois sans succès — on avance",
  explanation_graph_prereq_gate: "prérequis pas encore maîtrisé — retour en remédiation",
  explanation_graph_prereq_gate_passed: "item du prérequis réussi, maîtrise encore sous le seuil — on avance",
  explanation_graph_prereq_gate_released: "prérequis toujours non maîtrisé après plusieurs remédiations — on avance quand même",
  explanation_graph_prereq_unassessable: "prérequis non acquis et aucune scène ne peut l'évaluer — on avance quand même",
  explanation_graph_skip_mastered: "concept déjà maîtrisé — sauté",

  tutor_justification: "Quel est le maillon le plus faible de ton raisonnement ? Quel serait le meilleur argument contre ?",
  tutor_hypothesis: "Qu'observerais-tu si c'était vrai ? Comment pourrais-tu le vérifier toi-même ?",
  tutor_question: "Bonne question — qu'est-ce que tu sais déjà qui pourrait t'orienter vers la réponse ?",
  tutor_counterexample: "Ton contre-exemple tient. Dans quels cas l'affirmation de départ resterait-elle vraie ?",
  tutor_synthesis: "Formule-le comme une seule règle, puis nomme un cas qu'elle ne couvre pas.",
  tutor_scaffold_hint: "Avance d'un pas : qu'est-ce que tu sais déjà qui pourrait t'aider, sans donner la réponse ?",

  calibration_well: "Ta confiance était bien calibrée : ton ressenti collait à ta maîtrise réelle.",
  calibration_over: "Tu étais un peu surconfiant·e : tu te sentais plus sûr·e que ne le montrent tes réponses. Vérifie ce concept avant de passer à la suite.",
  calibration_under: "Tu étais un peu sous-confiant·e : tu maîtrises ce concept mieux que tu ne le penses. Fais-toi confiance.",

  workspace_feedback_heading: "# Feedback",
  workspace_missing_response: "⚠️ Pas de `response.json` valide trouve. Ecris ta reponse puis relance.",
  workspace_invalid_response: "⚠️ Reponse invalide pour cette scene ({error}). Attendu : `{ \"kind\": \"{kind}\", \"text\": \"…\" }` (ou simplement `{ \"text\": \"…\" }`). Reecris `response.json` et relance.",
  workspace_run_required: "⚠️ {message}. Canal fichier : lis `run.json`, lance sa commande dans CET espace de travail, puis ecris `run_result.json`.",
  workspace_run_result_invalid: "⚠️ `run_result.json` invalide ou partiel. Reecris-le (ecriture atomique).",
  workspace_run_advance_failed: "⚠️ Run ingere mais l'avancement a echoue ({error}).",
  workspace_run_incomplete: "⚠️ Le run n'a pas abouti (`ran:false`). Provisionne l'env (installe les dependances de `run.json`), relance la commande, puis reecris `run_result.json`.",
  workspace_run_checks_failed: "⚠️ Run produit mais verifications echouees : {checks}. Corrige et relance.",
  workspace_run_checks_fallback: "voir expected_outputs",
  workspace_run_ignored: "⚠️ `run_result.json` ignore : la scene courante n'est pas une scene a executer.",

  workspace_instruction_spot_the_flaw: "Audite la lecture IA ci-dessous d'un resultat REELLEMENT execute. Repere ce qui est faux (avec justification).",
  workspace_instruction_ai_critique: "Critique les affirmations ci-dessous : repere les biais / defauts.",
  workspace_instruction_explain_back: "Explique le concept avec tes propres mots.",
  workspace_instruction_comparison: "Compare A et B et nomme les differences / la valeur ajoutee.",
  workspace_instruction_summary_audit: "Audite le resume IA : quelles omissions ou distorsions ?",
  workspace_instruction_prompt_practice: "Ecris (ou affine) un prompt pour la tache ci-dessous.",
  workspace_instruction_communication_sim: "Redige la communication demandee pour la situation ci-dessous.",
  workspace_instruction_quiz: "Reponds : { \"kind\": \"quiz_choice\", \"choiceId\": \"<id>\" }.",
  workspace_instruction_meta_checkpoint: "Auto-evalue ta confiance : { \"kind\": \"confidence\", \"value\": 0-4 }.",
  workspace_instruction_default: "Lis, puis reponds pour avancer.",

  workspace_task_title: "# Studium — etape {step} : {title}",
  workspace_run_already_recorded: "**Run deja enregistre** (mesure : `{landmark}`). Pas besoin de re-provisionner :",
  workspace_run_already_recorded_action: "reponds `{ \"kind\": \"ack\" }` pour continuer, ou relance et ecris `run_result.json` pour un resultat frais.",
  workspace_scene_type: "**Type de scene :** `{type}`",
  workspace_ai_reading: "## Lecture IA a auditer",
  workspace_source: "**Source :**",
  workspace_ai_summary: "**Resume IA :**",
  workspace_situation: "**Situation :** {text}",
  workspace_task: "**Tache :** {text}",
  workspace_executed_result: "## Resultat reellement execute (verite terrain — audite la lecture IA CONTRE ce resultat)",
  workspace_measure: "- **Mesure (landmark) :** `{text}`",
  workspace_figure: "- **Figure :** `{text}` (rendue nativement par l'hote / le notebook)",
  workspace_command: "- **Commande :** `{text}`",
  workspace_checks_passed: "- **Verifications passees :** {text}",
  workspace_respond_heading: "## Repondre",
  workspace_write_response: "Ecris ta reponse dans `response.json` (ce dossier) :",
  workspace_response_shorthand: "_(ou simplement `{ \"text\": \"...\" }` — Studium deduit le bon type d'entree.)_",

  workspace_verdict_incorrect: "✗ Faux",
  workspace_verdict_correct: "✓ Juste",
  workspace_feedback_next: "✓ Reponse enregistree — passage a l'etape suivante (`task.md` mis a jour).",
  workspace_feedback_replay: "↻ A revoir : {reason}. La prochaine tache revient dessus.",
  workspace_feedback_replay_default: "maitrise insuffisante",
  workspace_feedback_remediate_alt: "↻ Remediation : {reason}. Une variante est proposee.",
  workspace_feedback_remediate: "↻ Prerequis non maitrise : {reason}. Detour par une scene du prerequis{returns_to}.",
  workspace_feedback_returns_to: " ; retour ensuite a `{scene}`",
  workspace_feedback_calibration: "⚖️ Point de calibration : compare ta confiance a ta maitrise reelle.",
  workspace_feedback_complete: "✔ Lecon terminee — {count} scenes.",

  workspace_run_task_title: "# Studium — etape {step} : {title} (reproduction)",
  workspace_run_scene_type: "**Type de scene :** `reproduction` — execution PAR L'APPRENANT (l'hote provisionne, tu lances).",
  workspace_run_heading: "## Provisionne et lance (dans CET espace de travail)",
  workspace_question: "**Question :** {text}",
  workspace_capsule: "- **Capsule :** `{text}`",
  workspace_install: "- **Installe :** {text}",
  workspace_launch: "- **Lance :** `{command}`{working_dir}",
  workspace_working_dir: " (dans `{text}`)",
  workspace_expected_outputs: "- **Sorties attendues :** {text}",
  workspace_verify: "- **Verifie :**",
  workspace_run_report_heading: "## Rends compte du run",
  workspace_run_report_instruction: "Quand le run a produit les sorties, ecris `run_result.json` (ce dossier) :",
  workspace_run_landmark_example: "<la mesure que TON run a produite, depuis stdout>",
  workspace_run_attestation: "_(Studium ne lance rien : c'est TON run reel dans l'espace de travail qui fait foi.)_",
  workspace_run_measure: " (mesure : `{text}`)",
  workspace_run_complete: "✔ Run ingere{measure} — lecon terminee ({count} scenes).",
  workspace_run_next: "✓ Run ingere{measure} — tu as reproduit le resultat toi-meme. Etape suivante (`task.md` mis a jour).",
} as const;

export type PhraseKey = keyof typeof FR;

const EN: Record<PhraseKey, string> = {
  planted_flaws_found: "{found}/{total} planted flaws found",
  key_points_covered: "{covered}/{total} key points covered",
  claims_addressed: "{covered}/{total} claims addressed",
  deck_detail: "{caught}/{planted} planted flaws found; {false_positives}/{sound_total} false positives",

  explanation_graph_universe_escalated: "repeated remediation — escalated to the remedial universe",
  explanation_replay_budget_exhausted: "reviewed several times without success — moving on",
  explanation_graph_prereq_gate: "prerequisite not yet mastered — routed to remediation",
  explanation_graph_prereq_gate_passed: "prerequisite item answered correctly, mastery still below threshold — advancing",
  explanation_graph_prereq_gate_released: "prerequisite still unmastered after repeated remediation — advancing anyway",
  explanation_graph_prereq_unassessable: "prerequisite unmet and no scene can assess it — advancing anyway",
  explanation_graph_skip_mastered: "concept already mastered — skipped",

  tutor_justification: "What is the weakest link in your reasoning? What would be the strongest counterargument?",
  tutor_hypothesis: "What would you observe if it were true? How could you verify it yourself?",
  tutor_question: "Good question — what do you already know that could point you toward the answer?",
  tutor_counterexample: "Your counterexample holds. In which cases would the original claim still be true?",
  tutor_synthesis: "State it as a single rule, then name one case it does not cover.",
  tutor_scaffold_hint: "One step at a time: what do you already know that could help you, without being given the answer?",

  calibration_well: "Your confidence was well calibrated: how you felt matched your actual command of the concept.",
  calibration_over: "You were slightly overconfident: you felt more certain than your answers showed. Check this concept before moving on.",
  calibration_under: "You were slightly underconfident: you understand this concept better than you think. Trust yourself.",

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
  workspace_instruction_quiz: "Respond with: { \"kind\": \"quiz_choice\", \"choiceId\": \"<id>\" }.",
  workspace_instruction_meta_checkpoint: "Rate your confidence: { \"kind\": \"confidence\", \"value\": 0-4 }.",
  workspace_instruction_default: "Read, then respond to continue.",

  workspace_task_title: "# Studium — step {step}: {title}",
  workspace_run_already_recorded: "**Run already recorded** (measurement: `{landmark}`). You do not need to provision it again:",
  workspace_run_already_recorded_action: "respond with `{ \"kind\": \"ack\" }` to continue, or rerun it and write `run_result.json` for a fresh result.",
  workspace_scene_type: "**Scene type:** `{type}`",
  workspace_ai_reading: "## AI reading to audit",
  workspace_source: "**Source:**",
  workspace_ai_summary: "**AI summary:**",
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
  workspace_feedback_replay: "↻ Review needed: {reason}. The next task returns to it.",
  workspace_feedback_replay_default: "insufficient command",
  workspace_feedback_remediate_alt: "↻ Remediation: {reason}. An alternative is proposed.",
  workspace_feedback_remediate: "↻ Prerequisite not mastered: {reason}. Detouring through a prerequisite scene{returns_to}.",
  workspace_feedback_returns_to: "; then returning to `{scene}`",
  workspace_feedback_calibration: "⚖️ Calibration checkpoint: compare your confidence with your actual command of the concept.",
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

const CATALOGUES: Record<Locale, Record<PhraseKey, string>> = { fr: FR, en: EN };

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
