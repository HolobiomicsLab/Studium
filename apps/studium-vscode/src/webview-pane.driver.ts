// webview-pane.driver.ts — LIVE front-end test: actually EXECUTES the webview renderer
// (media/artifact-pane.js) inside a jsdom DOM, renders each scene type, and asserts (a) the real
// affordances appear in the DOM and (b) clicking a control posts the correct message back to the
// host. This is the front-end counterpart to lesson-walk.driver.ts (which live-tests the back end):
// together they cover the input kinds the graders require AND the DOM the learner actually sees.
// It also compiles the real paneHtml() out of extension.ts (CSP, stylesheet order, CDN pinning).
//
// Run from the repo root:
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/webview-pane.driver.ts
import { JSDOM } from "jsdom";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { browserPhrases, phrase, type Locale } from "./phrases.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const extensionDir = resolve(here, "..");
const repoRoot = resolve(extensionDir, "..", "..");
const paneSrc = readFileSync(resolve(extensionDir, "media", "artifact-pane.js"), "utf8");
const markedSrc = readFileSync(resolve(extensionDir, "node_modules", "marked", "marked.min.js"), "utf8");
const katexSrc = readFileSync(resolve(extensionDir, "node_modules", "katex", "dist", "katex.min.js"), "utf8");
const mhchemSrc = readFileSync(resolve(extensionDir, "node_modules", "katex", "dist", "contrib", "mhchem.min.js"), "utf8");
// Every catalogue key this driver names must exist: a missing key would make a negative assertion
// (« the pane does not show X ») pass vacuously, so lookups are recorded and checked at the end.
const missingKeys = new Set<string>();
function strictCatalogue(locale: Locale): Record<string, string> {
  const table = browserPhrases(locale) as Record<string, string>;
  return new Proxy(table, {
    get: (target, key) => {
      if (typeof key === "string" && !(key in target) && key !== "toJSON") missingKeys.add(`${locale}:${key}`);
      return (target as any)[key] ?? `<<missing ${String(key)}>>`;
    },
  });
}
const FR = strictCatalogue("fr");
const EN = strictCatalogue("en");
/** phrase() for test expectations, recording a missing key instead of throwing. */
function ph(key: string, params: Record<string, string | number> = {}, locale: Locale = "fr"): string {
  if (!(key in (browserPhrases(locale) as Record<string, string>))) { missingKeys.add(`${locale}:${key}`); return `<<missing ${key}>>`; }
  return phrase(key as any, params, locale);
}

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

// A fresh DOM + a freshly-evaluated pane per scene, with __send overridden to CAPTURE host messages.
// `remoteImages` mirrors the body attribute paneHtml sets (absent = the private default, blocked).
function mount(withRenderLibraries: boolean | "marked" = false, opts: { remoteImages?: "allowed" | "blocked" } = {}) {
  const bodyAttr = opts.remoteImages ? ` data-remote-images="${opts.remoteImages}"` : "";
  const dom = new JSDOM(`<!doctype html><html><body${bodyAttr}><script type="application/json" id="studium-strings">${JSON.stringify(FR)}</script><div id="pane"></div></body></html>`, {
    runScripts: "outside-only", pretendToBeVisual: true,
  });
  const win = dom.window as any;
  if (withRenderLibraries) {
    win.eval(markedSrc);
  }
  if (withRenderLibraries === true) {
    win.eval(katexSrc);
    win.eval(mhchemSrc);
  }
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
    live: () => (win.document.getElementById("pane-live")?.textContent || ""),
    $: (sel: string) => win.document.querySelector(sel),
    $all: (sel: string) => Array.from(win.document.querySelectorAll(sel)) as any[],
    click: (elm: any) => elm && elm.click(),
    key: (target: any, key: string, init: Record<string, unknown> = {}) =>
      (target || win.document.body).dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })),
  };
}
type Mounted = ReturnType<typeof mount>;
/** Type into an answer box as the learner does: the value, then the input event a keystroke fires. Changed
 * (UX-08): the drivers used to set `.value` alone; the submit button now waits for text and listens to input. */
function fill(textarea: any, text: string) {
  if (!textarea) return;
  textarea.value = text;
  textarea.dispatchEvent(new textarea.ownerDocument.defaultView.Event("input", { bubbles: true }));
}

const baseState = (scene: any, extra: any = {}) => {
  const locale: Locale = extra.locale === "en" ? "en" : "fr";
  return { scene, scene_assets: [], progress: { index: 1, total: 9 }, strings: browserPhrases(locale), ...extra };
};
const quiz = (id: string, title: string, extra: any = {}) => ({
  id, type: "quiz", title, question: `Question ${title} ?`, concept_refs: ["c-" + id],
  choices: [{ id: "a", text: "Trois" }, { id: "b", text: "Quatre" }, { id: "c", text: "Cinq" }], ...extra,
});
const posted = (m: Mounted, type: string) => m.sent.filter((x) => x.type === type);
/** Pick a quiz/meta choice card, then press the explicit submit button (VSC-8: no single-click submit). */
function choose(m: Mounted, index: number) {
  m.click(m.$all(".controls .choice")[index]);
  m.click(m.$(".controls .validate"));
}
/** Render scene A, then the host's next render carrying the verdict for A (what extension.ts posts). */
function answered(m: Mounted, sceneA: any, next: any, verdict: any, extra: any = {}) {
  m.render(baseState(sceneA, extra.firstExtra ?? {}));
  m.render(baseState(next, { verdict: { scene_id: sceneA.id, graded: true, signal: "answer_submitted", ...verdict }, ...(extra.nextExtra ?? {}) }));
}

// --- 1) Wave-1 free-text scenes: fields rendered + correct kind posted ----------------------------
// Submits a free-text scene: fill the textarea, click the primary button, return the captured input.
function submitFreeText(scene: any, answer: string) {
  const m = mount();
  m.render(baseState(scene));
  const ta = m.$("textarea");
  const btn = m.$(".controls .primary");
  expect(!!ta, `[${scene.type}] renders a <textarea>`);
  expect(!!btn, `[${scene.type}] renders a submit button`);
  fill(ta, answer);
  m.click(btn);
  const respond = m.sent.find((x) => x.type === "respond");
  return { m, respond };
}
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

// --- 2) quiz: the QUESTION STEM is rendered + choice cards post quiz_choice with the id ------------
// Changed (VSC-8): a choice is now selected first and posted by an explicit « Valider » button, so the
// assertion clicks the card THEN the button. The added assertion is the point of the change: a single
// click on a card no longer submits.
{
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Quiz titre", question: "QUESTION_STEM_TEXT", choices: [{ id: "a", text: "3" }, { id: "b", text: "4" }] }));
  expect(m.text().includes("QUESTION_STEM_TEXT"), "quiz renders the question stem (not just the title)");
  const choiceBtns = m.$all(".controls .choice");
  expect(choiceBtns.length === 2, `quiz renders 2 choice cards (got ${choiceBtns.length})`);
  m.click(choiceBtns[1]);
  expect(!m.sent.some((x) => x.type === "respond"), "a single click on a choice card does not submit (VSC-8)");
  m.click(m.$(".controls .validate"));
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.kind === "quiz_choice" && r.input?.choiceId === "b", "quiz posts quiz_choice with chosen id");
}

// --- 2b) meta_checkpoint: pre_question rendered + scale_labels on cards + confidence value ---------
// Changed (VSC-8): same select-then-submit pattern as the quiz, for the same reason (a misclick on a
// self-assessment records a wrong calibration sample).
{
  const m = mount();
  m.render(baseState({ type: "meta_checkpoint", title: "Auto-éval", pre_question: "PRE_QUESTION_TEXT", scale_labels: ["Pas du tout", "Un peu", "Moyen", "Bien", "Très à l'aise"] }));
  expect(m.text().includes("PRE_QUESTION_TEXT"), "meta_checkpoint renders the pre_question");
  expect(m.text().includes("Très à l'aise"), "meta_checkpoint shows the scale_labels on the cards");
  const confBtns = m.$all(".controls .choice");
  expect(confBtns.length === 5, `meta_checkpoint renders 5 confidence cards (got ${confBtns.length})`);
  m.click(confBtns[3]);
  expect(!m.sent.some((x) => x.type === "respond"), "a single click on a confidence card does not submit");
  m.click(m.$(".controls .validate"));
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.kind === "confidence" && r.input?.value === 3, "meta_checkpoint posts confidence with the value");
}

// --- 3) discussion turn loop: topic/seed rendered, Envoyer posts a turn, turn_result appends ------
{
  const m = mount();
  m.render(baseState({ type: "discussion", title: "Débat", topic: "TOPIC_TEXT", seed_claim: "SEED_CLAIM" }));
  expect(m.text().includes("TOPIC_TEXT"), "discussion shows the topic");
  expect(m.text().includes("SEED_CLAIM"), "discussion shows the seed_claim");
  expect(!!m.$("#turns"), "discussion renders a transcript container");
  const ta = m.$("textarea");
  fill(ta, "Je pense que oui car…");
  const sendBtn = m.$all(".controls button").find((b: any) => /Envoyer/.test(b.textContent));
  m.click(sendBtn);
  const turn = m.sent.find((x) => x.type === "turn");
  expect(!!turn && turn.text === "Je pense que oui car…", "Envoyer posts a {type:'turn'} with the text");
  expect(m.text().includes("Je pense que oui"), "the learner turn is appended to the transcript");
  // simulate the host's reply → the tutor line + reasoning signal append
  m.post({ type: "turn_result", reasoning: { signal: "justification", confidence: 0.7 }, tutor: { text: "TUTOR_REPLY", move_kind: "probe", revealed: false } });
  expect(m.text().includes("TUTOR_REPLY"), "turn_result appends the tutor reply");
  expect(m.text().includes("justification"), "turn_result shows the reasoning signal");
  expect(m.live().includes(FR.pane_live_tutor), "the tutor reply is announced in the live region (VSC-3)");
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
// 4b) VSC-8: a learner-time run scene offers « Lancer la reproduction » and never a « Continuer » that
// the host would reject with RunRequiredError.
{
  const m = mount();
  m.render(baseState({ id: "r1", type: "reproduction", title: "Repro", steps: [{ instruction: "STEP_ONE" }], run_manifest: { capsule_ref: "cap", command: "python run.py" } }));
  const run = m.$(".controls .run");
  expect(!!run && run.textContent.includes(FR.pane_run), "a run_manifest scene renders the in-pane run button");
  expect(!m.$all(".controls button").some((b: any) => b.textContent.includes(FR.pane_continue)), "a run_manifest scene renders no Continue button");
  m.click(run);
  expect(posted(m, "run").length === 1 && !posted(m, "respond").length, "the run button posts {type:'run'} and no ack");
  expect(m.text().includes(FR.pane_run_note), "the run scene says where the capsule runs and when the lesson moves on");
}

// --- 5) calibration: the actionable band is shown ONCE, in the feedback of the relevant answer ------
// Changed (VSC-9): calibration used to repeat on every scene header; it now appears in the feedback card
// of an answer on that concept, and never in the next scene's header.
{
  const withSur = mount();
  answered(withSur, quiz("q1", "Quiz Un"), { id: "n1", type: "concept", title: "Suite", markdown: "x" },
    { correct: true, feedback: "Bien vu." },
    { nextExtra: { calibration: [{ concept_id: "c-q1", band: "sur", message: "CALIB_SUR_MSG" }, { concept_id: "c-other", band: "sous", message: "CALIB_OTHER_MSG" }] } });
  expect(withSur.text().includes("CALIB_SUR_MSG"), "calibration 'sur' verdict is shown in the feedback of that concept's answer");
  expect(!!withSur.$(".feedback-step .calib-sur"), "calibration card carries the band class");
  expect(!withSur.text().includes("CALIB_OTHER_MSG"), "another concept's calibration is not shown with this answer");
  withSur.click(withSur.$(".feedback-step .continue"));
  expect(!withSur.text().includes("CALIB_SUR_MSG"), "calibration is not repeated in the next scene's header");

  const onlyBien = mount();
  answered(onlyBien, quiz("q1", "Quiz Un"), { id: "n1", type: "concept", title: "Suite", markdown: "x" },
    { correct: true }, { nextExtra: { calibration: [{ concept_id: "c-q1", band: "bien", message: "CALIB_BIEN_MSG" }] } });
  expect(!onlyBien.text().includes("CALIB_BIEN_MSG"), "calibration 'bien' verdict is suppressed (non-actionable)");
}

// --- 6) forget control: present on every scene, posts {type:'end'} --------------------------------
{
  const m = mount();
  m.render(baseState({ type: "concept", title: "C", markdown: "x" }));
  const forgetBtn = m.$(".forget");
  expect(!!forgetBtn, "every scene shows the 'M'oublier' (forget) control");
  expect(!!forgetBtn?.closest("details.pane-menu"), "the forget control sits in the header's overflow menu (VSC-9)");
  m.click(forgetBtn);
  expect(!!m.sent.find((x) => x.type === "end"), "forget posts {type:'end'}");
}

// --- 7) per-answer confidence tap: the tapped 0-4 rides on the submitted input -------------------
{
  // quiz: tap confidence 3, then choose b → the respond input carries confidence 3
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "?", choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }] }));
  const confBtns = m.$all(".confrow .conf");
  expect(confBtns.length === 5, `quiz renders a 0-4 confidence tap (got ${confBtns.length})`);
  m.click(confBtns[3]);                              // confidence = 3
  choose(m, 1);                                      // choose b, then submit (VSC-8)
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.kind === "quiz_choice" && r.input?.choiceId === "b" && r.input?.confidence === 3,
    "quiz submit carries the tapped confidence");
}
{
  // free-text: tap confidence 1, then submit → the input carries confidence 1
  const m = mount();
  m.render(baseState({ type: "spot_the_flaw", title: "F", flawed_content: "FLAWED" }));
  expect(m.$all(".confrow .conf").length === 5, "free-text renders a 0-4 confidence tap");
  m.click(m.$all(".confrow .conf")[1]);              // confidence = 1
  const ta = m.$("textarea"); fill(ta, "mes erreurs");
  m.click(m.$(".controls .primary"));
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.kind === "flaw_report" && r.input?.confidence === 1, "free-text submit carries the tapped confidence");
}
{
  // not tapping → the input has NO confidence field (optional, omitted)
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "?", choices: [{ id: "a", text: "A" }] }));
  choose(m, 0);
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.confidence === undefined, "no tap → no confidence on the submitted input");
}
{
  // VSC-3: the confidence tap is a radiogroup whose radios expose their checked state
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "?", choices: [{ id: "a", text: "A" }] }));
  const group = m.$(".confrow");
  const radios = m.$all(".confrow .conf");
  expect(group?.getAttribute("role") === "radiogroup" && !!group?.getAttribute("aria-labelledby"), "the confidence row is a labelled radiogroup");
  expect(radios.every((b: any) => b.getAttribute("role") === "radio" && b.getAttribute("aria-checked") === "false"), "each confidence value is a radio, unchecked by default");
  m.click(radios[2]);
  expect(radios[2].getAttribute("aria-checked") === "true" && radios.filter((b: any) => b.getAttribute("aria-checked") === "true").length === 1, "tapping a value checks exactly that radio");
  m.click(radios[2]);
  expect(radios[2].getAttribute("aria-checked") === "false", "tapping it again clears the optional rating");
}

// --- 8) verdict deck (D1): per-token flag/sound toggles → posts flaw_verdicts, replaces free text ---
{
  const m = mount();
  m.render(baseState({
    type: "spot_the_flaw", title: "Audit",
    flawed_content: "AI_READING_TEXT",
    deck: [
      { token: "d0", text: "CLAIM_ZERO" },
      { token: "d1", text: "CLAIM_ONE" },
      { token: "d2", text: "CLAIM_TWO" },
    ],
  }));
  const page = m.text();
  expect(page.includes("AI_READING_TEXT"), "verdict deck still shows the AI reading (flawed_content)");
  const rows = m.$all(".deck-row");
  expect(rows.length === 3, `verdict deck renders one row per token (got ${rows.length})`);
  expect(page.includes("CLAIM_ZERO") && page.includes("CLAIM_TWO"), "verdict deck shows each claim's text");
  // the free-text flaw_report textarea is REPLACED by the deck (one unambiguous graded path)
  expect(!m.$(".controls textarea"), "verdict deck replaces the free-text flaw_report textarea");
  // flag d0 and d2, leave d1 → submit posts flaw_verdicts with the per-token booleans
  const flags = m.$all(".deck-row .deck-flag");
  m.click(flags[0]); m.click(flags[2]);
  m.click(m.$(".deck-submit"));
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.kind === "flaw_verdicts", `verdict deck posts kind flaw_verdicts (got ${r?.input?.kind})`);
  const vs = (r && r.input && r.input.verdicts) || [];
  expect(vs.length === 3, `verdict deck posts one verdict per token (got ${vs.length})`);
  const byTok = Object.fromEntries(vs.map((v: any) => [v.token, v.flagged]));
  expect(byTok.d0 === true && byTok.d1 === false && byTok.d2 === true, "verdict deck carries the per-token flag/sound decisions");
  // LEAK GUARD: the client only ever received {token,text}; no ground-truth marker may reach the DOM
  expect(!page.includes("model_") && !page.includes("sound_claims"), "verdict deck leaks no answer key to the DOM");
}
// --- 8b) verdict-deck confidence pairing: the tapped confidence rides on the flaw_verdicts input ----
{
  const m = mount();
  m.render(baseState({ type: "spot_the_flaw", title: "Audit", flawed_content: "X", deck: [{ token: "d0", text: "C0" }] }));
  expect(m.$all(".deck .confrow .conf").length === 5, "verdict deck renders a 0-4 confidence tap");
  m.click(m.$all(".deck .confrow .conf")[2]);        // confidence = 2
  m.click(m.$(".deck-submit"));
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.kind === "flaw_verdicts" && r.input?.confidence === 2,
    "verdict deck submit carries the tapped confidence (unites over-trust + over-distrust axes)");
}
// --- 8c) a spot_the_flaw scene WITHOUT a deck still renders the free-text flaw_report path ----------
{
  const m = mount();
  m.render(baseState({ type: "spot_the_flaw", title: "F", flawed_content: "FLAWED" }));
  expect(!!m.$(".controls textarea") && !m.$(".deck"), "no deck → free-text flaw_report path is unchanged");
}

// --- 9) gate card: a withhold (replay) becomes a calm dimension-level card, not the raw token --------
// Changed (VSC-2): the card used to print `explanation_short`; on a withhold extension.ts fills it with
// the rule's ACTION REASON CODE (`errors_threshold`, seen on screen in the 2026-10-30 map, shot1.png).
// The card now speaks only the pane's own learner copy, so the reason string must NOT appear.
{
  const m = mount();
  m.render(baseState({ type: "concept", title: "C", markdown: "x" },
    { explanation: { rule_id: "replay", explanation_short: "GATE_REASON_TEXT" } }));
  expect(!!m.$(".gate.gate-replay"), "a replay withhold renders a gate card (not the terse adapt banner)");
  expect(m.text().includes("On refait cette étape ensemble"), "gate card shows the calm, non-punitive framing");
  expect(m.text().includes(FR.pane_nav_replay_why), "gate card explains the replay in learner words");
  expect(!m.text().includes("GATE_REASON_TEXT"), "gate card never prints the engine's reason string");
  expect(!m.$(".adapt"), "withhold does not also render the raw ⟳ rule_id banner");
}
{
  // Changed (VSC-2): a NORMAL adaptation rationale (a real rule id, not a withhold kind) used to keep a
  // terse « ⟳ rule-042 — … » banner; a normal advance now shows nothing, and never the rule id.
  const m = mount();
  m.render(baseState({ type: "concept", title: "C", markdown: "x" },
    { explanation: { rule_id: "rule-042", explanation_short: "why this scene" } }));
  expect(!m.$(".adapt") && !m.$(".gate") && !m.$(".nav-card"), "a non-withhold adaptation rationale renders no banner or card");
  expect(!m.text().includes("rule-042"), "a non-withhold adaptation rationale never shows the rule id");
}

// --- 10) first-run states: loading + error messages render into the pane (never a silent blank) --------
{
  const m = mount();
  m.render(baseState({ type: "concept", title: "C", markdown: "x" })); // draw something first
  m.post({ type: "loading", message: "Chargement de la leçon…" });
  expect(!!m.$(".loading") && m.text().includes("Chargement de la leçon"), "a loading message renders a .loading placeholder");
  m.post({ type: "error", message: "BOOM_REASON" });
  expect(!!m.$(".error-pane") && m.text().includes("BOOM_REASON"), "an error message renders an .error-pane with the reason");
  expect(!m.$(".scene-head"), "the error state replaces the scene (no stale scene left behind)");
}

// --- 11) bundle locale controls the artifact-pane verdict chrome -------------------------------------
// Changed (VSC-1): an ungraded acknowledgement (intro/concept « Continuer ») no longer prints « Answer
// recorded » under the next title — it goes straight to the next scene; graded verdicts show in their own
// feedback step, whose chip says « Not yet » (the plan's « À revoir ») instead of « Incorrect ».
{
  const recorded = mount();
  recorded.render(baseState({ type: "concept", title: "NEXT_TITLE", markdown: "x" },
    { locale: "en", verdict: { graded: false } }));
  expect(!recorded.text().includes("Answer recorded") && !recorded.$(".feedback-step"), "locale en: an ungraded ack shows no feedback step and no 'Answer recorded'");
  expect(recorded.$(".scene-title")?.textContent === "NEXT_TITLE", "an ungraded ack goes straight to the next scene");

  const correct = mount();
  correct.render(baseState({ type: "concept", title: "C", markdown: "x" },
    { locale: "en", verdict: { graded: true, correct: true } }));
  expect(correct.text().includes("Correct"), "locale en renders the correct verdict in English");

  const incorrect = mount();
  incorrect.render(baseState({ type: "concept", title: "C", markdown: "x" },
    { locale: "en", verdict: { graded: true, correct: false } }));
  expect(incorrect.text().includes(EN.pane_incorrect) && !incorrect.text().includes(FR.pane_incorrect), "locale en renders the incorrect verdict in English");
}

// --- 12) full Markdown, prose math, sanitization, and code highlighting -------------------------------
{
  const markdown = [
    "Deux lois :",
    "- la période T",
    "- le demi-grand axe *a*",
    "",
    "La relation est $T^2 \\propto a^3$.",
    "",
    "```python",
    "import pandas as pd  # charge",
    "x = \"a\"",
    "```",
    "",
    "Voir [OpenStax](https://openstax.org) et ![fig](plots/x.png)",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "$$E = mc^2$$",
  ].join("\n");
  const m = mount(true);
  m.render(baseState({ type: "concept", title: "Markdown", markdown }));
  expect(m.$all(".prose ul > li").length === 2, "Markdown renders both bullet-list items");
  expect(m.$(".prose em")?.textContent === "a", "Markdown renders italic emphasis");
  expect(!!m.$(".prose .katex"), "inline prose math renders through KaTeX");
  expect(!!m.$(".prose pre code[data-lang='python']"), "fenced code keeps python as data-lang");
  expect(!!m.$(".prose pre code .tok-kw"), "fenced Python highlights a keyword");
  expect(!!m.$(".prose pre code .tok-str"), "fenced Python highlights a string");
  expect(!!m.$(".prose pre code .tok-com"), "fenced Python highlights a comment");
  expect(!!m.$(".prose a[href='https://openstax.org'][target='_blank']"), "safe links open through the host");
  // T8: the French placeholder's colon now holds to its word with a no-break space (U+00A0).
  expect(m.text().includes("image\u00a0: plots/x.png (non résolue)"), "relative Markdown images render a visible French placeholder");
  expect(m.$all(".prose table td").length === 2, "Markdown renders both table cells");
  expect(!!m.$(".prose .katex-display"), "display prose math renders through KaTeX");
}
{
  const m = mount(true);
  m.render(baseState({
    type: "concept",
    title: "Sanitize",
    markdown: "<img src=x onerror=alert(1)>\n<script>alert(2)</script>\n[x](javascript:alert(1))\nA & B",
  }));
  expect(!m.$(".prose script"), "raw Markdown HTML cannot create a script element");
  expect(!m.$(".prose img[onerror]"), "raw Markdown HTML cannot create an event-handler image");
  expect(!m.$(".prose a[href^='javascript:']"), "sanitizer removes javascript links");
  expect(m.text().includes("<script>") && m.text().includes("A & B"), "raw angle brackets and ampersands remain literal text");
}
{
  const chemistry = mount(true);
  chemistry.render(baseState({ type: "concept", title: "Chemistry", markdown: "Eau : $\\ce{H2O}$." }));
  expect(!!chemistry.$(".prose .katex"), "mhchem prose renders without throwing");

  const currency = mount(true);
  currency.render(baseState({ type: "concept", title: "Price", markdown: "Cela coûte 5$ et 10$." }));
  expect(currency.text().includes("coûte 5$ et 10$") && !currency.$(".prose .katex"), "currency dollar signs remain plain text");

  // TeX must reach KaTeX untouched by marked's escape/emphasis pass (annotation = the TeX it got).
  const texOf = (m: any) => m.$all(".prose annotation").map((a: any) => a.textContent);
  const edges = mount(true);
  edges.render(baseState({ type: "concept", title: "Edges", markdown: [
    "Ensemble $\\{a, b\\}$ et produit $a*b*c$.",
    "",
    "Soit \\[E = mc^2\\] puis \\(x_1 + y_1\\).",
    "",
    "$$\\begin{pmatrix}1\\\\2\\end{pmatrix}$$",
    "",
    "Prix : $5 et $10.",
    "",
    "Soit 5$ et 10$.",
  ].join("\n") }));
  const tex = texOf(edges);
  expect(tex.includes("\\{a, b\\}"), "escaped braces reach KaTeX untouched");
  expect(tex.includes("a*b*c"), "asterisks inside math are not emphasis");
  expect(tex.includes("E = mc^2") && !!edges.$(".prose .katex-display"), "\\[…\\] renders as display math");
  expect(tex.includes("x_1 + y_1"), "\\(…\\) renders as inline math");
  expect(tex.includes("\\begin{pmatrix}1\\\\2\\end{pmatrix}"), "double backslash (matrix row) survives");
  expect(edges.text().includes("$5 et $10") && edges.text().includes("5$ et 10$") && tex.length === 5, "currency dollars in both conventions stay text");

  const fallback = mount("marked");
  fallback.render(baseState({ type: "concept", title: "Fallback", markdown: "Math $x^2$ puis $$y$$." }));
  expect(fallback.$all(".prose .imath").length === 2, "missing KaTeX leaves prose math in imath fallbacks");
}
{
  const structure = mount(true);
  structure.render(baseState({ type: "concept", title: "Structure", markdown: "ligne un\nligne deux\n\n1. haut\n   1. imbriqué\n2. bas" }));
  expect(!!structure.$(".prose p br"), "breaks:true renders a single prose newline as br");
  expect(!!structure.$(".prose ol ol li"), "Markdown renders nested ordered lists");

  const unresolved = mount(true);
  unresolved.render(baseState({ type: "concept", title: "Image", markdown: "![plot](plots/y.png)" }, { locale: "en" }));
  expect(unresolved.text().includes("image: plots/y.png (unresolved)"), "relative Markdown images use the English catalogue caption");
}
{
  const python = mount(true);
  python.render(baseState({ type: "concept", title: "Code", markdown: "x" }, {
    scene_assets: [{ kind: "code", title: "sample.py", language: "python", payload: "def f():\n    # note\n    return \"ok\"" }],
  }));
  expect(!!python.$(".asset-code .tok-kw"), "code assets highlight Python keywords");
  expect(!!python.$(".asset-code .tok-str"), "code assets highlight Python strings");
  expect(!!python.$(".asset-code .tok-com"), "code assets highlight Python comments");

  const sql = mount(true);
  sql.render(baseState({ type: "concept", title: "SQL", markdown: "x" }, {
    scene_assets: [{ kind: "code", title: "query.sql", language: "sql", payload: "SELECT count(*) FROM samples;" }],
  }));
  expect(sql.$(".asset-code .tok-kw")?.textContent === "SELECT", "code assets highlight SQL SELECT");

  for (const sample of [
    { language: "typescript", payload: "const n = 3; // count", keyword: "const" },
    { language: "bash", payload: "if true; then echo \"ok\"; fi # branch", keyword: "if" },
    { language: "json", payload: "{\"count\": 3, \"ready\": true}", keyword: "true" },
  ]) {
    const supported = mount(true);
    supported.render(baseState({ type: "concept", title: sample.language, markdown: "x" }, {
      scene_assets: [{ kind: "code", title: sample.language, language: sample.language, payload: sample.payload }],
    }));
    expect(supported.$(".asset-code .tok-kw")?.textContent === sample.keyword, `code assets highlight ${sample.language}`);
  }

  const unknown = mount(true);
  unknown.render(baseState({ type: "concept", title: "Unknown", markdown: "x" }, {
    scene_assets: [{ kind: "code", title: "plain", language: "unknown", payload: "<script>alert(1)</script>" }],
  }));
  expect(!unknown.$(".asset-code script") && unknown.text().includes("<script>"), "unknown code stays escaped plain text");
}

// --- 13) self-authored lesson: the host's authoring.notice as a sober banner above the scene ---------
{
  // the judge-absent French notice: what an offline host (no judge model) sends for a self-study lesson
  const notice = "Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant " +
    "(livre ouvert). Sans juge modèle, les scènes de production donnent un retour par mots-clés sans " +
    "évaluation certifiée ; seules les reproductions exécutées portent une évaluation externe.";
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "?", choices: [{ id: "a", text: "A" }] },
    { authoring: { mode: "self_study", author_is_learner: true, validated: false, judge: false, notice } }));
  const banners = m.$all(".authoring-notice");
  const banner = m.$(".authoring-notice");
  expect(banners.length === 1, `a self-study lesson renders one authoring banner (got ${banners.length})`);
  expect(banner?.getAttribute("role") === "note", "the authoring banner is a role=note");
  expect(banner?.textContent === notice, "the authoring banner shows the host's notice verbatim");
  const head = m.$(".scene-head");
  expect(!!head && !!banner && !!(banner.compareDocumentPosition(head) & m.win.Node.DOCUMENT_POSITION_FOLLOWING), "the authoring banner sits above the scene");
  expect(m.$all(".controls .choice").length === 1, "the scene still renders under the banner");
  // VSC-9: after the first screen the notice stays one click away instead of repeating in full.
  m.render(baseState({ id: "n2", type: "concept", title: "Deux", markdown: "x" },
    { authoring: { mode: "self_study", author_is_learner: true, validated: false, judge: false, notice } }));
  const compact = m.$("details.authoring-notice-compact");
  expect(!m.$(".authoring-notice") && !!compact && !compact.open && compact.textContent.includes(notice), "later scenes keep the notice in a closed disclosure");
}
{
  // the demo is a teacher lesson: the host sends authoring with notice null → no banner
  const demo = mount();
  demo.render(baseState({ type: "concept", title: "C", markdown: "x" },
    { authoring: { mode: "teacher", author_is_learner: false, validated: true, judge: false, notice: null } }));
  expect(!demo.$(".authoring-notice"), "a teacher lesson (the demo) renders no authoring banner");
  // an older server sends no authoring at all → no banner either
  const legacy = mount();
  legacy.render(baseState({ type: "concept", title: "C", markdown: "x" }));
  expect(!legacy.$(".authoring-notice"), "a presentation without authoring renders no banner");
}

// --- 14) pending actions: a double click posts once, disables controls, and recovers inline ----------
// Changed (VSC-8): the double click is on the « Valider » button (choices no longer submit), and the
// disabled control checked is the choice's radio input (a card is a <label>, which has no `disabled`).
{
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "?", choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }] }));
  const inputs = m.$all(".controls .choice input") as HTMLInputElement[];
  const choice = inputs[0] ?? null;
  if (inputs[1]) inputs[1].disabled = true;
  m.click(m.$all(".controls .choice")[0]);
  const validate = m.$(".controls .validate");
  m.click(validate); m.click(validate);
  expect(m.sent.filter((message) => message.type === "respond").length === 1, "a rapid double click posts one response");
  expect(choice?.disabled === true, "scene controls are disabled while an action is pending");
  expect(m.$("#pane")?.getAttribute("aria-busy") === "true", "the pane exposes its pending state to assistive technology");
  expect(m.text().includes("Envoi de ta réponse"), "the pending state tells the learner what is happening");

  m.post({ type: "action_error", message: "NETWORK_DOWN" });
  expect(!!m.$(".scene-head"), "an action error preserves the current scene and learner context");
  expect(choice?.disabled === false, "controls are re-enabled after an action error");
  expect(inputs[1]?.disabled === true, "settling an action preserves controls that were disabled beforehand");
  expect(m.text().includes("NETWORK_DOWN"), "an action error is visible inside the pane");
}

// --- 15) fatal startup error: explain the recovery path instead of showing a bare warning -----------
{
  const m = mount();
  m.post({ type: "error", message: "SERVICE_FAILED" });
  expect(m.text().includes("Connexion interrompue"), "a fatal error has a meaningful heading");
  // The log channel's name is the same in every display language; the French text quotes no English UI label
  // (VSC-5) and says the retry in words, since the palette title depends on the editor's language.
  expect(m.text().includes("Studium — lesson-mcp") && m.text().includes("rouvre la leçon"), "a fatal error names the log channel and the retry path");
  expect(!/\b(?:View|Output|Open Lesson)\b/.test(m.text()), "the French recovery hint quotes no English UI label");
}

// --- 16) lifecycle messages keep the lesson locale and self-study notice ----------------------------
{
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "?", choices: [{ id: "a", text: "A" }] }, {
    locale: "en", authoring: { notice: "Self-authored lesson notice" },
  }));
  choose(m, 0);
  expect(m.text().includes("Sending your response…"), "pending feedback follows the English lesson locale");
  expect(m.win.document.documentElement.lang === "en", "contextual help follows the lesson language");
  expect(m.$(".authoring-notice")?.textContent === "Self-authored lesson notice", "pending actions retain the self-study notice");
  m.post({ type: "action_error", message: "RETRY" });
  expect(m.text().includes("Action failed · RETRY"), "recoverable errors follow the English lesson locale");
  expect(m.$(".controls .choice input")?.disabled === false, "localized errors still release the action gate");
}

// --- 17) VSC-1: feedback is its own step, titled with the ANSWERED scene ------------------------------
{
  const m = mount(true);
  answered(m, quiz("qA", "Quiz A"), { id: "cB", type: "concept", title: "Concept B", markdown: "corps B" },
    { correct: false, feedback: "Le **modèle** dit X" });
  const step = m.$(".feedback-step");
  expect(!!step, "a graded verdict opens a feedback step");
  expect(m.$(".feedback-step .scene-title")?.textContent === "Quiz A", "the feedback step is titled with the answered scene, not the next one");
  expect(!m.text().includes("Concept B") && !m.text().includes("corps B"), "the next scene is not shown under the feedback");
  const card = m.$(".feedback-card");
  expect(card?.getAttribute("data-verdict") === "incorrect" && card.textContent.includes(FR.pane_incorrect), "a wrong quiz answer gets the « À revoir » chip");
  expect(m.$(".feedback-body strong")?.textContent === "modèle" && !m.text().includes("**"), "the feedback is rendered as Markdown, never as literal asterisks");
  expect(m.live().includes(FR.pane_incorrect), "the verdict is announced in the live region");
  expect(m.win.document.activeElement === m.$(".feedback-step .scene-title"), "focus moves to the feedback title");
  const sentBefore = m.sent.length;
  m.click(m.$(".feedback-step .continue"));
  expect(m.$(".scene-title")?.textContent === "Concept B" && !m.$(".feedback-step"), "« Continuer » shows the next scene");
  expect(m.sent.length === sentBefore, "« Continuer » is local to the pane: the next scene was already delivered");
  expect(m.win.document.activeElement === m.$(".scene-title"), "focus moves to the new scene title");
  expect(m.live().includes("Concept B"), "the new step is announced");
}
{
  const m = mount();
  answered(m, quiz("qA", "Quiz A"), { id: "cB", type: "concept", title: "B", markdown: "x" }, { correct: true, feedback: "Oui." });
  expect(m.$(".feedback-card")?.getAttribute("data-verdict") === "correct" && m.text().includes(FR.pane_correct), "a right quiz answer gets the « Juste » chip");
}
{
  // R4: a free-text answer nobody measured (no `correct`) never reads as right or wrong
  const m = mount();
  answered(m, { id: "eA", type: "explain_back", title: "Explique A", prompt: "?" }, { id: "cB", type: "concept", title: "B", markdown: "x" },
    { feedback: "Compare avec les points clés." });
  const card = m.$(".feedback-card");
  expect(card?.getAttribute("data-verdict") === "keyword-only", "an unmeasured production answer is marked keyword-only");
  expect(m.text().includes(FR.pane_uncertified) && m.text().includes(FR.pane_not_certified) && m.text().includes(FR.pane_uncertified_why), "it says no judge assessed it");
  expect(!m.text().includes(FR.pane_correct) && !m.text().includes(FR.pane_incorrect), "it claims neither right nor wrong");
}
{
  // deck: a measured partial result names the counts, not a binary « Faux »
  const m = mount();
  answered(m, { id: "fA", type: "spot_the_flaw", title: "Audit A", flawed_content: "x", deck: [{ token: "d0", text: "c" }] },
    { id: "cB", type: "concept", title: "B", markdown: "x" },
    { correct: false, detail: { caught: 1, planted: 3, false_positives: 1, sound_total: 2 } });
  const card = m.$(".feedback-card");
  expect(card?.getAttribute("data-verdict") === "partial" && card.textContent.includes("1/3"), "a partly caught deck shows « Partiel · 1/3 »");
  expect(m.text().includes(ph("pane_deck_found", { caught: 1, planted: 3 }, "fr")) && m.text().includes(ph("pane_deck_false_alarms", { count: 1, total: 2 }, "fr")), "the deck detail names flaws found and false alarms");
}
{
  // an ungraded ack (intro/concept/meta) goes straight on: no step, no « Réponse enregistrée »
  const m = mount();
  m.render(baseState({ id: "i0", type: "intro", title: "Intro", markdown: "x" }));
  m.render(baseState({ id: "c1", type: "concept", title: "Concept 1", markdown: "x" }, { verdict: { scene_id: "i0", graded: false, signal: "scene_completed" } }));
  expect(!m.$(".feedback-step") && m.$(".scene-title")?.textContent === "Concept 1", "an ack verdict shows the next scene directly");
}
{
  // same-item replay: the feedback restates the answer, so it waits until the retry is answered
  const m = mount();
  answered(m, quiz("qA", "Quiz A"), quiz("qA", "Quiz A"), { correct: false, feedback: "ANSWER_REVEAL 30 neutrons" });
  expect(!!m.$(".feedback-step") && !m.text().includes("ANSWER_REVEAL"), "a replay of the same item withholds the answer-bearing feedback");
  expect(m.text().includes(FR.pane_feedback_withheld), "it says the detailed feedback comes after the new answer");
  m.click(m.$(".feedback-step .continue"));
  expect(m.$all(".controls .choice").length === 3 && !m.text().includes("ANSWER_REVEAL"), "the retried question shows without its answer");
  expect(!!m.$(".gate.gate-replay"), "the retried question carries the calm replay card");
}
{
  // model answer and key points, when the verdict carries them, are collapsed
  const m = mount();
  answered(m, { id: "eA", type: "explain_back", title: "Explique A", prompt: "?" }, { id: "cB", type: "concept", title: "B", markdown: "x" },
    { feedback: "Compare.", model_answer: "MODEL_TEXT", key_points: ["POINT_ONE", "POINT_TWO"] });
  const details = m.$("details.model-answer");
  expect(!!details && !details.open && details.textContent.includes("MODEL_TEXT"), "the model answer sits in a closed disclosure");
  expect(m.$("details.model-answer summary")?.textContent === FR.pane_model_answer, "the disclosure is labelled « Voir la réponse modèle »");
  expect(m.text().includes("POINT_ONE") && m.text().includes("POINT_TWO"), "the key points are listed");
}
{
  // T2 (integration tail): the points a judge found missing are marked in the list, in words (not colour
  // alone); the list is labelled by what it holds; feedback and reference each appear once, and the
  // host's chat text (display_markdown) is never rendered next to them.
  const m = mount(true);
  answered(m, { id: "eA", type: "explain_back", title: "Explique A", prompt: "?" }, { id: "cB", type: "concept", title: "B", markdown: "x" },
    { correct: false, feedback: "1/2 points clés couverts", key_points: ["POINT_ONE", "POINT_TWO"], key_points_missing: ["POINT_TWO"],
      model_answer: "MODEL_TEXT", reference_kind: "key_points",
      display_markdown: "CHAT_TEXT 1/2 points clés couverts POINT_ONE POINT_TWO MODEL_TEXT" });
  const items = m.$all(".key-points li");
  const missing = items.filter((li: Element) => li.getAttribute("data-missing") === "true");
  expect(items.length === 2 && missing.length === 1 && missing[0].textContent.includes("POINT_TWO"), "the point the judge found missing is the one marked");
  expect(!!missing[0]?.querySelector(".key-point__missing") && missing[0].textContent.includes(FR.pane_key_point_missing),
    "the mark is written out (« manquant selon le juge »), not a colour alone");
  expect(!items[0]?.textContent.includes(FR.pane_key_point_missing), "a covered point carries no mark");
  expect(m.$(".key-points .st-eyebrow")?.textContent === FR.pane_key_points, "a key-point list is labelled « Points clés »");
  const text = m.text();
  expect(text.split("POINT_TWO").length === 2 && text.split("POINT_ONE").length === 2, "each key point appears once");
  expect(text.split("1/2 points clés couverts").length === 2, "the feedback appears once");
  expect(!text.includes("CHAT_TEXT"), "the host's chat text is not rendered in the pane");
}
{
  const m = mount();
  answered(m, { id: "fA", type: "spot_the_flaw", title: "Audit A", flawed_content: "x" }, { id: "cB", type: "concept", title: "B", markdown: "x" },
    { key_points: ["FLAW_ONE"], model_answer: "CORRECTION_TEXT", reference_kind: "planted_flaws" });
  expect(m.$(".key-points .st-eyebrow")?.textContent === FR.pane_planted_flaws, "an audit's list is labelled as the planted flaws");
  expect(m.$("details.model-answer summary")?.textContent === FR.pane_model_correction, "an audit's model answer is its model correction");
  expect(!m.$(".key-points [data-missing]"), "nothing is marked missing when no judge measured coverage");
}
{
  const m = mount();
  answered(m, { id: "kA", type: "ai_critique", title: "Critique A", rubric: {} }, { id: "cB", type: "concept", title: "B", markdown: "x" },
    { key_points: ["CLAIM_ONE (FLAW)"], reference_kind: "flawed_claims" }, { firstExtra: { locale: "en" }, nextExtra: { locale: "en" } });
  expect(m.$(".key-points .st-eyebrow")?.textContent === EN.pane_flawed_claims, "a critique's list is labelled as the claims that hid a flaw (en)");
  expect(m.text().includes("CLAIM_ONE (FLAW)") && !m.$("details.model-answer"), "its claims are listed, with no model answer");
  expect(FR.pane_flawed_claims !== FR.pane_planted_flaws && FR.pane_flawed_claims !== FR.pane_key_points, "the three labels differ");
}

{
  // W2: the sources a scene cites are shown with the feedback, after the answer, never before it
  const m = mount();
  const sources = [{ title: "OpenStax Chemistry", quote: "SOURCE_QUOTE", url: "https://openstax.org/c" }, { title: "Bad link", url: "javascript:alert(1)" }];
  m.render(baseState(quiz("qA", "Quiz A"), { sources }));
  expect(!m.text().includes("SOURCE_QUOTE"), "a cited source is not shown before the answer");
  m.render(baseState({ id: "cB", type: "concept", title: "B", markdown: "x" }, { verdict: { scene_id: "qA", graded: true, signal: "answer_submitted", correct: true }, sources }));
  expect(m.text().includes("SOURCE_QUOTE") && !!m.$(".feedback-sources a[href='https://openstax.org/c']"), "the feedback cites the source with its quote and link");
  expect(!m.$(".feedback-sources a[href^='javascript:']") && m.text().includes("Bad link"), "an unsafe source link stays plain text");
}

// --- 18) C4: self-rating buttons when the transition asks for one -------------------------------------
{
  const m = mount();
  const grades = ["again", "hard", "good", "easy"];
  answered(m, { id: "eA", type: "explain_back", title: "Explique A", prompt: "?" }, { id: "cB", type: "concept", title: "B", markdown: "x" },
    { feedback: "Compare." }, { nextExtra: { self_rating: { requested: true, grades } } });
  const buttons = m.$all(".self-rating button[data-grade]");
  expect(buttons.length === 4 && grades.every((g, i) => buttons[i].getAttribute("data-grade") === g), "one self-rating button per offered grade, in order");
  expect(buttons.map((b: any) => b.textContent).join("|") === grades.map((g) => FR["pane_grade_" + g as keyof typeof FR]).join("|"), "grades carry learner words, not FSRS codes");
  expect(m.text().includes(FR.pane_self_rating_scope), "the pane says self-rating sets the review date, never mastery");
  expect(m.$(".feedback-card")?.getAttribute("data-verdict") === "keyword-only" && !m.text().includes(FR.pane_correct) && !m.text().includes(FR.pane_incorrect),
    "an answer the learner rates is marked unmeasured, never right or wrong");
  m.click(buttons[2]);
  const rate = posted(m, "rateRecall");
  expect(rate.length === 1 && rate[0].sceneId === "eA" && rate[0].grade === "good", "a grade posts {type:'rateRecall', sceneId, grade} for the ANSWERED scene");
  expect(buttons.every((b: any) => b.disabled) && buttons[2]?.getAttribute("aria-pressed") === "true", "one rating per answer: the grades lock and the chosen one is pressed");
  m.click(buttons[3]);
  expect(posted(m, "rateRecall").length === 1, "a second grade is not sent");
  m.post({ type: "recall_rated", sceneId: "eA", grade: "good" });
  expect(m.text().includes(ph("pane_self_rating_done", { grade: FR.pane_grade_good }, "fr")), "the host's confirmation is shown");
  expect(!posted(m, "respond").length, "rating does not advance the lesson");
}
{
  // a failed rating can be retried
  const m = mount();
  answered(m, { id: "eA", type: "explain_back", title: "E", prompt: "?" }, { id: "cB", type: "concept", title: "B", markdown: "x" },
    {}, { nextExtra: { self_rating: { requested: true, grades: ["again", "good"] } } });
  m.click(m.$all(".self-rating button[data-grade]")[1]);
  m.post({ type: "action_error", message: "RATE_FAILED" });
  expect(m.$all(".self-rating button[data-grade]").every((b: any) => !b.disabled), "after an error the grades unlock for a retry");
  expect(m.text().includes("RATE_FAILED"), "the rating error is visible");
}
{
  // the request may also ride on the verdict itself; absent → no buttons
  const nested = mount();
  answered(nested, { id: "eA", type: "explain_back", title: "E", prompt: "?" }, { id: "cB", type: "concept", title: "B", markdown: "x" },
    { self_rating: { requested: true, grades: ["again", "hard", "good", "easy"] } });
  expect(nested.$all(".self-rating button[data-grade]").length === 4, "a self_rating carried on the verdict is honoured");
  const none = mount();
  answered(none, quiz("qA", "Q"), { id: "cB", type: "concept", title: "B", markdown: "x" }, { correct: true });
  expect(!none.$(".self-rating"), "no self_rating request → no grade buttons");
}

// --- 19) VSC-2: no engine internals in the learner UI -------------------------------------------------
{
  const SCENE_TYPES = ["intro", "concept", "quiz", "meta_checkpoint", "reproduction", "ai_critique", "discussion",
    "spot_the_flaw", "explain_back", "comparison", "summary_audit", "prompt_practice", "communication_sim"];
  for (const type of SCENE_TYPES) {
    const m = mount();
    m.render(baseState({ id: "s-" + type, type, title: "T", markdown: "x", question: "?", choices: [{ id: "a", text: "A" }], prompt: "p" },
      { explanation: { rule_id: "rule_2err_replay_concept", explanation_short: "errors_threshold" } }));
    const text = m.text();
    expect(!text.includes(type) && !text.includes(type.toUpperCase()), `[${type}] the raw scene-type id is never shown`);
    expect(!text.includes("rule_") && !text.includes("errors_threshold"), `[${type}] no rule id or reason code is shown`);
    const chip = m.$(".scene-type");
    expect(chip?.textContent.includes(FR[("pane_type_" + type) as keyof typeof FR]), `[${type}] the type chip carries the localized label`);
  }
}
{
  // a detour gets a card in words, naming the scene the learner will return to
  const m = mount();
  m.render(baseState(quiz("qA", "Quiz du fer"), { progress: { index: 15, total: 25 } }));
  m.render(baseState({ id: "c3", type: "concept", title: "Rappel", markdown: "x" }, {
    progress: { index: 8, total: 25 },
    navigation: { kind: "remediate", scene_id: "c3", rule_id: "graph_prereq_gate", reason: "x", modulator: "M6", returns_to: "qA" },
  }));
  const card = m.$(".nav-card");
  expect(!!card && card.textContent.includes(FR.pane_nav_detour) && card.textContent.includes("Quiz du fer"), "a detour card names the scene the learner returns to");
  expect(!m.text().includes("graph_prereq_gate"), "the detour card never shows the rule id");
  const plain = mount();
  plain.render(baseState({ id: "c3", type: "concept", title: "C", markdown: "x" }, { navigation: { kind: "advance", scene_id: "c3", rule_id: null, reason: null, modulator: null } }));
  expect(!plain.$(".nav-card") && !plain.$(".gate"), "a plain advance shows no card");
  const skipped = mount();
  skipped.render(baseState({ id: "c9", type: "concept", title: "C", markdown: "x" }, { navigation: { kind: "skip_mastered", scene_id: "c9", rule_id: "graph_skip_mastered", reason: "x", modulator: "M1", skipped_scene_ids: ["a", "b"] } }));
  expect(skipped.text().includes(ph("pane_nav_skip_many", { count: 2 }, "fr")), "a skip says how many steps were passed, in words");
}

// --- 20) VSC-2: the progress rail never runs backwards; a detour is marked -----------------------------
{
  const m = mount();
  const bar = () => m.$(".progress[role='progressbar']");
  m.render(baseState(quiz("q15", "Quinze"), { progress: { index: 15, total: 25 } }));
  expect(bar()?.getAttribute("aria-valuenow") === "15" && bar()?.getAttribute("aria-valuemax") === "25", "the rail exposes the position to assistive technology");
  m.render(baseState({ id: "c8", type: "concept", title: "Huit", markdown: "x" }, { progress: { index: 8, total: 25 } }));
  expect(bar()?.getAttribute("aria-valuenow") === "15", "a detour to an earlier scene does not move the rail back");
  expect(!!m.$(".progress-detour") && !m.text().includes("8/25"), "the detour is marked, and the bundle index is not shown");
  m.render(baseState(quiz("q16", "Seize"), { progress: { index: 16, total: 25 } }));
  expect(bar()?.getAttribute("aria-valuenow") === "16" && !m.$(".progress-detour"), "moving on clears the detour marker");
  expect(m.text().includes(ph("pane_progress", { position: 16, total: 25 }, "fr")), "the rail reads « Étape 16 sur 25 »");
}

// --- 21) VSC-3: accessibility baseline -------------------------------------------------------------------
{
  const m = mount();
  m.render(baseState({ id: "e1", type: "explain_back", title: "Explique", prompt: "?" }));
  const title = m.$(".scene-title");
  expect(title?.getAttribute("tabindex") === "-1" && m.win.document.activeElement === title, "the scene title takes focus after each render");
  const ta = m.$(".controls textarea");
  expect(!!ta?.id && !!m.$(`label[for='${ta.id}']`), "the answer textarea has a visible label");
  expect(m.$("#pane-live")?.getAttribute("aria-live") === "polite" && m.$("#pane-live")?.getAttribute("role") === "status", "a polite live region exists for announcements");
  const q = mount();
  q.render(baseState(quiz("qA", "Quiz A")));
  const radios = q.$all(".controls .choice input[type='radio']");
  expect(radios.length === 3 && !!q.$(".controls fieldset legend"), "quiz choices are native radios in a fieldset with a legend");
  expect(q.$all(".controls .choice")[1]?.textContent.includes("Quatre"), "each choice card carries its text");
}
{
  // 3D, plot and graph-like assets get a text alternative
  const m = mount();
  m.render(baseState({ id: "c1", type: "concept", title: "C", markdown: "x" }, {
    scene_assets: [
      { kind: "plot_spec", title: "Spectre de Balmer", payload: JSON.stringify({ mark: "bar", data: { values: [{ x: "a", y: 1 }, { x: "b", y: 2 }] }, encoding: { x: { field: "x" }, y: { field: "y" } } }) },
      { kind: "mol_3d", title: "Benzène", payload: "6\nbenzene\nC 0 0 0", format: "xyz" },
    ],
  }));
  const plot = m.$(".asset-plot_spec .plot");
  expect(plot?.getAttribute("role") === "img" && (plot.getAttribute("aria-label") || "").includes("Spectre de Balmer"), "a plot has role=img and a label naming it");
  expect(!!m.$(".asset-plot_spec details.plot-data table") && m.$all(".asset-plot_spec details.plot-data td").length === 4, "a plot with data offers a data table");
  const mol = m.$(".asset-mol_3d .mol3d");
  expect(mol?.getAttribute("role") === "img" && (mol.getAttribute("aria-label") || "").includes("Benzène"), "a 3D viewer has role=img and a label naming it");
}
{
  const m = mount(true);
  m.render(baseState({ id: "c1", type: "concept", title: "C", markdown: "x" }, {
    scene_assets: [{
      kind: "equation_latex", title: "Nombre de masse", payload: "A = Z + N",
      legend: [
        { symbol: "A", meaning: "nombre de masse" },
        { symbol: "Z", meaning: "nombre de protons" },
      ],
    }],
  }));
  const legend = m.$(".asset-equation_latex .eq-legend");
  expect(!!legend && legend.textContent.includes("A : nombre de masse") && legend.textContent.includes("Z : nombre de protons"),
    "an equation legend is shown under its formula");
}
{
  // hint: the cost is stated before asking, and the hint is announced when it arrives
  const m = mount();
  m.render(baseState(quiz("qA", "Quiz A")));
  const hint = m.$(".controls .hint-button");
  expect(!!hint && (hint.getAttribute("title") || "").includes(FR.pane_hint_cost), "the hint button states its mastery cost");
  m.click(hint);
  expect(posted(m, "hint").length === 1, "the hint button posts {type:'hint'}");
  m.post({ type: "hint", hint: "HINT_TEXT", remaining: 1 });
  expect(m.$("#hint")?.textContent.includes("HINT_TEXT") && m.$("#hint")?.getAttribute("aria-live") === "polite", "the hint lands in a polite live area");
}

// --- 22) VSC-8: keyboard shortcuts --------------------------------------------------------------------
{
  const m = mount();
  m.render(baseState(quiz("qA", "Quiz A")));
  const validate = m.$(".controls .validate");
  expect(validate?.disabled === true, "« Valider » waits for a choice");
  // Changed (UX-02, WCAG 2.1.4): the keys used to be pressed on the document body; a character shortcut now acts only
  // while focus is inside the choices, so they are pressed on a choice. Outside it they do nothing.
  m.key(null, "b");
  m.key(m.$(".scene-title"), "b");
  m.key(m.$(".controls .hint-button"), "a");
  expect(!m.$all(".controls .choice input").some((i: any) => i.checked), "a letter typed outside the choices picks nothing (heading, hint button, body)");
  const first = m.$all(".controls .choice input")[0];
  m.key(first, "b");
  expect(m.$all(".controls .choice input")[1]?.checked === true && validate?.disabled === false, "the key B selects choice b");
  m.key(m.$all(".controls .choice input")[1], "3");
  expect(m.$all(".controls .choice input")[2]?.checked === true, "the key 3 selects the third choice");
  m.key(m.$all(".controls .choice input")[2], "Enter");
  const r = posted(m, "respond");
  expect(r.length === 1 && r[0].input.choiceId === "c", "Enter on a selected choice submits it");
  expect(m.text().includes(ph("pane_choice_shortcuts", { letters: "A–C", count: 3 }, "fr")), "the shortcuts are written under the choices");
  // UX-02: the keys work only once a choice has focus, and the hint says so (it used to read « Raccourcis : … »).
  const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
  expect(plain(ph("pane_choice_shortcuts", { letters: "A–C", count: 3 }, "fr")).startsWith("Dans la liste des choix : A–C ou 1 à 3"),
    `the French hint says where the keys work (got ${ph("pane_choice_shortcuts", { letters: "A–C", count: 3 }, "fr")})`);
  expect(ph("pane_choice_shortcuts", { letters: "A–C", count: 3 }, "en").startsWith("In the list of choices: A–C or 1 to 3"),
    "the English hint too");
  expect(plain(ph("pane_meta_shortcuts", {}, "fr")).startsWith("Dans l'échelle : 0 à 4") && ph("pane_meta_shortcuts", {}, "en").startsWith("On the scale: 0 to 4"),
    "the checkpoint hint says where its keys work");
}
{
  const m = mount();
  m.render(baseState({ id: "e1", type: "explain_back", title: "Explique", prompt: "?" }));
  const ta = m.$(".controls textarea");
  fill(ta, "mon explication");
  m.key(ta, "b");
  expect(!posted(m, "respond").length, "letters typed in the answer box are never shortcuts");
  m.key(ta, "Enter", { ctrlKey: true });
  const r = posted(m, "respond");
  expect(r.length === 1 && r[0].input.kind === "explanation" && r[0].input.text === "mon explication", "Ctrl+Enter in the answer box submits it");
}

// --- 23) VSC-6: the completion screen ------------------------------------------------------------------
{
  const m = mount();
  m.render(baseState(quiz("qA", "Quiz A")));
  const due = Date.UTC(2026, 10, 3, 9, 0, 0);
  m.post({ type: "done", message: "Leçon terminée — 25 scènes.", completion: {
    consolidated: ["Particules", "Nombres quantiques"], to_revisit: ["Orbitales"], detours: 2,
    next_review_at: due, actions: ["review", "restart", "pick"],
  } });
  const screen = m.$(".completion");
  expect(!!screen && m.$(".completion h2")?.textContent === FR.pane_complete, "the completion screen has its own title");
  expect(m.text().includes("Particules") && m.text().includes("Orbitales"), "concepts consolidated and to revisit are named");
  expect(!/\d+\s?%|0[.,]\d{2}/.test(m.text()), "the completion screen shows no score or ratio");
  const dateText = new Intl.DateTimeFormat("fr", { weekday: "long", day: "numeric", month: "long" }).format(new Date(due));
  expect(m.text().includes(ph("pane_completion_next", { date: dateText }, "fr")), "the next review date is written in words");
  expect(m.text().includes(ph("pane_completion_detours", { count: 2 }, "fr")), "detours taken are mentioned");
  const actions = m.$all(".completion [data-action]");
  expect(actions.map((a: any) => a.textContent).join("|") === [FR.pane_review_now, FR.pane_restart, FR.pane_pick_course].join("|"), "the three declared actions are offered");
  for (const [i, type] of ["reviewNow", "restartLesson", "pickCourse"].entries()) {
    m.click(actions[i]); m.click(actions[i]);
    expect(posted(m, type).length === 1, `the completion action posts {type:'${type}'} once`);
    m.post({ type: "action_settled" });
  }
  expect(m.win.document.activeElement === m.$(".completion h2"), "focus moves to the completion title");
  // « Réviser maintenant » with nothing due: the host answers with a calm notice, not an action error.
  m.click(actions[0]);
  m.post({ type: "action_notice", message: "Rien à réviser pour l'instant. Prochaine révision : lundi 3 novembre." });
  const status = m.$(".completion .action-status");
  expect(status?.textContent === "Rien à réviser pour l'instant. Prochaine révision : lundi 3 novembre."
    && !status.className.includes("error") && status.className.includes("notice"),
    `a notice is shown as is, never as a failure (got ${status?.className}: ${status?.textContent})`);
  expect(!m.text().includes(FR.pane_action_failed.split(" ·")[0]!), "a notice is not worded as a failed action");
  expect(actions.every((a: any) => a.disabled === false) && m.$("#pane")?.getAttribute("aria-busy") === "false",
    "a notice releases the action gate");
  m.click(actions[1]);
  expect(posted(m, "restartLesson").length === 2, "the completion actions work again after a notice");
  m.post({ type: "action_notice", message: "" });
  expect(!m.$(".completion .action-status")?.className.includes("error"), "an empty notice still releases the gate without an error");
}
{
  // an older host sends only a message: the pane names the questions from what it saw, without actions
  const m = mount();
  m.render(baseState(quiz("qA", "Quiz A")));
  m.render(baseState(quiz("qB", "Quiz B"), { verdict: { scene_id: "qA", graded: true, signal: "answer_submitted", correct: true } }));
  m.click(m.$(".feedback-step .continue"));
  m.render(baseState({ id: "eC", type: "explain_back", title: "Explique C", prompt: "?" }, { verdict: { scene_id: "qB", graded: true, signal: "answer_submitted", correct: false } }));
  m.click(m.$(".feedback-step .continue"));
  m.post({ type: "done", message: "Leçon terminée — 3 scènes.", verdict: { scene_id: "eC", graded: true, signal: "answer_submitted" } });
  expect(!!m.$(".feedback-step") && m.$(".feedback-step .scene-title")?.textContent === "Explique C", "the last answer's feedback comes before the completion screen");
  m.click(m.$(".feedback-step .continue"));
  const group = (name: string) => m.$(`.completion-group[data-group='${name}']`)?.textContent || "";
  expect(group("passed").includes("Quiz A") && group("missed").includes("Quiz B") && group("open").includes("Explique C"), "the fallback lists what was right, to revisit and open");
  expect(!m.$(".completion [data-action]"), "no action is offered that the host did not declare");
}

// --- 24) ENG-10: untrusted SVG is sanitized before it reaches the DOM ----------------------------------
{
  const evil = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">`,
    `<script>alert(2)</script>`,
    `<defs><circle id="dot" r="1"/><linearGradient id="g"><stop offset="0"/></linearGradient></defs>`,
    `<circle cx="5" cy="5" r="4" fill="url(#g)" onclick="alert(3)"/>`,
    `<rect width="2" height="2" fill="url(https://evil.example/p.svg#x)" style="filter:url(https://evil.example/f)"/>`,
    `<text x="1" y="9">SAFE_LABEL</text>`,
    `<use href="#dot"/><use xlink:href="https://evil.example/s.svg#a"/>`,
    `<a href="javascript:alert(4)"><text>LINK_TEXT</text></a>`,
    `<image href="https://evil.example/beacon.png" width="1" height="1"/>`,
    `<foreignObject><div>HTML_INSIDE</div></foreignObject>`,
    `<animate attributeName="href" to="javascript:alert(5)"/><set attributeName="onclick" to="alert(6)"/>`,
    `</svg>`,
  ].join("");
  const m = mount();
  m.render(baseState({ id: "c1", type: "concept", title: "C", markdown: "x" }, { scene_assets: [{ kind: "svg", title: "Schéma", payload: evil }] }));
  const root = m.$(".svgwrap svg");
  const all = root ? [root, ...Array.from(root.querySelectorAll("*"))] as any[] : [];
  const names = all.map((e) => e.localName);
  expect(!!root, "a valid SVG still renders");
  expect(!names.some((n) => ["script", "foreignObject", "animate", "set", "image", "a"].includes(n)), `no script/foreignObject/animate/set/image/a survives (got ${names.join(",")})`);
  expect(!all.some((e) => Array.from(e.attributes).some((a: any) => /^on/i.test(a.name))), "no event-handler attribute survives");
  const hrefs = all.flatMap((e) => Array.from(e.attributes).filter((a: any) => /(^|:)href$/i.test(a.name)).map((a: any) => a.value));
  expect(hrefs.length === 1 && hrefs[0] === "#dot", `only internal references survive (got ${hrefs.join(",")})`);
  expect(!all.some((e) => Array.from(e.attributes).some((a: any) => /url\(\s*['"]?(?!#)/i.test(a.value))), "no attribute keeps an external url()");
  expect(!!root?.querySelector("circle[fill='url(#g)']") && m.text().includes("SAFE_LABEL") && m.text().includes("LINK_TEXT"), "benign shapes, internal paint references and text survive");
  expect(!m.text().includes("HTML_INSIDE"), "foreignObject content is dropped with it");
  expect(root?.getAttribute("role") === "img" && root.getAttribute("aria-label")?.includes("Schéma"), "the diagram is labelled for assistive technology");

  const broken = mount();
  broken.render(baseState({ id: "c1", type: "concept", title: "C", markdown: "x" }, { scene_assets: [{ kind: "svg", title: "Cassé", payload: "<svg><g></svg" }] }));
  expect(!broken.$(".svgwrap svg") && broken.text().includes(FR.pane_svg_invalid), "a malformed SVG becomes a written placeholder");
  const html = mount();
  html.render(baseState({ id: "c1", type: "concept", title: "C", markdown: "x" }, { scene_assets: [{ kind: "svg", title: "Faux", payload: "<div><script>alert(1)</script></div>" }] }));
  expect(!html.$(".svgwrap script") && html.text().includes(FR.pane_svg_invalid), "a non-SVG payload is refused");
}
{
  // ENG-10: remote images stay unloaded unless the learner chose network assets (paneHtml sets the mode)
  const blocked = mount(true);
  blocked.render(baseState({ id: "c1", type: "concept", title: "C", markdown: "![x](https://evil.example/a.png) et ![d](data:image/png;base64,AAAA)" }));
  expect(!blocked.$(".prose img[src^='https:']") && blocked.text().includes(ph("pane_image_remote", { path: "https://evil.example/a.png" }, "fr")), "a remote Markdown image is a written placeholder by default");
  expect(!!blocked.$(".prose img[src^='data:']"), "inline data images still render");
  const allowed = mount(true, { remoteImages: "allowed" });
  allowed.render(baseState({ id: "c1", type: "concept", title: "C", markdown: "![x](https://example.org/a.png)" }));
  expect(!!allowed.$(".prose img[src='https://example.org/a.png']"), "with network assets allowed, a remote image renders");
  const asset = mount();
  asset.render(baseState({ id: "c1", type: "concept", title: "C", markdown: "x" }, { scene_assets: [{ kind: "image", title: "Fig", path: "https://evil.example/fig.png" }] }));
  expect(!asset.$("img.figure") && asset.text().includes("https://evil.example/fig.png"), "a remote image asset is not fetched by default");
}

// --- 25) VSC-5: the pane chrome speaks the lesson language only ------------------------------------------
{
  const fr = mount();
  fr.render(baseState(quiz("qA", "Quiz A"), {
    scene_assets: [{ kind: "executed_result", title: "Run", meta: { passed: true, landmark: "42", checks: [] } }],
  }));
  const frText = fr.text();
  for (const english of ["Hint", "Continue ▸", "Artifacts paired", "Reference run passed", "landmark:", "no artifact", "Mastery"]) {
    expect(!frText.includes(english), `the French pane shows no English chrome ("${english}")`);
  }
  expect(frText.includes(FR.pane_run_passed) && frText.includes(ph("pane_landmark", { value: "42" }, "fr")), "executed-result chrome is French");
  const en = mount();
  en.render(baseState(quiz("qA", "Quiz A"), { locale: "en" }));
  const enText = en.text();
  for (const french of [FR.pane_validate, FR.pane_confidence, FR.pane_choices_legend, FR.pane_hint]) {
    expect(!enText.includes(french), `the English pane shows no French chrome ("${french}")`);
  }
  expect(enText.includes(EN.pane_validate) && enText.includes(EN.pane_type_quiz), "the English pane uses the English catalogue");
}

// --- 26) C8: the pane's design tokens are verbatim copies of design/, and its CSS paints with tokens -----
{
  const copies: Array<[string, string]> = [
    ["studium-tokens.css", "tokens.css"], ["studium-components.css", "components.css"], ["studium-vscode-bridge.css", "vscode-bridge.css"],
  ];
  for (const [media, source] of copies) {
    const mediaPath = resolve(extensionDir, "media", media);
    expect(existsSync(mediaPath) && readFileSync(mediaPath, "utf8").includes("--st-"), `media/${media} exists and defines --st- tokens`);
    const sourcePath = resolve(repoRoot, "design", source);
    if (existsSync(sourcePath)) {
      expect(existsSync(mediaPath) && readFileSync(mediaPath, "utf8") === readFileSync(sourcePath, "utf8"), `media/${media} is a verbatim copy of design/${source} (re-copy after a design change)`);
    }
  }
  // Brand colours are accents and fallbacks only: outside var(--x, fallback), no colour literal may paint.
  const stripVars = (css: string) => { let out = css.replace(/\/\*[\s\S]*?\*\//g, ""); for (let i = 0; i < 6; i++) out = out.replace(/var\([^()]*\)/g, ""); return out; };
  for (const file of ["artifact-pane.css", "graph-pane.css"]) {
    const css = stripVars(readFileSync(resolve(extensionDir, "media", file), "utf8"));
    const literals = css.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|:\s*(?:white|black)\b/g) || [];
    expect(literals.length === 0, `${file} paints only with theme tokens (literals outside var(): ${literals.join(", ")})`);
  }
  // VSC-4: as TEXT, the Light Modern status colours read 3.1 to 4.3:1 on white (editorWarning #bf8803 3.11,
  // editorInfo #1a85ff 3.59, testing.iconPassed #388a34 4.33), below AA. Status ink therefore paints borders
  // and aria-hidden glyphs only; words stay --st-text. A rule that gives text a status colour fails here.
  const STATUS_INK = /var\(--st-(?:success|warning|danger|info|accent-2|status-ink|chip-ink|scene-[\w-]+|node-[\w-]+)\b/;
  const GLYPH = /(?:-symbol|__symbol|\.exec-dot)$/;
  const statusInkOnText = (css: string) => {
    const offenders: string[] = [];
    for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const color = body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
      if (!color || !STATUS_INK.test(color[1])) continue;
      for (const selector of selectors.split(",").map((x) => x.trim())) if (!GLYPH.test(selector)) offenders.push(selector);
    }
    return offenders;
  };
  expect(statusInkOnText(".a-chip { border-color: var(--st-info); color: var(--st-success); } .b .ok-symbol { color: var(--st-danger); }").join() === ".a-chip",
    "the status-ink guard flags text painted with a status colour and lets a glyph through");
  const paneCss = readFileSync(resolve(extensionDir, "media", "artifact-pane.css"), "utf8");
  // W4 needs_lead 7: the shared components themselves no longer paint the TEXT of the two components the pane
  // draws, the chip and the verdict heading, in status ink (design/components.css, copied verbatim to media/);
  // the ink stays on their borders and symbols. Integration tail T7: the notice title (warning ink), the field
  // error and the error state's title (danger ink) and the graph node no longer paint their words in status
  // ink either, which failed AA under the VS Code bridge in light themes.
  const componentInk = statusInkOnText(readFileSync(resolve(extensionDir, "media", "studium-components.css"), "utf8"));
  for (const selector of [".st-chip", ".st-feedback__heading", ".st-notice__title", ".st-field__error", ".st-state--error .st-state__title", ".st-node"]) {
    expect(!componentInk.includes(selector), `studium-components.css paints ${selector} text in --st-text, not status ink (offenders: ${componentInk.join(", ")})`);
  }
  for (const file of ["artifact-pane.css", "graph-pane.css"]) {
    const inkOnText = statusInkOnText(readFileSync(resolve(extensionDir, "media", file), "utf8"));
    expect(inkOnText.length === 0, `${file} never paints text with a status colour (${inkOnText.join(", ")})`);
  }
  // The bridge maps the display face to the editor's UI font, where Studium's tight display tracking looks cramped.
  expect(/--st-tracking-display:\s*normal/.test(readFileSync(resolve(extensionDir, "media", "studium-vscode-bridge.css"), "utf8")),
    "the VS Code bridge resets --st-tracking-display to normal");
  // The pane still repaints chip and verdict-heading text itself (belt and braces for an older components.css).
  expect(/\.scene-type\.st-chip,\s*\.review-due\.st-chip\s*\{\s*color:\s*var\(--st-text\)/.test(paneCss)
    && /\.feedback-card \.st-feedback__heading\s*\{\s*color:\s*var\(--st-text\)/.test(paneCss),
    "the pane repaints chip and verdict-heading text in --st-text");
  for (const [, classes] of paneSrc.matchAll(/\{\s*class:\s*"([^"]*\bst-chip\b[^"]*)"/g)) {
    expect(/\b(?:scene-type|review-due)\b/.test(classes), `every chip the pane draws is one it repaints ("${classes}")`);
  }
  for (const [, classes, rest] of paneSrc.matchAll(/\{\s*class:\s*"([^"]*(?:-symbol|__symbol|exec-dot)\b[^"]*)"([^}]*)\}/g)) {
    expect(/"aria-hidden":\s*"true"/.test(rest), `the status glyph "${classes}" is aria-hidden (its meaning is in words beside it)`);
  }
}

// --- 27) paneHtml (extension.ts): CSP, stylesheet order, live region, CDN pinning + SRI -------------------
{
  const extSrc = readFileSync(resolve(here, "extension.ts"), "utf8");
  const start = extSrc.indexOf("function paneHtml(");
  const end = extSrc.indexOf("\n}\n", start);
  expect(start >= 0 && end > start, "extension.ts defines paneHtml");
  const js = transformSync(extSrc.slice(start, end + 2), { loader: "ts" }).code;
  const fakeVscode = { Uri: { file: (p: string) => ({ fsPath: p }) } };
  const build = new Function("vscode", "join", "nonce", "browserPhrases", "phrase", "helpStyles", "lessonHelpTemplates", `${js}\nreturn paneHtml;`)(
    fakeVscode, join, () => "NONCE123", browserPhrases, phrase, ".studium-help{}", () => "<template id=\"studium-help-quiz\"></template>",
  );
  const webview = { cspSource: "vscode-resource:", asWebviewUri: (u: { fsPath: string }) => "vscode-resource:" + u.fsPath };
  const page = (mode: "vendor" | "cdn", locale: Locale) => new JSDOM(build(webview, "/ext", mode, locale)).window.document;
  const vendor = page("vendor", "fr");
  const csp = vendor.querySelector("meta[http-equiv='Content-Security-Policy']")?.getAttribute("content") || "";
  const imgSrc = (csp.split(";").find((d) => d.trim().startsWith("img-src")) || "");
  expect(!!imgSrc && !imgSrc.includes("https:"), `vendor mode: images load only from the extension or data: (${imgSrc.trim()})`);
  expect(vendor.documentElement.lang === "fr" && page("vendor", "en").documentElement.lang === "en", "the document language follows the locale");
  expect(vendor.body.classList.contains("st-scope") && vendor.body.getAttribute("data-remote-images") === "blocked", "the body is a design-system scope with remote images blocked");
  const sheets = Array.from(vendor.querySelectorAll("link[rel='stylesheet']")).map((l) => (l.getAttribute("href") || "").split("/").pop());
  const order = ["studium-tokens.css", "studium-components.css", "studium-vscode-bridge.css", "artifact-pane.css"].map((s) => sheets.indexOf(s));
  expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]!)), `stylesheets load tokens → components → bridge → pane (got ${sheets.join(", ")})`);
  const live = vendor.getElementById("pane-live");
  expect(live?.getAttribute("aria-live") === "polite" && !vendor.getElementById("pane")?.contains(live), "a persistent live region sits outside the re-rendered pane");
  expect(Array.from(vendor.querySelectorAll("script[src]")).every((s) => s.getAttribute("nonce") === "NONCE123"), "every script carries the nonce");

  const cdn = page("cdn", "fr");
  const cdnCsp = cdn.querySelector("meta[http-equiv='Content-Security-Policy']")?.getAttribute("content") || "";
  expect((cdnCsp.split(";").find((d) => d.trim().startsWith("img-src")) || "").includes("https:") && cdn.body.getAttribute("data-remote-images") === "allowed", "cdn mode: the learner opted into network assets");
  const remote = Array.from(cdn.querySelectorAll("script[src^='https://'], link[href^='https://']"));
  expect(remote.length === 8, `cdn mode loads 8 remote files (got ${remote.length})`);
  for (const tag of remote) {
    const url = tag.getAttribute("src") || tag.getAttribute("href") || "";
    const m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@(\d+\.\d+\.\d+)\/(.+)$/);
    expect(!!m, `${url} names an exact version and a file`);
    if (!m) continue;
    const [, pkg, version, file] = m;
    const pkgDir = resolve(extensionDir, "node_modules", pkg!);
    const installed = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
    expect(installed === version, `${pkg}@${version} matches the vendored version ${installed}`);
    const sri = "sha384-" + createHash("sha384").update(readFileSync(join(pkgDir, file!))).digest("base64");
    expect(tag.getAttribute("integrity") === sri, `${pkg}/${file} carries the integrity of the vendored bytes`);
    expect(tag.getAttribute("crossorigin") === "anonymous", `${pkg}/${file} is fetched anonymously`);
  }
}

// --- 27b) graphHtml (extension.ts): the graph webview speaks the locale, uses the tokens, pins its CDN files --
{
  const extSrc = readFileSync(resolve(here, "extension.ts"), "utf8");
  const start = extSrc.indexOf("function graphHtml(");
  const end = extSrc.indexOf("\n}\n", start);
  expect(start >= 0 && end > start, "extension.ts defines graphHtml");
  const js = transformSync(extSrc.slice(start, end + 2), { loader: "ts" }).code;
  const fakeVscode = { Uri: { file: (p: string) => ({ fsPath: p }) } };
  const build = new Function("vscode", "join", "nonce", "helpStyles", "graphHelp", `${js}\nreturn graphHtml;`)(
    fakeVscode, join, () => "NONCE123", ".studium-help{}", () => "",
  );
  const webview = { cspSource: "vscode-resource:", asWebviewUri: (u: { fsPath: string }) => "vscode-resource:" + u.fsPath };
  const page = (mode: "vendor" | "cdn", locale: Locale) => new JSDOM(build(webview, "/ext", mode, locale)).window.document;
  const fr = page("vendor", "fr");
  expect(fr.documentElement.lang === "fr" && page("vendor", "en").documentElement.lang === "en", "the graph document language follows the locale (VSC-3)");
  expect(fr.body.classList.contains("st-scope"), "the graph body is a design-system scope");
  const sheets = Array.from(fr.querySelectorAll("link[rel='stylesheet']")).map((l) => (l.getAttribute("href") || "").split("/").pop());
  const order = ["studium-tokens.css", "studium-components.css", "studium-vscode-bridge.css", "graph-pane.css"].map((x) => sheets.indexOf(x));
  expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]!)), `graph stylesheets load tokens → components → bridge → graph (got ${sheets.join(", ")})`);
  const remote = Array.from(page("cdn", "fr").querySelectorAll("script[src^='https://']"));
  expect(remote.length === 3, `cdn mode loads the 3 graph libraries remotely (got ${remote.length})`);
  for (const tag of remote) {
    const url = tag.getAttribute("src") || "";
    const m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@(\d+\.\d+\.\d+)\/(.+)$/);
    expect(!!m, `${url} names an exact version and a file`);
    if (!m) continue;
    const [, pkg, version, file] = m;
    const pkgDir = resolve(extensionDir, "node_modules", pkg!);
    expect(JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version === version, `${pkg}@${version} is the installed version`);
    const sri = "sha384-" + createHash("sha384").update(readFileSync(join(pkgDir, file!))).digest("base64");
    expect(tag.getAttribute("integrity") === sri && tag.getAttribute("crossorigin") === "anonymous", `${pkg}/${file} carries the integrity of the vendored bytes (ENG-10)`);
  }
  expect(Array.from(fr.querySelectorAll("script[src]")).every((x) => !(x.getAttribute("src") || "").startsWith("https:")), "vendor mode loads no remote graph script");
}

// --- 28) W4 review: the host names concepts by their title, never by engine id ---------------------------
// The host sends {id, label} for the review-due list and for the completion lists; the pane shows the label and
// falls back to the id only when no label came (an older host sending bare ids still renders).
{
  const m = mount();
  m.render(baseState(quiz("qA", "Quiz A"), { reviewDue: [{ id: "c-particules", label: "Particules de l'atome" }, "c-orbitales"] }));
  const title = m.$(".review-due")?.getAttribute("title") || "";
  expect(title.includes("Particules de l'atome") && !title.includes("c-particules"), `the review-due tooltip names the concept, not its id (got ${title})`);
  expect(title.includes("c-orbitales"), "a bare id from an older host is still shown");
  m.post({ type: "done", message: "Fin.", completion: {
    consolidated: [{ id: "c-particules", label: "Particules de l'atome" }], to_revisit: [{ id: "c-orbitales", label: "Orbitales" }],
    detours: 0, next_review_at: null, actions: ["restart"],
  } });
  const groups = m.$all(".completion-group li").map((li: any) => li.textContent);
  expect(groups.join("|") === "Particules de l'atome|Orbitales", `the completion lists name concepts by title (got ${groups.join("|")})`);
  expect(!m.text().includes("c-particules") && !m.text().includes("[object Object]"), "no concept id or object dump reaches the completion screen");
}

// --- 28b) T8: French punctuation never starts a line ------------------------------------------------------
// In French, ; ! ? take a narrow no-break space before them, : and » a no-break space, « one after; a plain
// space let the pane wrap « …prochaine révision » and start the next line with « ; elle ne change… ». The
// catalogue's French values are typeset once (code spans left as written; lesson content, filled into the
// placeholders afterwards, is never touched). English is unchanged.
{
  const proseOf = (text: string) => text.replace(/`[^`]*`/g, "");
  const plainBefore = Object.entries(browserPhrases("fr") as Record<string, string>)
    .filter(([, text]) => / [;:!?»]|« /.test(proseOf(text))).map(([key]) => key);
  expect(plainBefore.length === 0, `no French phrase has a plain space before ; : ! ? » or after « (${plainBefore.join(", ")})`);
  expect(FR.pane_self_rating_scope.includes("révision\u202f; elle ne change jamais ta maîtrise"),
    `the screenshot's sentence keeps « ; » on the line of « révision » (got ${JSON.stringify(FR.pane_self_rating_scope)})`);
  expect(FR.chat_reply_reproduction.includes("«\u00a0Lancer la reproduction\u00a0»"), "« » hold their words with a no-break space");
  expect(ph("chat_tutor", { text: "Pourquoi ? Parce que : X" }, "fr") === "**Tuteur\u00a0:** Pourquoi ? Parce que : X",
    "lesson content filled into a placeholder is left as it came");
  expect(FR.chat_started.includes("`/hint`") && FR.chat_reply_deck.includes("`1,3`"), "code spans are left as written");
  const enTouched = Object.entries(browserPhrases("en") as Record<string, string>).filter(([, text]) => /[\u00a0\u202f]/.test(text)).map(([key]) => key);
  expect(enTouched.length === 0, `English phrases carry no French no-break spaces (${enTouched.join(", ")})`);
}

// --- 29) VSC-3: an axe-core pass over the pane's states ----------------------------------------------------
// axe-core 4.10.3 runs inside the same jsdom as the pane, on the WCAG 2.x A and AA rules (2.0, 2.1, 2.2). jsdom
// does not lay out or paint, so `color-contrast` cannot be computed here and is disabled: contrast is covered
// by design/scripts/check-contrast.mjs on the shipped palettes and by the status-ink guard of section 26, and a
// custom editor theme still needs checking in a real VS Code window. What this pass does check is structural:
// names, roles, labels, ARIA attributes and values, list and heading structure, duplicate ids, focusable content.
const axeSrc = readFileSync(resolve(extensionDir, "node_modules", "axe-core", "axe.min.js"), "utf8");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function axeViolations(m: Mounted): Promise<string[]> {
  if (!m.win.axe) m.win.eval(axeSrc);
  const result = await m.win.axe.run(m.win.document.body, {
    runOnly: { type: "tag", values: AXE_TAGS },
    rules: { "color-contrast": { enabled: false } },
    resultTypes: ["violations"],
  });
  return result.violations.map((v: any) => `${v.id} ×${v.nodes.length} at ${v.nodes.map((n: any) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}
async function axePass(): Promise<void> {
  // The pass must be able to fail in this jsdom: a nameless button and an unlabelled input are flagged.
  {
    const m = mount();
    m.win.document.getElementById("pane").innerHTML = '<button type="button"></button><input type="text">';
    const found = await axeViolations(m);
    expect(found.some((v) => v.startsWith("button-name")) && found.some((v) => v.startsWith("label")),
      `axe flags a known violation in jsdom (got ${found.join("; ") || "none"})`);
  }
  const states: Array<[string, (m: Mounted) => void]> = [
    ["loading", (m) => m.post({ type: "loading", message: "Connexion…" })],
    ["startup error", (m) => m.post({ type: "error", message: "lesson-mcp ne répond pas" })],
    ["quiz with a review-due chip", (m) => m.render(baseState(quiz("qA", "Quiz A"), { reviewDue: [{ id: "c-a", label: "Notion A" }] }))],
    ["meta checkpoint", (m) => m.render(baseState({ id: "m1", type: "meta_checkpoint", title: "Confiance", pre_question: "Sûr ?", scale_labels: ["0", "1", "2", "3", "4"] }))],
    ["free-text answer", (m) => m.render(baseState({ id: "e1", type: "explain_back", title: "Explique", prompt: "Pourquoi ?" }))],
    ["verdict deck", (m) => m.render(baseState({ id: "f1", type: "spot_the_flaw", title: "Audit", flawed_content: "Texte", deck: [{ id: "t1", text: "Étape 1" }, { id: "t2", text: "Étape 2" }] }))],
    ["discussion with a tutor turn", (m) => {
      m.render(baseState({ id: "d1", type: "discussion", title: "Débat", topic: "Atomes", seed_claim: "Tout est vide." }));
      m.post({ type: "turn_result", reasoning: null, tutor: { text: "Qu'entends-tu par vide ?" } });
    }],
    ["reproduction to run", (m) => m.render(baseState({ id: "r1", type: "reproduction", title: "Lancer", steps: [{ instruction: "Exécuter" }], run_manifest: { capsule_ref: "cap" } }))],
    ["feedback step with the reference", (m) => answered(m, { id: "eA", type: "explain_back", title: "Explique A", prompt: "?" },
      { id: "cB", type: "concept", title: "B", markdown: "x" },
      { correct: false, feedback: "Il manque un point.", key_points: ["Point un", "Point deux"], key_points_missing: ["Point deux"],
        model_answer: "La réponse modèle.", reference_kind: "key_points" })],
    ["self-rating request", (m) => answered(m, { id: "eA", type: "explain_back", title: "Explique A", prompt: "?" },
      { id: "cB", type: "concept", title: "B", markdown: "x" }, { feedback: "Compare." },
      { nextExtra: { self_rating: { requested: true, grades: ["again", "hard", "good", "easy"] } } })],
    ["self-authored notice", (m) => m.render(baseState({ id: "c1", type: "concept", title: "C", markdown: "x" },
      { authoring: { mode: "self", notice: "Leçon écrite par toi-même.", judge: false } }))],
    ["completion screen", (m) => {
      m.render(baseState(quiz("qA", "Quiz A")));
      m.post({ type: "done", message: "Leçon terminée.", completion: {
        consolidated: [{ id: "c-a", label: "Notion A" }], to_revisit: [{ id: "c-b", label: "Notion B" }], detours: 1,
        next_review_at: Date.UTC(2026, 10, 3), due_now: 1, actions: ["review", "restart", "pick"],
      } });
    }],
  ];
  for (const [label, show] of states) {
    const m = mount(true);
    show(m);
    expect(m.text().trim().length > 0, `axe (${label}): the state rendered something to check`);
    const found = await axeViolations(m);
    expect(found.length === 0, `axe (${label}): no WCAG A/AA violation (${found.join("; ")})`);
  }
}

// --- sprint verification fixes (group E) ---------------------------------------------------------------
// UX-08: an empty answer box cannot be submitted, by button or by Ctrl+Enter.
{
  const m = mount();
  m.render(baseState({ id: "e1", type: "explain_back", title: "Explique", prompt: "?" }));
  const ta = m.$(".controls textarea");
  const button = m.$(".controls .primary");
  expect(button?.disabled === true, "the submit button waits for text");
  fill(ta, "   ");
  m.key(ta, "Enter", { ctrlKey: true });
  m.click(button);
  expect(!posted(m, "respond").length && button?.disabled === true, "blank text is not an answer");
  fill(ta, "une vraie réponse");
  expect(button?.disabled === false, "text enables it");
  const prefilled = mount();
  prefilled.render(baseState({ type: "prompt_practice", title: "P", task: "T", starter_prompt: "STARTER" }));
  expect(prefilled.$(".controls .primary")?.disabled === false, "a prefilled prompt can be sent as it is");
}
// UX-07: a discussion turn is pending until the host answers; when it fails, it leaves the transcript and its text
// returns to the box.
{
  const m = mount();
  m.render(baseState({ type: "discussion", title: "Débat", topic: "T", seed_claim: "S" }));
  const ta = m.$("textarea");
  const send = m.$all(".controls button").find((b: any) => b.textContent === FR.pane_send);
  expect(send?.disabled === true, "« Envoyer » waits for text");
  fill(ta, "MON_ARGUMENT");
  m.click(send);
  expect(!!m.$(".turn-learner.turn-pending") && ta.value === "", "the sent turn is shown as pending");
  m.post({ type: "action_error", action: "turn", message: "KO" });
  expect(!m.text().includes("MON_ARGUMENT") || ta.value === "MON_ARGUMENT", "the failed turn's text is back in the box");
  expect(!m.$(".turn-learner") && ta.value === "MON_ARGUMENT" && send?.disabled === false, "and it is no longer in the transcript");
  m.click(send);
  m.post({ type: "turn_result", reasoning: null, tutor: { text: "TUTEUR" } });
  expect(!!m.$(".turn-learner") && !m.$(".turn-pending") && send?.disabled === true, "a confirmed turn stays, no longer pending; the empty box waits again");
}
// UX-09: a rating's error that arrives after the learner left its feedback step is dropped, not shown elsewhere.
{
  const m = mount();
  answered(m, { id: "eA", type: "explain_back", title: "E", prompt: "?" }, { id: "cB", type: "concept", title: "B", markdown: "x" },
    {}, { nextExtra: { self_rating: { requested: true, grades: ["again", "good"] } } });
  m.click(m.$all(".self-rating button[data-grade]")[1]);
  m.click(m.$(".feedback-step .continue"));
  m.post({ type: "action_error", action: "rateRecall", sceneId: "eA", message: "LATE_RATING_ERROR" });
  expect(!m.text().includes("LATE_RATING_ERROR"), "a late rating error is not shown on the next scene");
}
// L-2: the correct choice of a quiz left wrong is labelled « La bonne réponse »; L-3: a source line carries its
// licence; L-7: an AI-drafted lesson's key says whose it is.
{
  const m = mount();
  answered(m, quiz("qA", "Quiz A"), { id: "cB", type: "concept", title: "B", markdown: "x" },
    { correct: false, assessed_by: "key", feedback: "Non.", key_points: ["Quatre"], reference_kind: "correct_choice" },
    { firstExtra: { authoring: { mode: "self_study", drafted_by: "agent", notice: "N" } },
      nextExtra: { sources: [{ title: "Wikipédia — Photosynthèse", url: "https://fr.wikipedia.org/wiki/Photosynth%C3%A8se", license: "CC BY-SA 4.0", quote: "Q" }] } });
  expect(m.$(".key-points .st-eyebrow")?.textContent === FR.pane_correct_choice && FR.pane_correct_choice === "La bonne réponse", "the correct choice is « La bonne réponse »");
  expect(m.text().includes("Quatre"), "and it is shown");
  expect((m.$(".feedback-sources figcaption")?.textContent ?? "").endsWith("Wikipédia — Photosynthèse, CC BY-SA 4.0"), `the source line ends with its licence (got ${m.$(".feedback-sources figcaption")?.textContent})`);
  expect(m.$(".feedback-key-note")?.textContent === FR.pane_ai_key_note, "an author-keyed verdict of an AI-drafted lesson names its key");
  const teacher = mount();
  answered(teacher, quiz("qA", "Quiz A"), { id: "cB", type: "concept", title: "B", markdown: "x" },
    { correct: false, assessed_by: "key", feedback: "Non." }, { firstExtra: { authoring: { mode: "teacher", drafted_by: "teacher", notice: null } } });
  expect(!teacher.$(".feedback-key-note"), "a teacher's key carries no such note");
  expect(EN.pane_correct_choice === "The right answer", "“The right answer” in English");
}
// L-6: the completion lists — consolidated, practised (with the number of graded answers), not measured yet.
{
  const m = mount();
  m.render(baseState(quiz("qA", "Quiz A")));
  m.post({ type: "done", message: "Fin.", completion: {
    consolidated: [{ id: "c1", label: "Acquise" }], practised: [{ id: "c2", label: "Vue une fois", answers: 1 }, { id: "c3", label: "Vue deux fois", answers: 2 }],
    not_measured: [{ id: "c4", label: "Jamais notée" }], actions: [],
  } });
  const group = (name: string) => m.$all(`.completion-group[data-group='${name}'] li`).map((li: any) => li.textContent).join("|");
  expect(group("consolidated") === "Acquise", "consolidated");
  expect(group("practised") === `Vue une fois ${FR.pane_completion_answers_one}|Vue deux fois ${ph("pane_completion_answers", { count: 2 })}`,
    `practised, with the number of answers (got ${group("practised")})`);
  expect(group("not-measured") === "Jamais notée", "not measured yet");
  expect(!m.text().includes(FR.pane_completion_to_revisit), "no « à revoir » list is invented");
}
// UX-11: a rating on the last answer updates the end screen's next review.
{
  const m = mount();
  m.render(baseState({ id: "eA", type: "explain_back", title: "E", prompt: "?" }));
  m.post({ type: "done", message: "Fin.", verdict: { scene_id: "eA", graded: true, signal: "answer_submitted" },
    self_rating: { requested: true, scene_id: "eA", grades: ["again", "good"] },
    completion: { consolidated: [], next_review_at: Date.UTC(2026, 10, 1, 9), due_now: 0, actions: ["restart"] } });
  m.click(m.$all(".self-rating button[data-grade]")[1]);
  const later = Date.UTC(2026, 10, 20, 9);
  m.post({ type: "recall_rated", sceneId: "eA", grade: "good", completion: { next_review_at: later, due_now: 0, actions: ["restart"] } });
  m.click(m.$(".feedback-step .continue"));
  const words = new Intl.DateTimeFormat("fr", { weekday: "long", day: "numeric", month: "long" }).format(new Date(later));
  expect(m.text().includes(ph("pane_completion_next", { date: words })), `the end screen shows the date the rating produced (got ${m.$(".completion-review")?.textContent})`);
}

axePass().catch((e) => { expect(false, `the axe pass ran (${e?.message ?? e})`); }).finally(() => {
  expect(missingKeys.size === 0, `every phrase key the pane tests name exists in both catalogues (missing: ${[...missingKeys].join(", ")})`);

  if (failures.length) {
    console.error(`FAIL — ${failures.length}/${checks} webview-pane assertions failed:`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`OK — webview-pane (live jsdom render + click + axe-core structural pass) passed all ${checks} assertions.`);
});
