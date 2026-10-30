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
import { browserPhrases, type Locale } from "./phrases.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const paneSrc = readFileSync(resolve(here, "..", "media", "artifact-pane.js"), "utf8");
const markedSrc = readFileSync(resolve(here, "..", "node_modules", "marked", "marked.min.js"), "utf8");
const katexSrc = readFileSync(resolve(here, "..", "node_modules", "katex", "dist", "katex.min.js"), "utf8");
const mhchemSrc = readFileSync(resolve(here, "..", "node_modules", "katex", "dist", "contrib", "mhchem.min.js"), "utf8");

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

// A fresh DOM + a freshly-evaluated pane per scene, with __send overridden to CAPTURE host messages.
function mount(withRenderLibraries: boolean | "marked" = false) {
  const dom = new JSDOM(`<!doctype html><html><body><script type="application/json" id="studium-strings">${JSON.stringify(browserPhrases("fr"))}</script><div id="pane"></div></body></html>`, {
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
    $: (sel: string) => win.document.querySelector(sel),
    $all: (sel: string) => Array.from(win.document.querySelectorAll(sel)),
    click: (elm: any) => elm && elm.click(),
  };
}

const baseState = (scene: any, extra: any = {}) => {
  const locale: Locale = extra.locale === "en" ? "en" : "fr";
  return { scene, scene_assets: [], progress: { index: 1, total: 9 }, strings: browserPhrases(locale), ...extra };
};

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

// --- 2) quiz: the QUESTION STEM is rendered + choice buttons post quiz_choice with the id ----------
{
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Quiz titre", question: "QUESTION_STEM_TEXT", choices: [{ id: "a", text: "3" }, { id: "b", text: "4" }] }));
  expect(m.text().includes("QUESTION_STEM_TEXT"), "quiz renders the question stem (not just the title)");
  const choiceBtns = m.$all(".controls .choice");
  expect(choiceBtns.length === 2, `quiz renders 2 choice buttons (got ${choiceBtns.length})`);
  m.click(choiceBtns[1]);
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.kind === "quiz_choice" && r.input?.choiceId === "b", "quiz posts quiz_choice with chosen id");
}

// --- 2b) meta_checkpoint: pre_question rendered + scale_labels on buttons + confidence value -------
{
  const m = mount();
  m.render(baseState({ type: "meta_checkpoint", title: "Auto-éval", pre_question: "PRE_QUESTION_TEXT", scale_labels: ["Pas du tout", "Un peu", "Moyen", "Bien", "Très à l'aise"] }));
  expect(m.text().includes("PRE_QUESTION_TEXT"), "meta_checkpoint renders the pre_question");
  expect(m.text().includes("Très à l'aise"), "meta_checkpoint shows the scale_labels on the buttons");
  const confBtns = m.$all(".controls .choice");
  expect(confBtns.length === 5, `meta_checkpoint renders 5 confidence buttons (got ${confBtns.length})`);
  m.click(confBtns[3]);
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

// --- 7) per-answer confidence tap: the tapped 0-4 rides on the submitted input -------------------
{
  // quiz: tap confidence 3, then choose b → the respond input carries confidence 3
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "?", choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }] }));
  const confBtns = m.$all(".confrow .conf");
  expect(confBtns.length === 5, `quiz renders a 0-4 confidence tap (got ${confBtns.length})`);
  m.click(confBtns[3]);                              // confidence = 3
  m.click(m.$all(".controls .choice")[1]);           // choose b
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
  const ta = m.$("textarea"); if (ta) (ta as any).value = "mes erreurs";
  m.click(m.$(".controls .primary"));
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.kind === "flaw_report" && r.input?.confidence === 1, "free-text submit carries the tapped confidence");
}
{
  // not tapping → the input has NO confidence field (optional, omitted)
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "?", choices: [{ id: "a", text: "A" }] }));
  m.click(m.$all(".controls .choice")[0]);
  const r = m.sent.find((x) => x.type === "respond");
  expect(!!r && r.input?.confidence === undefined, "no tap → no confidence on the submitted input");
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
{
  const m = mount();
  m.render(baseState({ type: "concept", title: "C", markdown: "x" },
    { explanation: { rule_id: "replay", explanation_short: "GATE_REASON_TEXT" } }));
  expect(!!m.$(".gate.gate-replay"), "a replay withhold renders a gate card (not the terse adapt banner)");
  expect(m.text().includes("On refait cette étape ensemble"), "gate card shows the calm, non-punitive framing");
  expect(m.text().includes("GATE_REASON_TEXT"), "gate card still surfaces the engine's short reason");
  expect(!m.$(".adapt"), "withhold does not also render the raw ⟳ rule_id banner");
}
{
  // a NORMAL adaptation rationale (a real rule id, not a withhold kind) keeps the terse banner
  const m = mount();
  m.render(baseState({ type: "concept", title: "C", markdown: "x" },
    { explanation: { rule_id: "rule-042", explanation_short: "why this scene" } }));
  expect(!!m.$(".adapt") && !m.$(".gate"), "a non-withhold adaptation rationale keeps the .adapt banner");
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
{
  const recorded = mount();
  recorded.render(baseState({ type: "concept", title: "C", markdown: "x" },
    { locale: "en", verdict: { graded: false } }));
  expect(recorded.text().includes("Answer recorded"), "locale en renders the ungraded verdict in English");

  const correct = mount();
  correct.render(baseState({ type: "concept", title: "C", markdown: "x" },
    { locale: "en", verdict: { graded: true, correct: true } }));
  expect(correct.text().includes("Correct"), "locale en renders the correct verdict in English");

  const incorrect = mount();
  incorrect.render(baseState({ type: "concept", title: "C", markdown: "x" },
    { locale: "en", verdict: { graded: true, correct: false } }));
  expect(incorrect.text().includes("Incorrect"), "locale en renders the incorrect verdict in English");
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
  expect(m.text().includes("image : plots/x.png (non résolue)"), "relative Markdown images render a visible French placeholder");
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
{
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "?", choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }] }));
  const choices = m.$all(".controls .choice") as HTMLButtonElement[];
  const choice = choices[0] ?? null;
  choices[1]!.disabled = true;
  m.click(choice); m.click(choice);
  expect(m.sent.filter((message) => message.type === "respond").length === 1, "a rapid double click posts one response");
  expect(choice?.disabled === true, "scene controls are disabled while an action is pending");
  expect(m.$("#pane")?.getAttribute("aria-busy") === "true", "the pane exposes its pending state to assistive technology");
  expect(m.text().includes("Envoi de ta réponse"), "the pending state tells the learner what is happening");

  m.post({ type: "action_error", message: "NETWORK_DOWN" });
  expect(!!m.$(".scene-head"), "an action error preserves the current scene and learner context");
  expect(choice?.disabled === false, "controls are re-enabled after an action error");
  expect(choices[1]!.disabled === true, "settling an action preserves controls that were disabled beforehand");
  expect(m.text().includes("NETWORK_DOWN"), "an action error is visible inside the pane");
}

// --- 15) fatal startup error: explain the recovery path instead of showing a bare warning -----------
{
  const m = mount();
  m.post({ type: "error", message: "SERVICE_FAILED" });
  expect(m.text().includes("Connexion interrompue"), "a fatal error has a meaningful heading");
  expect(m.text().includes("Output") && m.text().includes("Open Lesson"), "a fatal error names the logs and retry path");
}

// --- 16) lifecycle messages keep the lesson locale and self-study notice ----------------------------
{
  const m = mount();
  m.render(baseState({ type: "quiz", title: "Q", question: "?", choices: [{ id: "a", text: "A" }] }, {
    locale: "en", authoring: { notice: "Self-authored lesson notice" },
  }));
  m.click(m.$(".controls .choice"));
  expect(m.text().includes("Sending your response…"), "pending feedback follows the English lesson locale");
  expect(m.win.document.documentElement.lang === "en", "contextual help follows the lesson language");
  expect(m.$(".authoring-notice")?.textContent === "Self-authored lesson notice", "pending actions retain the self-study notice");
  m.post({ type: "action_error", message: "RETRY" });
  expect(m.text().includes("Action failed · RETRY"), "recoverable errors follow the English lesson locale");
  expect(m.$(".controls .choice")?.disabled === false, "localized errors still release the action gate");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} webview-pane assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — webview-pane (live jsdom render + click) passed all ${checks} assertions.`);
