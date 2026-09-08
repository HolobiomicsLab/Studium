// chat-format.driver.ts — unit test for the pure @studium chat formatting/parsing. No vscode APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/chat-format.driver.ts
import { formatSceneForChat, replyToInput, type ChatScene } from "./chat-format.js";

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
  expect(formatSceneForChat(repro).includes("Run reproduction"), "reproduction points the learner at the run command");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} chat-format assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — chat-format (@studium formatting + reply parsing) passed all ${checks} assertions.`);
