// chat-format.driver.ts — unit test for the pure @studium chat formatting/parsing. No vscode APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/chat-format.driver.ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as chatFormat from "./chat-format.js";
import { formatSceneForChat, verdictForChat, referenceForChat, recallGradeOf, ratingAgainPrompt, navigationNote, reasoningNote, type ChatScene } from "./chat-format.js";
import { phrase } from "./phrases.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

// 1) quiz: renders the stem + lettered choices. CQ-4 / L-10: the chat no longer parses replies itself; it sends
//    {kind: "reply", text} and the host maps it (packages/lesson-session-host/src/reply-mapping.ts, pinned by its
//    own tests), so the extension's copy of the parser (replyToInput, deckVerdicts, FREE_TEXT_KIND) is gone.
{
  const scene: ChatScene = { type: "quiz", title: "Q", question: "QUESTION_STEM", choices: [{ id: "a", text: "Three" }, { id: "b", text: "Four" }] };
  const md = formatSceneForChat(scene, { index: 1, total: 9 });
  expect(md.includes("QUESTION_STEM") && md.includes("**a)** Three") && md.includes("1/9"), "quiz renders stem + choices + progress");
  const exported = Object.keys(chatFormat);
  expect(!exported.includes("replyToInput") && !exported.includes("deckVerdicts") && !exported.includes("FREE_TEXT_KIND"),
    `the extension keeps no copy of the host's reply parser (exports: ${exported.join(", ")})`);
  const own = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "chat-format.ts"), "utf8");
  expect(!/function\s+(replyToInput|deckVerdicts)\b/.test(own) && !/const\s+FREE_TEXT_KIND\b/.test(own), "nor any private copy of it");
}

// 3) verdict deck IN CHAT: numbered claims, no answer key.
{
  const scene: ChatScene = { type: "spot_the_flaw", title: "Audit", flawed_content: "AI_READING", deck: [{ token: "d0", text: "CLAIM_A" }, { token: "d1", text: "CLAIM_B" }, { token: "d2", text: "CLAIM_C" }] };
  const md = formatSceneForChat(scene);
  expect(md.includes("AI_READING") && md.includes("1. CLAIM_A") && md.includes("3. CLAIM_C"), "deck renders the AI reading + numbered claims");
  // LEAK: the deck only ever carried {token,text}; no ground-truth marker in the rendered markdown
  expect(!md.includes("flawed") && !md.includes("model_") && !md.includes("sound_claims"), "deck chat render leaks no answer key");
}

// 4) free-text scenes say to answer in one's own words; summary_audit shows the AI summary.
{
  const summary: ChatScene = { type: "summary_audit", title: "S", source_content: "SRC", ai_summary: "SUM" };
  expect(formatSceneForChat(summary).includes("Résumé IA à auditer"), "summary_audit shows the AI summary to audit");
  expect(formatSceneForChat(summary).includes(phrase("chat_reply_text", {}, "fr")), "a free-text scene asks for the learner's own words");
  const discussion: ChatScene = { type: "discussion", title: "D", topic: "T", seed_claim: "CLAIM" };
  const hint = formatSceneForChat(discussion, undefined, "fr");
  expect(hint.includes(phrase("chat_reply_discussion", {}, "fr")) && !hint.includes("/answer"),
    `a discussion says an argument is a plain reply and how to move on, never a /answer command that does not exist (got ${hint})`);
}

// 5) reproduction points at the run command.
{
  const repro: ChatScene = { type: "reproduction", title: "R", steps: [{ instruction: "STEP_ONE" }] };
  // I-7: the hint names the pane's button (« Lancer la reproduction » / "Run the reproduction"), not the English
  // palette title « Studium: Run reproduction », which a French lesson in an English editor would misquote.
  const fr = formatSceneForChat(repro, undefined, "fr");
  const en = formatSceneForChat(repro, undefined, "en");
  // T8: « » hold the button's name with no-break spaces (U+00A0), so the quote never breaks from its word.
  expect(fr.includes("«\u00a0Lancer la reproduction\u00a0»"), `FR reproduction points the learner at the pane's run button (got ${fr})`);
  expect(en.includes("“Run the reproduction”"), `EN reproduction points the learner at the pane's run button (got ${en})`);
  expect(!fr.includes("Studium: Run reproduction") && !en.includes("Studium: Run reproduction"), "neither quotes the palette title");
}

// UX-04 / L-6: where the lesson goes next is worded from navigation.kind, never from the engine's reason codes or
// rule ids (« errors_threshold », « rule_2err_replay_concept »), and never claims the answer was right or wrong.
{
  for (const locale of ["fr", "en"] as const) {
    for (const kind of ["replay", "remediate_alt", "remediate"]) {
      const line = navigationNote({ kind, reason: "errors_threshold", rule_id: "rule_2err_replay_concept" }, locale);
      expect(line !== "" && !/errors_threshold|rule_|threshold|seuil|item/i.test(line), `${kind} (${locale}) is worded in learner words (got ${line})`);
    }
    expect(navigationNote({ kind: "advance", reason: "x" }, locale) === "" && navigationNote(undefined, locale) === "", "an ordinary advance says nothing");
  }
  expect(reasoningNote({ signal: "justification", confidence: 0.83 }, "fr") === phrase("chat_reasoning_signal", { signal: phrase("pane_signal_justification", {}, "fr") }, "fr"),
    "a reasoning signal is named in words, without its decimal");
  expect(reasoningNote({ signal: "raw_code_x", confidence: 0.5 }, "fr") === "" && !reasoningNote({ signal: "synthesis" }, "en").match(/\d/),
    "an unknown signal is not printed, and no number ever is");
}

// 6) T1 (integration tail): since I-1 the reference is data on the verdict and an offline key-point verdict
//    may carry no feedback text. The chat and the notebook show the served verdict.display_markdown as it
//    is; without it they build the reference from the fields under the host's headings.
{
  const served = { feedback: "F", key_points: ["K"], display_markdown: "SERVED-VERDICT" };
  expect(verdictForChat(served, "fr") === "SERVED-VERDICT", "the served verdict.display_markdown is shown as it is, nothing added");

  const offline = { graded: true, key_points: ["POINT-UN", "POINT-DEUX"], model_answer: "MODÈLE", reference_kind: "key_points" };
  const fr = verdictForChat(offline, "fr");
  // The French headings carry the extension's typography (T8): a no-break space before the colon.
  expect(fr.includes("**Compare ta réponse à ces points clés\u00a0:**\n\n- POINT-UN\n- POINT-DEUX"), `an offline key-point verdict with no feedback shows its key points (got ${fr})`);
  expect(fr.includes("**Réponse modèle**\n\nMODÈLE"), "and its model answer under its heading");
  expect(!fr.includes("✓") && !fr.includes("✗"), "no verdict mark is invented when nothing was said about the answer");

  const judged = { correct: false, feedback: "1/2 points clés couverts", key_points: ["POINT-UN", "POINT-DEUX"],
    key_points_missing: ["POINT-DEUX"], model_answer: "MODÈLE", reference_kind: "key_points" };
  const jfr = verdictForChat(judged, "fr");
  expect(jfr.startsWith("✗ 1/2 points clés couverts"), "the feedback comes first, with its mark");
  expect(jfr.includes("- POINT-DEUX _(manquant selon le juge)_") && jfr.split("POINT-DEUX").length === 2,
    "a point the judge found missing is marked once in the list, never repeated");

  const audit = { correct: true, key_points: ["AFFIRMATION-FAUSSE"], model_answer: "CORRECTION", reference_kind: "planted_flaws" };
  expect(verdictForChat(audit, "fr").includes("**Compare ton audit aux défauts plantés\u00a0:**\n\n- AFFIRMATION-FAUSSE"), "an audit's list is labelled as planted flaws");
  expect(verdictForChat(audit, "fr").includes("**Correction modèle**\n\nCORRECTION"), "an audit's model answer is its model correction");
  expect(verdictForChat(audit, "en").includes("**Compare your audit with the planted flaws:**") && verdictForChat(audit, "en").includes("**Model correction**"),
    "the audit headings in English");
  const critique = { key_points: ["n=3 prouve l'effet (petit échantillon)"], reference_kind: "flawed_claims" };
  expect(referenceForChat(critique, "fr") === "**Compare ta critique aux affirmations qui cachaient un défaut\u00a0:**\n\n- n=3 prouve l'effet (petit échantillon)",
    `a critique's list is labelled as the claims that hid a flaw (got ${referenceForChat(critique, "fr")})`);
  expect(referenceForChat(critique, "en").startsWith("**Compare your critique with the claims that hid a flaw:**"), "in English too");
  expect(verdictForChat({ graded: false }, "fr") === "" && verdictForChat(undefined, "fr") === "", "an acknowledgement shows nothing");
  // CQ-6 / L-7: changed from "✓ Oui." — a verdict that says nothing about correctness (correct undefined) used to be
  // shown as right. Only correct === true earns ✓ and only correct === false ✗; an answer no judge assessed says so.
  expect(verdictForChat({ display_markdown: "", feedback: "Oui." }, "fr") === "Oui.", "an empty display_markdown falls back to the fields, unmarked when nothing graded it");
  expect(verdictForChat({ correct: true, feedback: "Oui." }, "fr") === "✓ Oui.", "✓ only when correct === true");
  expect(verdictForChat({ correct: false, feedback: "Non." }, "en") === "✗ Non.", "✗ only when correct === false");
  const recorded = verdictForChat({ graded: true, feedback: "Merci." }, "fr");
  expect(recorded.startsWith(phrase("chat_verdict_recorded", {}, "fr")) && !recorded.includes("✓") && !recorded.includes("✗"),
    `a graded answer no judge assessed says it was recorded, with no mark (got ${recorded})`);
  // L-2: a wrong author-keyed quiz left for good releases its correct choice under « La bonne réponse ».
  const wrongQuiz = { correct: false, feedback: "Non.", key_points: ["Le glucose et l'oxygène"], reference_kind: "correct_choice" };
  expect(referenceForChat(wrongQuiz, "fr") === "**La bonne réponse\u00a0:**\n\n- Le glucose et l'oxygène",
    `the correct choice is labelled « La bonne réponse » (got ${JSON.stringify(referenceForChat(wrongQuiz, "fr"))})`);
  expect(referenceForChat(wrongQuiz, "en").startsWith("**The right answer:**"), "and “The right answer” in English");

  // The wording mirrors the host's chat-display.ts (the extension cannot import the host package): the
  // headings are pinned against its source, spaces normalised (the extension's French typography, T8).
  const here = dirname(fileURLToPath(import.meta.url));
  const hostSrc = readFileSync(resolve(here, "..", "..", "..", "packages", "lesson-session-host", "src", "chat-display.ts"), "utf8");
  const [frBlock, enBlock] = [hostSrc.slice(hostSrc.indexOf("  fr: {"), hostSrc.indexOf("  en: {")), hostSrc.slice(hostSrc.indexOf("  en: {"))];
  const hostValue = (block: string, key: string) => block.match(new RegExp(`\\n    ${key}: "([^"]*)"`))?.[1];
  const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
  const MIRROR = {
    reference_key_points: "chat_reference_key_points", reference_planted_flaws: "chat_reference_planted_flaws",
    reference_flawed_claims: "chat_reference_flawed_claims", model_answer: "chat_model_answer",
    model_correction: "chat_model_correction", key_point_missing: "chat_key_point_missing",
    verdict_recorded: "chat_verdict_recorded",
    // L-2: pinned once group B's host catalogue carries the heading (read when present, decided wording above).
    reference_correct_choice: "chat_reference_correct_choice",
  } as const;
  for (const [hostKey, ownKey] of Object.entries(MIRROR)) {
    for (const [locale, block] of [["fr", frBlock], ["en", enBlock]] as const) {
      const theirs = hostValue(block, hostKey);
      if (hostKey === "reference_correct_choice" && theirs === undefined) continue;
      expect(theirs !== undefined && plain(phrase(ownKey, {}, locale)) === theirs,
        `${ownKey} (${locale}) mirrors the host's ${hostKey}: ${JSON.stringify(theirs)} vs ${JSON.stringify(phrase(ownKey, {}, locale))}`);
    }
  }
}

// 7) A transition that asks for a self-rating: the chat and the notebook take a bare grade as the rating.
{
  const grades = ["again", "hard", "good", "easy"];
  expect(recallGradeOf("good", grades) === "good" && recallGradeOf("  Easy ", grades) === "easy", "a bare grade is the rating");
  expect(recallGradeOf("good answer", grades) === null && recallGradeOf("", grades) === null, "anything else is an answer, not a rating");
  // UX-10: the French labels and glosses the learner was shown are ratings too (the pane's buttons, the host's
  // « good (bien) »), never submitted as the answer to the next scene.
  const fr: Array<[string, string]> = [["bien", "good"], ["Bien.", "good"], ["difficile", "hard"], ["facile", "easy"],
    ["Je ne savais pas", "again"], ["à revoir", "again"], ["a revoir", "again"], ["« Facile »", "easy"], ["**good**", "good"]];
  for (const [reply, grade] of fr) expect(recallGradeOf(reply, grades) === grade, `« ${reply} » is the rating ${grade} (got ${recallGradeOf(reply, grades)})`);
  expect(recallGradeOf("I didn't know", grades) === "again" && recallGradeOf("Hard", grades) === "hard", "the English button labels too");
  expect(recallGradeOf("bien sûr que non", grades) === null && recallGradeOf("pas facile du tout", grades) === null, "a sentence is not a rating");
  expect(recallGradeOf("facile", ["again", "good"]) === null, "a grade the transition did not offer is not taken");
  // UX-10 / L-5: the « rate again » prompt names the grades in the learner's language (French names first), never by
  // their API codes inside a French sentence; every name it shows is one recallGradeOf takes back as that grade.
  const fr2 = ratingAgainPrompt(grades, "fr");
  expect(fr2.includes("je ne savais pas / difficile / bien / facile") && !/\b(again|hard|good|easy)\b/.test(fr2),
    `the French prompt names the grades in French (got ${fr2})`);
  const en2 = ratingAgainPrompt(grades, "en");
  expect(en2.includes("I didn't know / hard / good / easy"), `the English prompt names them by their labels (got ${en2})`);
  const offered = ratingAgainPrompt(["again", "good"], "fr");
  expect(offered.includes("je ne savais pas / bien") && !offered.includes("difficile"), `only the grades the transition offered (got ${offered})`);
  for (const name of ["je ne savais pas", "difficile", "bien", "facile"]) {
    expect(recallGradeOf(name, grades) !== null, `« ${name} » shown in the prompt is read back as a rating`);
  }
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} chat-format assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — chat-format (@studium formatting + reply parsing) passed all ${checks} assertions.`);
