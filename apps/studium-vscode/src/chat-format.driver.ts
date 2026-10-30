// chat-format.driver.ts — unit test for the pure @studium chat formatting/parsing. No vscode APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/chat-format.driver.ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSceneForChat, replyToInput, verdictForChat, referenceForChat, recallGradeOf, type ChatScene } from "./chat-format.js";
import { phrase } from "./phrases.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

// 1) quiz: renders the stem + lettered choices, and a letter reply maps to quiz_choice.
{
  const scene: ChatScene = { type: "quiz", title: "Q", question: "QUESTION_STEM", choices: [{ id: "a", text: "Three" }, { id: "b", text: "Four" }] };
  const md = formatSceneForChat(scene, { index: 1, total: 9 });
  expect(md.includes("QUESTION_STEM") && md.includes("**a)** Three") && md.includes("1/9"), "quiz renders stem + choices + progress");
  const r = replyToInput(scene, "b");
  expect(!!r && r.kind === "quiz_choice" && r.choiceId === "b", "quiz reply 'b' → quiz_choice b");
  expect(replyToInput(scene, "purple") === null, "an uninterpretable quiz reply → null (ask again)");
}

// 2) meta_checkpoint: a 0-4 digit reply → confidence.
{
  const scene: ChatScene = { type: "meta_checkpoint", title: "M", pre_question: "How sure?", scale_labels: [] };
  const r = replyToInput(scene, "3");
  expect(!!r && r.kind === "confidence" && r.value === 3, "meta_checkpoint reply '3' → confidence 3");
}

// 3) verdict deck IN CHAT: numbered claims + a "1,3" reply → per-token flag/sound verdicts.
{
  const scene: ChatScene = { type: "spot_the_flaw", title: "Audit", flawed_content: "AI_READING", deck: [{ token: "d0", text: "CLAIM_A" }, { token: "d1", text: "CLAIM_B" }, { token: "d2", text: "CLAIM_C" }] };
  const md = formatSceneForChat(scene);
  expect(md.includes("AI_READING") && md.includes("1. CLAIM_A") && md.includes("3. CLAIM_C"), "deck renders the AI reading + numbered claims");
  const r = replyToInput(scene, "1,3");
  expect(!!r && r.kind === "flaw_verdicts", "deck reply → flaw_verdicts");
  const vs = (r as any).verdicts as Array<{ token: string; flagged: boolean }>;
  expect(vs.length === 3 && vs[0]!.flagged && !vs[1]!.flagged && vs[2]!.flagged, "deck '1,3' flags d0 + d2, leaves d1");
  const empty = replyToInput(scene, "") as any;
  expect(empty.verdicts.every((v: any) => !v.flagged), "an empty deck reply flags nothing (all judged sound)");
  // LEAK: the deck only ever carried {token,text}; no ground-truth marker in the rendered markdown
  expect(!md.includes("flawed") && !md.includes("model_") && !md.includes("sound_claims"), "deck chat render leaks no answer key");
}

// 4) free-text scene: the whole reply becomes the grader's kind.
{
  const scene: ChatScene = { type: "spot_the_flaw", title: "F", flawed_content: "FLAWED" }; // no deck → free text
  const r = replyToInput(scene, "the third step is wrong because…");
  expect(!!r && r.kind === "flaw_report" && r.text === "the third step is wrong because…", "spot_the_flaw without a deck → free-text flaw_report");
  const summary: ChatScene = { type: "summary_audit", title: "S", source_content: "SRC", ai_summary: "SUM" };
  expect(formatSceneForChat(summary).includes("Résumé IA à auditer"), "summary_audit shows the AI summary to audit");
  expect(replyToInput(summary, "it omits X")?.kind === "summary_audit", "summary_audit reply → summary_audit kind");
}

// 5) intro/concept/reproduction → ack; reproduction points at the run command.
{
  const concept: ChatScene = { type: "concept", title: "C", markdown: "Fourier basics" };
  expect(replyToInput(concept, "ok")?.kind === "ack", "a concept reply → ack (advance)");
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
  expect(verdictForChat({ display_markdown: "", feedback: "Oui." }, "fr") === "✓ Oui.", "an empty display_markdown falls back to the fields");

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
  } as const;
  for (const [hostKey, ownKey] of Object.entries(MIRROR)) {
    for (const [locale, block] of [["fr", frBlock], ["en", enBlock]] as const) {
      const theirs = hostValue(block, hostKey);
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
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} chat-format assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — chat-format (@studium formatting + reply parsing) passed all ${checks} assertions.`);
