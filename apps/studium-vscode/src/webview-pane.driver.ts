// webview-pane.driver.ts — LIVE front-end test: actually EXECUTES the webview renderer
// (media/artifact-pane.js) inside a jsdom DOM, renders each scene type, and asserts (a) the real
// affordances appear in the DOM and (b) clicking a control posts the correct message back to the
// host. This is the front-end counterpart to lesson-walk.driver.ts (which live-tests the back end):
// together they cover the input kinds the graders require AND the DOM the learner actually sees.
//
// Run from the repo root:
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/webview-pane.driver.ts
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const paneSrc = readFileSync(resolve(here, "..", "media", "artifact-pane.js"), "utf8");

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

// A fresh DOM + a freshly-evaluated pane per scene, with __send overridden to CAPTURE host messages.
function mount() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="pane"></div></body></html>`, {
    runScripts: "outside-only", pretendToBeVisual: true,
  });
  const win = dom.window as any;
  win.eval(paneSrc);                       // runs the IIFE → attaches window.__render / __send / message listener
  const sent: any[] = [];
  win.__send = (m: any) => sent.push(m);   // capture instead of postMessage to the (absent) host
  return {
    win,
    sent,
    render: (state: any) => win.__render(state),
    // synchronously deliver a host→pane message (e.g. turn_result) to the pane's listener
    post: (data: any) => win.dispatchEvent(new win.MessageEvent("message", { data })),
    text: () => (win.document.getElementById("pane")?.textContent || ""),
    $: (sel: string) => win.document.querySelector(sel),
    $all: (sel: string) => Array.from(win.document.querySelectorAll(sel)),
    click: (elm: any) => elm && elm.click(),
  };
}

const baseState = (scene: any, extra: any = {}) => ({ scene, scene_assets: [], progress: { index: 1, total: 9 }, ...extra });

// Submits a free-text scene: fill the textarea, click the primary button, return the captured input.
function submitFreeText(scene: any, answer: string) {
  const m = mount();
  m.render(baseState(scene));
  const ta = m.$("textarea");
  const btn = m.$(".controls .primary");
  expect(!!ta, `[${scene.type}] renders a <textarea>`);
  expect(!!btn, `[${scene.type}] renders a submit button`);
  if (ta) (ta as any).value = answer;
  m.click(btn);
  const respond = m.sent.find((x) => x.type === "respond");
  return { m, respond };
}

// --- 1) Wave-1 free-text scenes: fields rendered + correct kind posted ----------------------------
{
  const cases = [
    { scene: { type: "comparison", title: "Compare", prompt: "Compare A et B", artifact_a: "ARTIFACT_ALPHA", artifact_b: "ARTIFACT_BETA" }, kind: "comparison", fields: ["ARTIFACT_ALPHA", "ARTIFACT_BETA"] },
    { scene: { type: "summary_audit", title: "Audit", source_content: "SOURCE_TEXT", ai_summary: "SUMMARY_TEXT" }, kind: "summary_audit", fields: ["SOURCE_TEXT", "SUMMARY_TEXT"] },
    { scene: { type: "prompt_practice", title: "Prompt", task: "TASK_TEXT", starter_prompt: "STARTER_PROMPT" }, kind: "prompt_submission", fields: ["TASK_TEXT"] },
    { scene: { type: "communication_sim", title: "Comm", scenario: "SCENARIO_TEXT", prompt: "Rédige" }, kind: "communication", fields: ["SCENARIO_TEXT"] },
    { scene: { type: "spot_the_flaw", title: "Flaw", flawed_content: "FLAWED_TEXT" }, kind: "flaw_report", fields: ["FLAWED_TEXT"] },
    { scene: { type: "explain_back", title: "Explain", prompt: "EXPLAIN_PROMPT" }, kind: "explanation", fields: ["EXPLAIN_PROMPT"] },
  ];
  for (const c of cases) {
    const { m, respond } = submitFreeText(c.scene, "ma réponse");
    const pageText = m.text();
    for (const f of c.fields) expect(pageText.includes(f), `[${c.scene.type}] DOM shows field "${f}"`);
    expect(!!respond && respond.input?.kind === c.kind, `[${c.scene.type}] submit posts kind "${c.kind}" (got ${respond?.input?.kind})`);
    expect(!!respond && respond.input?.text === "ma réponse", `[${c.scene.type}] submit carries the typed text`);
    // answer keys must NEVER be in the DOM (publicScene strips them, but double-check the renderer)
    expect(!pageText.includes("model_"), `[${c.scene.type}] no model_* reveal leaked to DOM`);
  }
  // prompt_practice prefills the textarea with starter_prompt (shown-by-design)
  {
    const m = mount();
    m.render(baseState({ type: "prompt_practice", title: "P", task: "T", starter_prompt: "STARTER_PROMPT" }));
    expect((m.$("textarea") as any)?.value === "STARTER_PROMPT", "prompt_practice prefills textarea with starter_prompt");
  }
}

// --- 2) quiz still works (regression): choice buttons post quiz_choice with the id ----------------
{
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "2+2?", choices: [{ id: "a", text: "3" }, { id: "b", text: "4" }] }));
  const choiceBtns = m.$all(".controls .choice");
  expect(choiceBtns.length === 2, `quiz renders 2 choice buttons (got ${choiceBtns.length})`);
  m.click(choiceBtns[1]);
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.kind === "quiz_choice" && r.input?.choiceId === "b", "quiz posts quiz_choice with chosen id");
}

// --- 3) discussion turn loop: topic/seed rendered, Envoyer posts a turn, turn_result appends ------
{
  const m = mount();
  m.render(baseState({ type: "discussion", title: "Débat", topic: "TOPIC_TEXT", seed_claim: "SEED_CLAIM" }));
  expect(m.text().includes("TOPIC_TEXT"), "discussion shows the topic");
  expect(m.text().includes("SEED_CLAIM"), "discussion shows the seed_claim");
  expect(!!m.$("#turns"), "discussion renders a transcript container");
  const ta = m.$("textarea");
  if (ta) (ta as any).value = "Je pense que oui car…";
  const sendBtn = m.$all(".controls button").find((b: any) => /Envoyer/.test(b.textContent));
  m.click(sendBtn);
  const turn = m.sent.find((x) => x.type === "turn");
  expect(!!turn && turn.text === "Je pense que oui car…", "Envoyer posts a {type:'turn'} with the text");
  expect(m.text().includes("Je pense que oui"), "the learner turn is appended to the transcript");
  // simulate the host's reply → the tutor line + reasoning signal append
  m.post({ type: "turn_result", reasoning: { signal: "justification", confidence: 0.7 }, tutor: { text: "TUTOR_REPLY", move_kind: "probe", revealed: false } });
  expect(m.text().includes("TUTOR_REPLY"), "turn_result appends the tutor reply");
  expect(m.text().includes("justification"), "turn_result shows the reasoning signal");
  // "Terminer" advances with an ack
  const finBtn = m.$all(".controls button").find((b: any) => /Terminer/.test(b.textContent));
  m.click(finBtn);
  const ack = m.sent.find((x) => x.type === "respond" && x.input?.kind === "ack");
  expect(!!ack, "Terminer posts an ack to advance");
}

// --- 4) reproduction: steps[] rendered as an ordered list -----------------------------------------
{
  const m = mount();
  m.render(baseState({ type: "reproduction", title: "Repro", task_card_id: "tc-9", steps: [{ instruction: "STEP_ONE" }, { instruction: "STEP_TWO" }] }));
  expect(!!m.$("ol.steps"), "reproduction renders an <ol class=steps>");
  expect(m.$all("ol.steps li").length === 2, "reproduction renders one li per step");
  expect(m.text().includes("STEP_ONE") && m.text().includes("STEP_TWO"), "reproduction shows the step instructions");
  expect(m.text().includes("tc-9"), "reproduction shows the task_card_id");
}

// --- 5) calibration card: actionable bands shown, "bien" suppressed -------------------------------
{
  const withSur = mount();
  withSur.render(baseState({ type: "concept", title: "C", markdown: "x" }, { calibration: [{ concept_id: "c1", band: "sur", message: "CALIB_SUR_MSG" }] }));
  expect(withSur.text().includes("CALIB_SUR_MSG"), "calibration 'sur' verdict is shown");
  expect(!!withSur.$(".calib-sur"), "calibration card carries the band class");

  const onlyBien = mount();
  onlyBien.render(baseState({ type: "concept", title: "C", markdown: "x" }, { calibration: [{ concept_id: "c1", band: "bien", message: "CALIB_BIEN_MSG" }] }));
  expect(!onlyBien.text().includes("CALIB_BIEN_MSG"), "calibration 'bien' verdict is suppressed (non-actionable)");
}

// --- 6) forget control: present on every scene, posts {type:'end'} --------------------------------
{
  const m = mount();
  m.render(baseState({ type: "concept", title: "C", markdown: "x" }));
  const forgetBtn = m.$(".forget");
  expect(!!forgetBtn, "every scene shows the 'M'oublier' (forget) control");
  m.click(forgetBtn);
  expect(!!m.sent.find((x) => x.type === "end"), "forget posts {type:'end'}");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} webview-pane assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — webview-pane (live jsdom render + click) passed all ${checks} assertions.`);
