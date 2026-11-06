// packages/lesson-session-host/src/chat-display.ts
//
// `display_markdown` (HJ-4, R3): every presentation and transition the host serves carries a
// localized Markdown block a chat client can show as is — the scene's title and progress, its
// learner-facing text, how to reply, the authoring notice on the first screen, and after an answer
// the feedback, the cited sources, a self-rating request and where the lesson goes next, in words.
//
// After an answer the text comes in two parts, shown in this order:
//   verdict.display_markdown  what the learner earned by answering: the verdict, the feedback, the
//                             reference the answer is compared against (the correct choice, key
//                             points, planted flaws or flawed claims, and its model answer: lead
//                             decision I-1, integration tail T3), the cited passages and the
//                             self-rating request (verdictMarkdown);
//   display_markdown          where the lesson goes next, in words, then the next scene or the end
//                             of the lesson (transitionMarkdown).
// Outside `verdict`, a transition is the public projection of the next scene. Reading scenes carry
// their sources there; passages that reveal a graded answer remain withheld until it is released.
//
// Two rules hold by construction:
//   - the scene is read through `publicScene`, so no answer key can reach the text before the answer;
//   - no mastery number, rule id, modulator or internal reason code is ever printed.
// This module is the canonical learner-facing chat rendering. Clients, including the VS Code chat,
// stream its `display_markdown`; their local formatters are compatibility fallbacks for older hosts.
import type { CompletionSummary, Presentation, Transition } from "@studium/lesson-session";
import { sceneRenderAssets, type Scene } from "@studium/lesson-bundle-schema";
import {
  publicScene, citedSources, type CitedSource, type PublicPresentation,
  type PublicTransition,
} from "./public-scene.js";
import { FREE_TEXT_KIND } from "./operator-context.js";
import { frenchSpacing } from "../../lesson-session/src/phrases.js";
import { MIN_MASTERY_ATTEMPTS } from "../../lesson-session/src/graph-nav.js";
import { REVIEW_MIN_MASTERY } from "./study-plan.js";

export type DisplayLocale = "fr" | "en";

export interface DisplayAuthoring {
  drafted_by?: "agent" | "learner" | "teacher";
  approval?: { recorded: boolean; matches: boolean };
}

export type DisplayPresentation = PublicPresentation & {
  authoring?: NonNullable<Presentation["authoring"]> & DisplayAuthoring;
};

/** What the host knows beyond the transport objects. */
export interface DisplayContext {
  /** Kept for source compatibility; navigation deliberately ignores scene ids and titles. */
  sceneTitle?: (sceneId: string) => string | undefined;
  conceptLabel?: (conceptId: string) => string;
  /** Locale of a `complete` transition, which carries no presentation. */
  locale?: DisplayLocale;
  /** A review session numbers its items « Révision n sur N ». */
  review?: boolean;
  /** The time zone review dates are printed in (calendar.ts): the host's, the one its JSON dates use. */
  timeZone?: string;
  /** Needed on a complete transition, which carries no presentation, for keyed-verdict provenance. */
  authoring?: DisplayAuthoring;
}

export interface CompletionSplit {
  consolidated: string[];
  practised: Array<{ concept_id: string; answers: number }>;
  not_measured: string[];
}

/** Host additions to a served transition (see host.ts servedTransition). */
export interface TransitionExtras {
  self_rating?: { requested: true; scene_id?: string; grades: readonly string[] };
  review_plan?: { next_due_at: number | null; concepts: readonly string[] };
  /** L-11: the learner's progress could not be saved; the transition says so first. */
  persistence_warning?: string;
  /** L-6: the host-computed completion categories consumed by every client. */
  completion?: CompletionSplit;
  /** The learner's concept map at a moment worth showing it (concept-map.ts): the whole map, or the
   * position line alone when a new concept opens. */
  concept_map?: { show: "map" | "line"; display_markdown: string; position_line: string };
}

const PHRASES = {
  fr: {
    progress: "Étape {n} sur {total}",
    review_progress: "Révision {n} sur {total}",
    not_durable: "Attention : ta progression n'est gardée qu'en mémoire et sera perdue au redémarrage du serveur.",
    not_saved: "Attention : ta progression n'a pas pu être enregistrée ; cette séance continue.",
    stale_approval: "Attention : cette leçon a été modifiée depuis son approbation par l'enseignant.",
    ai_reading: "**Lecture IA à auditer** : juge chaque affirmation.",
    ai_summary: "**Résumé IA à auditer**",
    source: "**Source**",
    situation: "**Situation**",
    task: "**Tâche**",
    protocol: "**Protocole**",
    discussion: "**Discussion : {topic}**",
    hint_available: "_Besoin d'aide ? Un indice est disponible : demande-le._",
    run_recorded: "Ta reproduction est déjà enregistrée : tu peux continuer sans la relancer.",
    reply_quiz: "_Réponds avec la lettre de ton choix : {ids}._",
    reply_meta: "_Réponds avec un chiffre de 0 à 4 ({scale})._",
    reply_deck: "_Réponds avec les numéros des affirmations que tu juges fausses (par exemple « 1, 3 ») ; aucun numéro si toutes te semblent justes._",
    reply_run: "_Cette étape demande d'exécuter la reproduction toi-même : l'assistant lit le manifeste, lance la commande avec toi, puis transmet le résultat._",
    reply_discussion: "_Argumente avec tes propres mots ; dis « continuer » pour passer à la suite._",
    reply_text: "_Réponds avec tes propres mots : l'assistant n'écrit pas la réponse à ta place._",
    reply_continue: "_Dis « continuer » quand tu es prêt·e._",
    verdict_correct: "✓ **Juste.**",
    verdict_incorrect: "✗ **Pas tout à fait.**",
    verdict_recorded: "**Réponse enregistrée.** Aucun juge ne l'a évaluée.",
    verdict_key_recorded: "**Réponse comparée à la clé.** Aucun résultat global n'est affirmé.",
    verdict_judge_measured: "**Mesure enregistrée.** Le juge a mesuré les éléments cités, sans certifier de résultat global.",
    verdict_confidence: "**Confiance enregistrée.**",
    source_heading: "**Source**",
    sources_heading: "**Sources**",
    reference_key_points: "**Compare ta réponse à ces points clés :**",
    reference_planted_flaws: "**Compare ton audit aux défauts plantés :**",
    reference_flawed_claims: "**Compare ta critique aux affirmations qui cachaient un défaut :**",
    reference_correct_choice: "**La bonne réponse :**",
    model_answer: "**Réponse modèle**",
    key_point_missing: "_(manquant selon le juge)_",
    model_correction: "**Correction modèle**",
    self_rating: "Compare ta réponse à la référence ci-dessus, puis note ton rappel : **je ne savais pas** (`again`), **difficile** (`hard`), **bien** (`good`) ou **facile** (`easy`). Cette note fixe la date de ta prochaine révision ; elle ne change jamais ta maîtrise.",
    ai_key_provenance: "Selon la clé rédigée par l'IA — voir le passage cité.",
    recall_rated: "Note enregistrée. Prochaine révision : {date}. Elle règle tes révisions, jamais ta maîtrise.",
    nav_replay: "On reprend cette question.",
    nav_remediate_alt: "Voici une autre question sur le même point.",
    nav_remediate: "On revoit d'abord une notion nécessaire.",
    nav_continue: "On poursuit la leçon.",
    nav_unmeasured: "Cette notion n'a pas pu être mesurée ici ; on poursuit la leçon.",
    nav_skip: "On passe à la suite.",
    nav_calibration: "On fait maintenant un point de confiance.",
    complete: "**Leçon terminée.**",
    review_complete: "**Révision terminée.**",
    consolidated_one: "Notion consolidée : {list}.",
    consolidated_many: "Notions consolidées : {list}.",
    practised_one: "{concept} — Travaillée ({answers} réponse)",
    practised_many: "{concept} — Travaillée ({answers} réponses)",
    not_measured: "{concept} — Pas encore mesurée",
    next_review: "Prochaine révision : {date}.",
    no_review: "Aucune révision n'est encore planifiée.",
    nothing_due: "Rien à réviser pour l'instant. Prochaine révision : {date}.",
    nothing_scheduled: "Rien à réviser pour l'instant : aucune révision n'est encore planifiée. Une leçon terminée en programme.",
    nothing_playable_one: "Rien à réviser pour l'instant : la notion {list} est à revoir, mais aucune question de tes leçons ne la reprend.",
    nothing_playable_many: "Rien à réviser pour l'instant : les notions {list} sont à revoir, mais aucune question de tes leçons ne les reprend.",
    nothing_playable_next: "Prochaine révision : {date}.",
    lessons_heading: "### Leçons disponibles",
    lessons_none: "Aucune leçon n'est encore disponible.",
    lessons_no_match: "Aucune leçon ne correspond à « {query} ».",
    lesson_line: "- « {title} » — {details}",
    lesson_steps_one: "1 étape",
    lesson_steps_many: "{count} étapes",
    lesson_agent: "rédigée par l'IA",
    lesson_learner: "écrite par toi",
    lesson_new: "pas encore commencée",
    lesson_in_progress: "en cours : {done} sur {total}",
    lesson_completed: "terminée",
    forget_done: "**Tes données sont effacées.**",
    forget_nothing: "Rien à effacer : aucune donnée n'est enregistrée pour toi ici.",
    forget_erased: "Effacé : {items}.",
    forget_kept: "Conservé : {items}.",
    forget_lesson_progress: "ta progression dans {lessons} (réponses, état de la leçon, journal d'expériences)",
    forget_learner_profile: "ton profil d'apprentissage, commun à toutes tes leçons",
    forget_study_record: "ton calendrier de révisions",
    forget_other_lessons: "ta progression dans {lessons} : demande à effacer toutes tes données pour l'effacer aussi",
    forget_library: "les leçons de ta bibliothèque ({lessons}), dans {path}",
    forget_library_unnamed: "les leçons de ta bibliothèque, dans {path}",
    forget_sources: "le texte des sources préparées pour elles, dans {path}",
    forget_exports: "les cartes de notions que tu as exportées, dans {path}",
    map_export_saved: "Carte des notions exportée dans `{path}`. Elle contient tes résultats de séance, sans identifiant ni texte de réponse, et reste sur cette machine tant que tu ne la partages pas.",
    map_export_unsaved: "Carte des notions exportée (champ `record`). Ce serveur n'a pas de bibliothèque où l'écrire : enregistre `record` tel quel dans un fichier pour en faire une page.",
    forget_delete_yourself: "Supprime ces dossiers toi-même si tu veux qu'ils disparaissent aussi.",
    list_and: " et ",
  },
  en: {
    progress: "Step {n} of {total}",
    review_progress: "Review {n} of {total}",
    not_durable: "Note: your progress is kept in memory only and will be lost when the server restarts.",
    not_saved: "Note: your progress could not be saved; this session goes on.",
    stale_approval: "Note: this lesson changed after the teacher approved it.",
    ai_reading: "**AI reading to audit**: judge each claim.",
    ai_summary: "**AI summary to audit**",
    source: "**Source**",
    situation: "**Situation**",
    task: "**Task**",
    protocol: "**Protocol**",
    discussion: "**Discussion: {topic}**",
    hint_available: "_Need help? A hint is available: ask for it._",
    run_recorded: "Your reproduction is already recorded: you can continue without running it again.",
    reply_quiz: "_Answer with the letter of your choice: {ids}._",
    reply_meta: "_Answer with a number from 0 to 4 ({scale})._",
    reply_deck: "_Answer with the numbers of the claims you judge wrong (for example “1, 3”); no number if all seem right._",
    reply_run: "_This step asks you to run the reproduction yourself: the assistant reads the manifest, runs the command with you, then reports the result._",
    reply_discussion: "_Make your case in your own words; say “continue” to move on._",
    reply_text: "_Answer in your own words: the assistant does not write the answer for you._",
    reply_continue: "_Say “continue” when you are ready._",
    verdict_correct: "✓ **Right.**",
    verdict_incorrect: "✗ **Not quite.**",
    verdict_recorded: "**Answer recorded.** No judge assessed it.",
    verdict_key_recorded: "**Answer checked against the key.** No overall result is claimed.",
    verdict_judge_measured: "**Evidence measured.** The judge measured the evidence cited above but did not certify an overall pass.",
    verdict_confidence: "**Confidence recorded.**",
    source_heading: "**Source**",
    sources_heading: "**Sources**",
    reference_key_points: "**Compare your answer with these key points:**",
    reference_planted_flaws: "**Compare your audit with the planted flaws:**",
    reference_flawed_claims: "**Compare your critique with the claims that hid a flaw:**",
    reference_correct_choice: "**The right answer:**",
    model_answer: "**Model answer**",
    key_point_missing: "_(missing, per the judge)_",
    model_correction: "**Model correction**",
    self_rating: "Compare your answer with the reference above, then rate your recall: **again**, **hard**, **good** or **easy**. This rating sets the date of your next review; it never changes your mastery.",
    ai_key_provenance: "Per the AI-drafted key — see the cited passage.",
    recall_rated: "Rating recorded. Next review: {date}. It schedules your reviews and never changes your mastery.",
    nav_replay: "Let's take this question again.",
    nav_remediate_alt: "Here is another question on the same point.",
    nav_remediate: "First, we revisit a concept this lesson needs.",
    nav_continue: "We continue the lesson.",
    nav_unmeasured: "This concept could not be measured here; we continue the lesson.",
    nav_skip: "We move on.",
    nav_calibration: "Now we check your confidence.",
    complete: "**Lesson complete.**",
    review_complete: "**Review complete.**",
    consolidated_one: "Consolidated: {list}.",
    consolidated_many: "Consolidated: {list}.",
    practised_one: "{concept} — Practised ({answers} answer)",
    practised_many: "{concept} — Practised ({answers} answers)",
    not_measured: "{concept} — Not measured yet",
    next_review: "Next review: {date}.",
    no_review: "No review is scheduled yet.",
    nothing_due: "Nothing to review right now. Next review: {date}.",
    nothing_scheduled: "Nothing to review right now: no review is scheduled yet. Finishing a lesson schedules some.",
    nothing_playable_one: "Nothing to review right now: {list} is due again, but no question in your lessons covers it.",
    nothing_playable_many: "Nothing to review right now: {list} are due again, but no question in your lessons covers them.",
    nothing_playable_next: "Next review: {date}.",
    lessons_heading: "### Lessons available",
    lessons_none: "No lesson is available yet.",
    lessons_no_match: "No lesson matches “{query}”.",
    lesson_line: "- “{title}” — {details}",
    lesson_steps_one: "1 step",
    lesson_steps_many: "{count} steps",
    lesson_agent: "AI-drafted",
    lesson_learner: "written by you",
    lesson_new: "not started yet",
    lesson_in_progress: "in progress: {done} of {total}",
    lesson_completed: "completed",
    forget_done: "**Your data is erased.**",
    forget_nothing: "Nothing to erase: no data is recorded for you here.",
    forget_erased: "Erased: {items}.",
    forget_kept: "Kept: {items}.",
    forget_lesson_progress: "your progress in {lessons} (answers, lesson state, experiment journal)",
    forget_learner_profile: "your learning profile, shared by all your lessons",
    forget_study_record: "your review schedule",
    forget_other_lessons: "your progress in {lessons}: ask to erase all your data to erase it too",
    forget_library: "the lessons in your library ({lessons}), in {path}",
    forget_library_unnamed: "the lessons in your library, in {path}",
    forget_sources: "the text of the sources prepared for them, in {path}",
    forget_exports: "the concept maps you exported, in {path}",
    map_export_saved: "Concept map exported to `{path}`. It holds your session results, with no identifier and none of your answers' text, and stays on this machine until you share it.",
    map_export_unsaved: "Concept map exported (field `record`). This server has no library to write it to: save `record` unchanged to a file to make a page from it.",
    forget_delete_yourself: "Delete those folders yourself if you want them gone too.",
    list_and: " and ",
  },
} as const;

type PhraseKey = keyof typeof PHRASES.fr;

function say(locale: DisplayLocale, key: PhraseKey, params: Record<string, string | number> = {}): string {
  const filled = PHRASES[locale][key].replace(/\{([a-z_]+)\}/g, (token, name: string) =>
    params[name] === undefined ? token : String(params[name]));
  return locale === "fr" ? frenchSpacing(filled) : filled;
}

/** A plain, localized date for a review (« jeudi 6 novembre 2026 »), in `timeZone` — the host's, the
 * one its yyyy-mm-dd dates are taken in (calendar.ts) — or the machine's when none is given. */
export function formatReviewDate(epochMs: number, locale: DisplayLocale, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "full", ...(timeZone ? { timeZone } : {}) })
    .format(epochMs);
}

type PublicSceneFields = Record<string, unknown> & { type?: string; title?: string };
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function sceneBody(scene: PublicSceneFields, locale: DisplayLocale): string[] {
  const t = scene.type;
  if (t === "quiz") {
    const choices = (scene["choices"] as Array<{ id: string; text: string }> | undefined) ?? [];
    return [str(scene["question"]), choices.map((c) => `- **${c.id})** ${c.text}`).join("\n")];
  }
  if (t === "meta_checkpoint") return [str(scene["pre_question"])];
  if (t === "spot_the_flaw") {
    const deck = (scene["deck"] as Array<{ text: string }> | undefined) ?? [];
    return [say(locale, "ai_reading"), str(scene["flawed_content"]), deck.map((d, i) => `${i + 1}. ${d.text}`).join("\n")];
  }
  if (t === "comparison") {
    return [str(scene["prompt"]), scene["artifact_a"] ? `**A**\n\n${str(scene["artifact_a"])}` : "",
      scene["artifact_b"] ? `**B**\n\n${str(scene["artifact_b"])}` : ""];
  }
  if (t === "summary_audit") {
    return [scene["source_content"] ? `${say(locale, "source")}\n\n${str(scene["source_content"])}` : "",
      scene["ai_summary"] ? `${say(locale, "ai_summary")}\n\n${str(scene["ai_summary"])}` : ""];
  }
  if (t === "communication_sim") {
    return [scene["scenario"] ? `${say(locale, "situation")}\n\n${str(scene["scenario"])}` : "", str(scene["prompt"])];
  }
  if (t === "prompt_practice") {
    return [scene["task"] ? `${say(locale, "task")}\n\n${str(scene["task"])}` : "",
      scene["starter_prompt"] ? "```\n" + str(scene["starter_prompt"]) + "\n```" : ""];
  }
  if (t === "reproduction") {
    const steps = (scene["steps"] as Array<{ instruction: string }> | undefined) ?? [];
    return [str(scene["markdown"]), steps.length ? `${say(locale, "protocol")}\n\n${steps.map((s, i) => `${i + 1}. ${s.instruction}`).join("\n")}` : "",
      scene["learner_run_recorded"] ? say(locale, "run_recorded") : ""];
  }
  if (t === "discussion") {
    return [scene["topic"] ? say(locale, "discussion", { topic: str(scene["topic"]) }) : "", str(scene["seed_claim"])];
  }
  return [str(scene["prompt"]) || str(scene["markdown"])]; // intro / concept / explain_back
}

function equationBlocks(scene: PublicSceneFields, locale: DisplayLocale): string[] {
  return sceneRenderAssets(scene as Scene).flatMap((asset) => {
    if (asset.kind !== "equation_latex" || typeof asset.payload !== "string" || !asset.payload.trim()) return [];
    const title = typeof asset.title === "string" && asset.title.trim()
      ? asset.title.trim()
      : locale === "fr" ? "Équation" : "Equation";
    const legend = (asset.legend ?? []).map(({ symbol, meaning }) => `- ${symbol} : ${meaning}`).join("\n");
    return [`**${title}**\n\n$$\n${asset.payload}\n$$${legend ? `\n\n${legend}` : ""}`];
  });
}

function replyHint(scene: PublicSceneFields, locale: DisplayLocale): string {
  const t = scene.type ?? "";
  if (t === "quiz") {
    const ids = ((scene["choices"] as Array<{ id: string }> | undefined) ?? []).map((c) => c.id);
    return say(locale, "reply_quiz", { ids: ids.join(", ") });
  }
  if (t === "meta_checkpoint") {
    const labels = (scene["scale_labels"] as string[] | undefined) ?? [];
    const scale = labels.length === 5 ? `0 = ${labels[0]}, 4 = ${labels[4]}` : "0–4";
    return say(locale, "reply_meta", { scale });
  }
  if (t === "spot_the_flaw" && Array.isArray(scene["deck"]) && scene["deck"].length) return say(locale, "reply_deck");
  if (t === "reproduction" && scene["run_manifest"] && !scene["learner_run_recorded"]) return say(locale, "reply_run");
  if (t === "discussion") return say(locale, "reply_discussion");
  if (FREE_TEXT_KIND[t]) return say(locale, "reply_text");
  return say(locale, "reply_continue");
}

/** The learner-facing block for one presentation. `firstScreen` adds the authoring notice (and, when
 * nothing is durable, a one-line warning) — the start of a lesson or a review session. */
export function presentationMarkdown(
  p: DisplayPresentation,
  opts: { firstScreen?: boolean; notDurable?: boolean; review?: boolean; conceptMap?: string } = {},
): string {
  const locale: DisplayLocale = p.locale === "en" ? "en" : "fr";
  const scene = publicScene(p.scene as Scene) as PublicSceneFields;
  const authoring = p.authoring as DisplayAuthoring | undefined;
  const blocks: string[] = [];
  if (opts.firstScreen && p.authoring?.notice) blocks.push(`> ${p.authoring.notice}`);
  const approvalNotice = opts.firstScreen ? approvalNoticeMarkdown(authoring, locale) : "";
  if (approvalNotice) blocks.push(`> ${approvalNotice}`);
  if (opts.firstScreen && opts.notDurable) blocks.push(`> ${say(locale, "not_durable")}`);
  // The lesson's plan before its first scene: every concept and how they depend on each other.
  if (opts.firstScreen && opts.conceptMap) blocks.push(opts.conceptMap, "---");
  blocks.push(`### ${scene.title || scene.type || ""}`);
  blocks.push(`_${say(locale, opts.review ? "review_progress" : "progress", { n: p.index + 1, total: p.total })}_`);
  blocks.push(...sceneBody(scene, locale));
  blocks.push(...equationBlocks(scene, locale));
  const readingSources = sourcesMarkdown(citedSources(scene as unknown as Scene), locale);
  if (readingSources) blocks.push(readingSources);
  if ((p.hints_available ?? 0) > 0) blocks.push(say(locale, "hint_available"));
  blocks.push(replyHint(scene, locale));
  return blocks.filter((b) => b.trim() !== "").join("\n\n");
}

/** The same first-screen warning on chat and file surfaces when the approved bytes have changed. */
export function approvalNoticeMarkdown(authoring: DisplayAuthoring | undefined, locale: DisplayLocale): string {
  return authoring?.approval?.recorded && !authoring.approval.matches ? say(locale, "stale_approval") : "";
}

function verdictLine(t: PublicTransition, locale: DisplayLocale): string {
  const v = t.verdict;
  if (!v) return "";
  if (v.signal === "confidence_declared") return say(locale, "verdict_confidence");
  if (!v.graded) return "";
  if (v.correct === true) return say(locale, "verdict_correct");
  if (v.correct === false) return say(locale, "verdict_incorrect");
  if (v.assessed_by === "judge") return say(locale, "verdict_judge_measured");
  if (v.assessed_by === "key") return say(locale, "verdict_key_recorded");
  return say(locale, "verdict_recorded");
}

/** Where the lesson goes next, in words derived only from the public navigation kind. Engine reasons
 * and explanations may refer to another answer and may contain rule, item or threshold vocabulary. */
function navigationLine(t: PublicTransition, locale: DisplayLocale): string {
  const nav = t.navigation;
  if (!nav || nav.kind === "advance" || nav.kind === "complete") return "";
  if (nav.kind === "replay") return say(locale, "nav_replay");
  if (nav.kind === "remediate_alt") return say(locale, "nav_remediate_alt");
  if (nav.kind === "remediate") return say(locale, "nav_remediate");
  if (nav.kind === "gate_unassessable") return say(locale, "nav_unmeasured");
  if (nav.kind === "calibration") return say(locale, "nav_calibration");
  if (nav.kind === "skip_mastered" || nav.kind === "skip_concept") return say(locale, "nav_skip");
  return say(locale, "nav_continue");
}

/** I-1: the reference a key-point, audit or critique verdict carries — its key points (an audit's
 * planted flaws, a critique's claims that hid a flaw: T3) as a list, each point a judge found missing
 * marked once in that list, then its model answer (an audit's model correction; a critique has none) —
 * under their own headings. Empty for a verdict without one. */
export function referenceMarkdown(
  verdict: Pick<NonNullable<Transition["verdict"]>, "key_points" | "key_points_missing" | "model_answer" | "reference_kind"> | undefined,
  locale: DisplayLocale,
): string {
  if (!verdict) return "";
  const audit = verdict.reference_kind === "planted_flaws";
  const heading = audit ? "reference_planted_flaws"
    : verdict.reference_kind === "flawed_claims" ? "reference_flawed_claims"
      : verdict.reference_kind === "correct_choice" ? "reference_correct_choice" : "reference_key_points";
  const blocks: string[] = [];
  const points = (verdict.key_points ?? []).filter((point) => point.trim() !== "");
  const missing = new Set(verdict.key_points_missing ?? []);
  if (points.length) {
    blocks.push(say(locale, heading), points
      .map((point) => `- ${point}${missing.has(point) ? ` ${say(locale, "key_point_missing")}` : ""}`).join("\n"));
  }
  if (verdict.model_answer?.trim()) blocks.push(say(locale, audit ? "model_correction" : "model_answer"), verdict.model_answer);
  return blocks.join("\n\n");
}

/** The passages an answered scene cites, quoted with their source (empty when there are none). */
export function sourcesMarkdown(sources: readonly CitedSource[], locale: DisplayLocale): string {
  const lines = sources.map((s) => {
    const quote = s.quote
      ? `${locale === "fr" ? `« ${s.quote} »` : `“${s.quote}”`} — `
      : "";
    const source = `${s.title}${s.url ? ` (${s.url})` : ""}${s.license ? `, ${s.license}` : ""}`;
    return `> ${quote}${source}`;
  });
  if (!lines.length) return "";
  const rendered = `${say(locale, lines.length > 1 ? "sources_heading" : "source_heading")}\n\n${lines.join("\n>\n")}`;
  return locale === "fr" ? frenchSpacing(rendered) : rendered;
}

export type CompletionInput = Pick<CompletionSummary, "finalState"> & {
  mastery: Record<string, number | null>;
};

/** L-6's one completion rule, shared by host rendering and the public completion payload. */
export function completionSplit(summary: CompletionInput): CompletionSplit {
  const states = summary.finalState?.concept_states ?? {};
  const ids = Object.keys(summary.mastery);
  const split: CompletionSplit = { consolidated: [], practised: [], not_measured: [] };
  for (const conceptId of ids) {
    const answers = states[conceptId]?.total_attempts ?? 0;
    const mastery = summary.mastery[conceptId];
    if (answers <= 0 || typeof mastery !== "number") split.not_measured.push(conceptId);
    else if (answers >= MIN_MASTERY_ATTEMPTS && mastery >= REVIEW_MIN_MASTERY) {
      split.consolidated.push(conceptId);
    } else split.practised.push({ concept_id: conceptId, answers });
  }
  return split;
}

/** Only the measured/practised/unmeasured groups, reusable after the final file-channel rating. */
export function completionGroupsMarkdown(
  split: CompletionSplit, locale: DisplayLocale, label: (id: string) => string = (id) => id,
): string {
  const consolidated = split.consolidated.map(label);
  const practised = split.practised.map(({ concept_id, answers }) => say(locale,
    answers === 1 ? "practised_one" : "practised_many", { concept: label(concept_id), answers }));
  const notMeasured = split.not_measured.map((id) => say(locale, "not_measured", { concept: label(id) }));
  return [
    consolidated.length ? say(locale, consolidated.length === 1 ? "consolidated_one" : "consolidated_many",
      { list: consolidated.join(", ") }) : "",
    ...practised,
    ...notMeasured,
  ].filter(Boolean).join("\n\n");
}

function completionBlock(t: PublicTransition & TransitionExtras, locale: DisplayLocale, ctx: DisplayContext): string[] {
  if (t.kind !== "complete") return [];
  const split = t.completion ?? completionSplit(t.summary);
  const next = t.review_plan?.next_due_at;
  return [
    say(locale, ctx.review ? "review_complete" : "complete"),
    completionGroupsMarkdown(split, locale, ctx.conceptLabel),
    next != null ? say(locale, "next_review", { date: formatReviewDate(next, locale, ctx.timeZone) }) : say(locale, "no_review"),
  ];
}

function localeOf(t: PublicTransition, ctx: DisplayContext): DisplayLocale {
  return "presentation" in t ? (t.presentation.locale === "en" ? "en" : "fr") : ctx.locale ?? "fr";
}

/** What the learner earned by answering, carried as `verdict.display_markdown`: the verdict and the
 * feedback, the reference to compare with (I-1), the passages the scene cites, and a self-rating
 * request when no judge certified the answer. Empty for an acknowledged scene that carries none. */
export function verdictMarkdown(
  t: PublicTransition & TransitionExtras, sources: readonly CitedSource[], ctx: DisplayContext = {},
): string {
  const locale = localeOf(t, ctx);
  const presentationAuthoring = "presentation" in t
    ? (t.presentation.authoring as DisplayAuthoring | undefined)
    : undefined;
  const keyedByAgent = t.verdict?.assessed_by === "key"
    && (presentationAuthoring?.drafted_by ?? ctx.authoring?.drafted_by) === "agent";
  return [
    verdictLine(t, locale),
    keyedByAgent ? say(locale, "ai_key_provenance") : "",
    t.verdict?.feedback ?? "",
    referenceMarkdown(t.verdict, locale),
    sourcesMarkdown(sources, locale),
    t.self_rating?.requested ? say(locale, "self_rating") : "",
  ].filter((b) => b.trim() !== "").join("\n\n");
}

/** The public part after an answer, carried as `display_markdown`: where the lesson goes, in words,
 * then the next scene — or, at the end, what is consolidated, what to review and when. */
export function transitionMarkdown(t: PublicTransition & TransitionExtras, ctx: DisplayContext = {}): string {
  const locale = localeOf(t, ctx);
  const head = [
    t.persistence_warning ? `> ${say(locale, "not_saved")}` : "",
    navigationLine(t, locale), ...completionBlock(t, locale, ctx),
    t.concept_map ? (t.concept_map.show === "map" ? t.concept_map.display_markdown : t.concept_map.position_line) : "",
  ].filter((b) => b.trim() !== "").join("\n\n");
  if (!("presentation" in t)) return head;
  const next = presentationMarkdown(t.presentation, { review: ctx.review ?? false });
  return head ? `${head}\n\n---\n\n${next}` : next;
}

/** The line rate_recall answers with: the next review date, and that mastery did not move — and, when
 * the rating could not be saved (L-11), that it counts for this session only. */
export function recallRatedMarkdown(nextReviewAt: number, locale: DisplayLocale, timeZone?: string, notSaved = false): string {
  const line = say(locale, "recall_rated", { date: formatReviewDate(nextReviewAt, locale, timeZone) });
  return notSaved ? `${line}\n\n> ${say(locale, "not_saved")}` : line;
}

/** Titles quoted and joined the way the locale writes a list: « A », « B » et « C ». */
function quotedList(titles: readonly string[], locale: DisplayLocale): string {
  const quoted = titles.map((title) => (locale === "fr" ? `« ${title} »` : `“${title}”`));
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(", ")}${say(locale, "list_and")}${quoted.at(-1)}` : quoted[0] ?? "";
}

/** What start_review_session answers when nothing is due: when the next review falls, if any — and,
 * when concepts are due that no lesson on disk can review any more (H2), which ones, by name, rather
 * than « no review is scheduled ». */
export function nothingToReviewMarkdown(
  nextReviewAt: number | null, locale: DisplayLocale, timeZone?: string, unplayable: readonly string[] = [],
): string {
  if (unplayable.length) {
    const key = unplayable.length > 1 ? "nothing_playable_many" : "nothing_playable_one";
    const due = say(locale, key, { list: quotedList(unplayable, locale) });
    return nextReviewAt === null ? due
      : `${due} ${say(locale, "nothing_playable_next", { date: formatReviewDate(nextReviewAt, locale, timeZone) })}`;
  }
  return nextReviewAt === null
    ? say(locale, "nothing_scheduled")
    : say(locale, "nothing_due", { date: formatReviewDate(nextReviewAt, locale, timeZone) });
}

/** One lesson of list_lessons, as its display line needs it. */
export interface ListedLessonLine {
  title: string;
  scene_count: number;
  drafted_by: "agent" | "learner" | "teacher";
  status?: { state: "new" | "in_progress" | "completed"; scenes_completed: number; total_scenes: number };
}

/** list_lessons' display_markdown (L-4): the lessons, how many steps, who wrote them and, with a
 * learner, how far they got — or that there is none (matching `query`). */
export function lessonListMarkdown(lessons: readonly ListedLessonLine[], locale: DisplayLocale, query?: string): string {
  if (!lessons.length) {
    const asked = query?.trim();
    return `${say(locale, "lessons_heading")}\n\n${asked ? say(locale, "lessons_no_match", { query: asked }) : say(locale, "lessons_none")}`;
  }
  const line = (l: ListedLessonLine) => {
    const details = [l.scene_count === 1 ? say(locale, "lesson_steps_one") : say(locale, "lesson_steps_many", { count: l.scene_count })];
    if (l.drafted_by === "agent") details.push(say(locale, "lesson_agent"));
    if (l.drafted_by === "learner") details.push(say(locale, "lesson_learner"));
    if (l.status?.state === "new") details.push(say(locale, "lesson_new"));
    if (l.status?.state === "in_progress") {
      details.push(say(locale, "lesson_in_progress", { done: l.status.scenes_completed, total: l.status.total_scenes }));
    }
    if (l.status?.state === "completed") details.push(say(locale, "lesson_completed"));
    return say(locale, "lesson_line", { title: l.title, details: details.join(", ") });
  };
  return `${say(locale, "lessons_heading")}\n\n${lessons.map(line).join("\n")}`;
}

/** What forget_session erased and kept, as the host reports it (L-13). */
export interface ForgetDisplayItem { kind: string; lessons?: readonly string[]; path?: string }

/** What export_concept_map shows: where the record was written, what it holds and that it stays local. */
export function conceptMapExportMarkdown(path: string | null, locale: DisplayLocale): string {
  return path === null ? say(locale, "map_export_unsaved") : say(locale, "map_export_saved", { path });
}

/** forget_session's display_markdown (L-13, UX-01): what was erased, and what stays and where — the
 * lessons of the library and their sources, which a learner may believe gone with the rest. The
 * install's pseudonym key holds no learner data and is not named. */
export function forgetMarkdown(
  report: { erased: readonly ForgetDisplayItem[]; kept: readonly ForgetDisplayItem[] }, locale: DisplayLocale,
): string {
  if (!report.erased.length) return say(locale, "forget_nothing");
  const lessons = (item: ForgetDisplayItem) => quotedList(item.lessons ?? [], locale);
  const erased = report.erased.flatMap((item) => {
    if (item.kind === "lesson_progress") return item.lessons?.length ? [say(locale, "forget_lesson_progress", { lessons: lessons(item) })] : [];
    if (item.kind === "learner_profile") return [say(locale, "forget_learner_profile")];
    if (item.kind === "study_record") return [say(locale, "forget_study_record")];
    return [];
  });
  const kept = report.kept.flatMap((item) => {
    if (item.kind === "other_lessons_progress") return [say(locale, "forget_other_lessons", { lessons: lessons(item) })];
    if (item.kind === "library_lessons") {
      return [item.lessons?.length ? say(locale, "forget_library", { lessons: lessons(item), path: item.path ?? "" })
        : say(locale, "forget_library_unnamed", { path: item.path ?? "" })];
    }
    if (item.kind === "lesson_sources") return [say(locale, "forget_sources", { path: item.path ?? "" })];
    if (item.kind === "map_exports") return [say(locale, "forget_exports", { path: item.path ?? "" })];
    return [];
  });
  const onDisk = report.kept.some((item) => item.kind === "library_lessons" || item.kind === "lesson_sources"
    || item.kind === "map_exports");
  const separator = locale === "fr" ? " ; " : "; ";
  return [
    say(locale, "forget_done"),
    say(locale, "forget_erased", { items: erased.join(separator) }),
    kept.length ? say(locale, "forget_kept", { items: kept.join(separator) }) : "",
    onDisk ? say(locale, "forget_delete_yourself") : "",
  ].filter(Boolean).join("\n\n");
}
