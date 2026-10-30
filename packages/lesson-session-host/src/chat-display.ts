// packages/lesson-session-host/src/chat-display.ts
//
// `display_markdown` (HJ-4, R3): every presentation and transition the host serves carries a
// localized Markdown block a chat client can show as is — the scene's title and progress, its
// learner-facing text, how to reply, the authoring notice on the first screen, and after an answer
// the feedback, the cited sources, a self-rating request and where the lesson goes next, in words.
//
// After an answer the text comes in two parts, shown in this order:
//   verdict.display_markdown  what the learner earned by answering: the verdict, the feedback, the
//                             reference a key-point, audit or critique scene is compared against (its
//                             key points, planted flaws or flawed claims, and its model answer: lead
//                             decision I-1, integration tail T3), the cited passages and the
//                             self-rating request (verdictMarkdown);
//   display_markdown          where the lesson goes next, in words, then the next scene or the end
//                             of the lesson (transitionMarkdown).
// The split keeps one invariant every transport already checks: outside `verdict`, a transition is
// the public projection of the next scene, so a cited passage or a model answer never sits there.
//
// Two rules hold by construction:
//   - the scene is read through `publicScene`, so no answer key can reach the text before the answer;
//   - no mastery number, rule id, modulator or internal reason code is ever printed.
// The scene-type layout follows apps/studium-vscode/src/chat-format.ts, the @studium participant's
// formatter, so the pane's chat and any MCP harness read the same way.
import type { Presentation, Transition } from "@studium/lesson-session";
import type { Scene } from "@studium/lesson-bundle-schema";
import { publicScene, type CitedSource } from "./public-scene.js";
import { FREE_TEXT_KIND } from "./operator-context.js";

export type DisplayLocale = "fr" | "en";

/** What the host knows beyond the transport objects: titles to name scenes and concepts in words. */
export interface DisplayContext {
  sceneTitle?: (sceneId: string) => string | undefined;
  conceptLabel?: (conceptId: string) => string;
  /** Locale of a `complete` transition, which carries no presentation. */
  locale?: DisplayLocale;
  /** A review session numbers its items « Révision n sur N ». */
  review?: boolean;
}

/** Host additions to a served transition (see host.ts servedTransition). */
export interface TransitionExtras {
  self_rating?: { requested: true; scene_id?: string; grades: readonly string[] };
  review_plan?: { next_due_at: number | null; concepts: readonly string[] };
}

const PHRASES = {
  fr: {
    progress: "Étape {n} sur {total}",
    review_progress: "Révision {n} sur {total}",
    not_durable: "Attention : ta progression n'est gardée qu'en mémoire et sera perdue au redémarrage du serveur.",
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
    verdict_confidence: "**Confiance enregistrée.**",
    source_heading: "**Source**",
    sources_heading: "**Sources**",
    reference_key_points: "**Compare ta réponse à ces points clés :**",
    reference_planted_flaws: "**Compare ton audit aux défauts plantés :**",
    reference_flawed_claims: "**Compare ta critique aux affirmations qui cachaient un défaut :**",
    model_answer: "**Réponse modèle**",
    key_point_missing: "_(manquant selon le juge)_",
    model_correction: "**Correction modèle**",
    self_rating: "Compare ta réponse à la réponse modèle, puis note ton rappel : **again** (à revoir), **hard** (difficile), **good** (bien) ou **easy** (facile). Cette note fixe la date de ta prochaine révision ; elle ne change jamais ta maîtrise.",
    recall_rated: "Note enregistrée. Prochaine révision : {date}. Elle règle tes révisions, jamais ta maîtrise.",
    nav_replay: "On reprend cette question.",
    nav_remediate_alt: "Voici une autre question sur le même point.",
    nav_remediate: "Détour : on consolide d'abord un prérequis.",
    nav_returns_to: "Ensuite, on revient à « {title} ».",
    complete: "**Leçon terminée.**",
    review_complete: "**Révision terminée.**",
    consolidated: "Notions consolidées : {list}.",
    to_review: "À revoir : {list}.",
    next_review: "Prochaine révision : {date}.",
    no_review: "Aucune révision n'est encore planifiée.",
    nothing_due: "Rien à réviser pour l'instant. Prochaine révision : {date}.",
    nothing_scheduled: "Rien à réviser pour l'instant : aucune révision n'est encore planifiée. Une leçon terminée en programme.",
  },
  en: {
    progress: "Step {n} of {total}",
    review_progress: "Review {n} of {total}",
    not_durable: "Note: your progress is kept in memory only and will be lost when the server restarts.",
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
    verdict_confidence: "**Confidence recorded.**",
    source_heading: "**Source**",
    sources_heading: "**Sources**",
    reference_key_points: "**Compare your answer with these key points:**",
    reference_planted_flaws: "**Compare your audit with the planted flaws:**",
    reference_flawed_claims: "**Compare your critique with the claims that hid a flaw:**",
    model_answer: "**Model answer**",
    key_point_missing: "_(missing, per the judge)_",
    model_correction: "**Model correction**",
    self_rating: "Compare your answer with the model answer, then rate your recall: **again**, **hard**, **good** or **easy**. This rating sets the date of your next review; it never changes your mastery.",
    recall_rated: "Rating recorded. Next review: {date}. It schedules your reviews and never changes your mastery.",
    nav_replay: "Let's take this question again.",
    nav_remediate_alt: "Here is another question on the same point.",
    nav_remediate: "Detour: first we consolidate a prerequisite.",
    nav_returns_to: "Then we come back to “{title}”.",
    complete: "**Lesson complete.**",
    review_complete: "**Review complete.**",
    consolidated: "Consolidated: {list}.",
    to_review: "To review: {list}.",
    next_review: "Next review: {date}.",
    no_review: "No review is scheduled yet.",
    nothing_due: "Nothing to review right now. Next review: {date}.",
    nothing_scheduled: "Nothing to review right now: no review is scheduled yet. Finishing a lesson schedules some.",
  },
} as const;

type PhraseKey = keyof typeof PHRASES.fr;

function say(locale: DisplayLocale, key: PhraseKey, params: Record<string, string | number> = {}): string {
  return PHRASES[locale][key].replace(/\{([a-z_]+)\}/g, (token, name: string) =>
    params[name] === undefined ? token : String(params[name]));
}

/** The concept FSRS treats as mastered for review (`dueForReinforcement`'s default minMastery). */
const CONSOLIDATED_MASTERY = 0.6;

/** A plain, localized date for a review (« jeudi 6 novembre 2026 »). */
export function formatReviewDate(epochMs: number, locale: DisplayLocale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "full" }).format(epochMs);
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
  p: Presentation,
  opts: { firstScreen?: boolean; notDurable?: boolean; review?: boolean } = {},
): string {
  const locale: DisplayLocale = p.locale === "en" ? "en" : "fr";
  const scene = publicScene(p.scene as Scene) as PublicSceneFields;
  const blocks: string[] = [];
  if (opts.firstScreen && p.authoring?.notice) blocks.push(`> ${p.authoring.notice}`);
  if (opts.firstScreen && opts.notDurable) blocks.push(`> ${say(locale, "not_durable")}`);
  blocks.push(`### ${scene.title || scene.type || ""}`);
  blocks.push(`_${say(locale, opts.review ? "review_progress" : "progress", { n: p.index + 1, total: p.total })}_`);
  blocks.push(...sceneBody(scene, locale));
  if ((p.hints_available ?? 0) > 0) blocks.push(say(locale, "hint_available"));
  blocks.push(replyHint(scene, locale));
  return blocks.filter((b) => b.trim() !== "").join("\n\n");
}

function verdictLine(t: Transition, locale: DisplayLocale): string {
  const v = t.verdict;
  if (!v) return "";
  if (v.signal === "confidence_declared") return say(locale, "verdict_confidence");
  if (!v.graded) return "";
  if (v.correct === true) return say(locale, "verdict_correct");
  if (v.correct === false) return say(locale, "verdict_incorrect");
  return say(locale, "verdict_recorded");
}

/** Where the lesson goes next, in words: the session's own explanation sentences, never codes. */
function navigationLine(t: Transition, locale: DisplayLocale, ctx: DisplayContext): string {
  const nav = t.navigation;
  if (!nav || nav.kind === "advance" || nav.kind === "complete") return "";
  const explanation = "presentation" in t ? t.presentation.explanation?.explanation_short ?? "" : "";
  const returnsTo = nav.returns_to ? ctx.sceneTitle?.(nav.returns_to) : undefined;
  const back = returnsTo ? ` ${say(locale, "nav_returns_to", { title: returnsTo })}` : "";
  // A rule's `reason` on replay / remediate_alt is a machine code ("errors_threshold"): use the
  // rule's explanation sentence instead. The graph router's reasons are already sentences.
  if (nav.kind === "replay") return (explanation || say(locale, "nav_replay")) + back;
  if (nav.kind === "remediate_alt") return (explanation || say(locale, "nav_remediate_alt")) + back;
  if (nav.kind === "remediate") return (nav.reason || say(locale, "nav_remediate")) + back;
  return nav.reason ?? "";
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
    : verdict.reference_kind === "flawed_claims" ? "reference_flawed_claims" : "reference_key_points";
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
    const quote = s.quote ? `« ${s.quote} » — ` : "";
    return `> ${quote}${s.title}${s.url ? ` (${s.url})` : ""}`;
  });
  if (!lines.length) return "";
  return `${say(locale, lines.length > 1 ? "sources_heading" : "source_heading")}\n\n${lines.join("\n>\n")}`;
}

function completionBlock(t: Transition & TransitionExtras, locale: DisplayLocale, ctx: DisplayContext): string[] {
  if (t.kind !== "complete") return [];
  const label = (id: string) => ctx.conceptLabel?.(id) ?? id;
  const states = (t.summary.finalState?.concept_states ?? {}) as Record<string, { total_attempts?: number }>;
  // Only concepts with at least one graded attempt are named: an ungraded or self-rated concept is
  // claimed neither consolidated nor weak.
  const graded = Object.keys(t.summary.mastery).filter((id) => (states[id]?.total_attempts ?? 0) > 0);
  const consolidated = graded.filter((id) => (t.summary.mastery[id] ?? 0) >= CONSOLIDATED_MASTERY).map(label);
  const toReview = graded.filter((id) => (t.summary.mastery[id] ?? 0) < CONSOLIDATED_MASTERY).map(label);
  const next = t.review_plan?.next_due_at;
  return [
    say(locale, ctx.review ? "review_complete" : "complete"),
    consolidated.length ? say(locale, "consolidated", { list: consolidated.join(", ") }) : "",
    toReview.length ? say(locale, "to_review", { list: toReview.join(", ") }) : "",
    next != null ? say(locale, "next_review", { date: formatReviewDate(next, locale) }) : say(locale, "no_review"),
  ];
}

function localeOf(t: Transition, ctx: DisplayContext): DisplayLocale {
  return "presentation" in t ? (t.presentation.locale === "en" ? "en" : "fr") : ctx.locale ?? "fr";
}

/** What the learner earned by answering, carried as `verdict.display_markdown`: the verdict and the
 * feedback, the reference to compare with (I-1), the passages the scene cites, and a self-rating
 * request when no judge certified the answer. Empty for an acknowledged scene that carries none. */
export function verdictMarkdown(
  t: Transition & TransitionExtras, sources: readonly CitedSource[], ctx: DisplayContext = {},
): string {
  const locale = localeOf(t, ctx);
  return [
    verdictLine(t, locale),
    t.verdict?.feedback ?? "",
    referenceMarkdown(t.verdict, locale),
    sourcesMarkdown(sources, locale),
    t.self_rating?.requested ? say(locale, "self_rating") : "",
  ].filter((b) => b.trim() !== "").join("\n\n");
}

/** The public part after an answer, carried as `display_markdown`: where the lesson goes, in words,
 * then the next scene — or, at the end, what is consolidated, what to review and when. */
export function transitionMarkdown(t: Transition & TransitionExtras, ctx: DisplayContext = {}): string {
  const locale = localeOf(t, ctx);
  const head = [navigationLine(t, locale, ctx), ...completionBlock(t, locale, ctx)]
    .filter((b) => b.trim() !== "").join("\n\n");
  if (!("presentation" in t)) return head;
  const next = presentationMarkdown(t.presentation, { review: ctx.review ?? false });
  return head ? `${head}\n\n---\n\n${next}` : next;
}

/** The line rate_recall answers with: the next review date, and that mastery did not move. */
export function recallRatedMarkdown(nextReviewAt: number, locale: DisplayLocale): string {
  return say(locale, "recall_rated", { date: formatReviewDate(nextReviewAt, locale) });
}

/** What start_review_session answers when nothing is due: when the next review falls, if any. */
export function nothingToReviewMarkdown(nextReviewAt: number | null, locale: DisplayLocale): string {
  return nextReviewAt === null
    ? say(locale, "nothing_scheduled")
    : say(locale, "nothing_due", { date: formatReviewDate(nextReviewAt, locale) });
}
