// Full-state replay must retain effects without duplicating conversation turns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const pane = new URL("artifact-pane.js", import.meta.url);
const view = (extra = {}) => ({ schema: "studium/panel-view/1", kind: "scene", session_id: "one", learner_id: "learner", bundle_ref: "course", lesson_title: "Test", locale: "en", strings: {}, progress: { index: 1, total: 2 }, scene: { id: "scene", type: "discussion", title: "Discussion", prompt: "Explain your reasoning" }, scene_assets: [], reviewDue: [], calibration: [], mastery: {}, actions: ["turn", "hint"], ...extra });
function mount() {
  const dom = new JSDOM('<!doctype html><html><body><div id="pane"></div></body></html>', { runScripts: "outside-only" });
  dom.window.eval(readFileSync(pane, "utf8").replace(/export \{ renderView \};?\s*$/, ""));
  return dom;
}
test("a fresh full view paints its scene, hint and tutor reply; replay is idempotent", () => {
  const dom = mount();
  const state = view({ hint: { hint: "Try the definition", remaining: 1 }, turn_result: { reasoning: null, tutor: { text: "Consider an example" } } });
  dom.window.renderView(state);
  assert.match(dom.window.document.body.textContent, /Discussion/);
  assert.match(dom.window.document.body.textContent, /Try the definition/);
  assert.match(dom.window.document.body.textContent, /Consider an example/);
  dom.window.renderView(state);
  assert.equal(dom.window.document.querySelectorAll(".turn-tutor").length, 1);
  assert.match(dom.window.document.querySelector(".turn-tutor").textContent, /Consider an example/);
  dom.window.close();
});
test("a pending view disables actions, settling it restores the live scene", () => {
  const dom = mount();
  dom.window.renderView(view({ pending: "Working" }));
  assert.equal(dom.window.document.querySelector("#pane").getAttribute("aria-busy"), "true");
  dom.window.renderView(view());
  assert.notEqual(dom.window.document.querySelector("#pane").getAttribute("aria-busy"), "true");
  dom.window.close();
});

test("the legacy envelope carries a complete view without replaying its effects twice", () => {
  const dom = mount();
  const state = view({ scene: { id: "discussion", type: "discussion", title: "Reason together", prompt: "Explain" }, turn_result: { reasoning: null, tutor: { text: "A single tutor reply" } } });
  const envelope = { type: "turn_result", ...state.turn_result, view: state };
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: envelope }));
  assert.match(dom.window.document.body.textContent, /Reason together/);
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: envelope }));
  assert.equal(dom.window.document.querySelectorAll(".turn-tutor").length, 1);
  assert.match(dom.window.document.querySelector(".turn-tutor").textContent, /A single tutor reply/);
  dom.window.close();
});
// INT-STUDIUM-058, task 2.6: what the panel shows of a version-2 view — where the learner is, who speaks,
// which help is open — with every action reachable from the keyboard, and the display delay of each
// view joined to the next action.
const V2 = {
  schema: "studium/panel-view/2",
  orientation: { step: { index: 1, total: 2 }, reviews_due: 0, waiting: "answer" },
  status_line: "Test · step 1/2 · 3 min · your answer",
  voices: { scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" } },
  help: { rungs: [
    { kind: "reread", available: true },
    { kind: "hint", available: true, cost: "a hint lowers the credit of this answer" },
    { kind: "explain", available: false, why_not: "try an answer first" },
    { kind: "reference", available: false, why_not: "the reference shows after your answer" },
  ] },
  prompts: [], attention: "normal", surface: { rank: 3, kind: "panel", available: ["text", "panel"] },
};
const QUIZ = { id: "quiz", type: "quiz", title: "A question", question: "Which one?", choices: [{ id: "a", text: "First" }, { id: "b", text: "Second" }] };
const WORDS = {
  pane_hint: "Hint", pane_help_heading: "Help", pane_help_reread: "Read again", pane_help_explain: "Explanation",
  pane_help_reference: "Reference", pane_help_explain_question: "Explain this screen to me.", pane_ask: "Ask a question",
  pane_voice_validated_by: "Lesson validated by {name}", pane_voice_key: "Assessed by the author's key",
  pane_progress: "Step {position} of {total}", pane_validate: "Submit", pane_continue: "Continue",
};
const quizV2 = (extra = {}) => view({ ...V2, strings: WORDS, scene: QUIZ, actions: ["respond", "hint", "end", "ask"], ...extra });
/** Mount the renderer with a recorder in place of the host bridge. */
function mountWithSend() {
  const dom = mount();
  const sent = [];
  dom.window.__send = (...args) => { sent.push(args); };
  return { dom, sent, doc: dom.window.document };
}
const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : null);
/** What the renderer sent, as plain data: its objects belong to the test window, not to this module. */
const plain = (value) => JSON.parse(JSON.stringify(value));

test("a version-1 view keeps its step label and its own hint button", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(view({ strings: WORDS, scene: QUIZ, actions: ["respond", "hint", "end"] }));
  assert.equal(text(doc.querySelector(".st-progress__label")), "Step 1 of 2");
  assert.ok(doc.querySelector(".hint-button"));
  assert.equal(doc.querySelector(".orientation-line"), null);
  assert.equal(doc.querySelector(".help-ladder"), null);
  assert.equal(doc.querySelector(".voice"), null);
  dom.window.close();
});

test("a version-2 view opens with its orientation line, and says the step once", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(quizV2());
  assert.equal(text(doc.querySelector(".orientation-line")), "Test · step 1/2 · 3 min · your answer");
  assert.equal(doc.querySelector(".st-progress__label"), null); // the rail keeps its segments, not a second label
  assert.ok(doc.querySelector(".progress[role=progressbar]"));
  // The orientation line comes before the scene's title.
  const line = doc.querySelector(".orientation-line"), title = doc.querySelector(".scene-title");
  assert.ok(line.compareDocumentPosition(title) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  dom.window.close();
});

test("a version-2 view names the voice of the scene, and the voice of a verdict over its feedback", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(quizV2());
  assert.equal(text(doc.querySelector(".voice-scene")), "Lesson validated by Prof. Test");
  assert.equal(doc.querySelector(".voice-verdict"), null);
  dom.window.renderView(quizV2({
    voices: { ...V2.voices, verdict: { kind: "key" } },
    verdict: { scene_id: "earlier", graded: true, correct: true, feedback: "Well done." },
  }));
  const voice = doc.querySelector(".feedback-step .voice-verdict"), card = doc.querySelector(".feedback-card");
  assert.equal(text(voice), "Assessed by the author's key");
  assert.ok(voice.compareDocumentPosition(card) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  dom.window.close();
});

test("the help ladder shows every rung: a closed one with its reason, an open hint with its cost", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(quizV2());
  const rungs = [...doc.querySelectorAll(".help-ladder [data-rung]")];
  assert.deepEqual(rungs.map((button) => button.dataset.rung), ["reread", "hint", "explain", "reference"]);
  assert.deepEqual(rungs.map((button) => text(button)), ["Read again", "Hint", "Explanation", "Reference"]);
  const note = (button) => text(doc.getElementById(button.getAttribute("aria-describedby")));
  assert.equal(note(rungs[1]), "a hint lowers the credit of this answer");
  assert.equal(note(rungs[2]), "try an answer first");
  assert.equal(rungs[2].getAttribute("aria-disabled"), "true");
  assert.equal(rungs[1].getAttribute("aria-disabled"), null);
  assert.equal(rungs[2].disabled, false); // still focusable: its reason must be reachable
  assert.equal(doc.querySelector(".hint-button"), null); // one hint control, in the ladder
  assert.equal(text(doc.querySelector(".ask-button")), "Ask a question");

  rungs[2].click(); // closed: nothing is sent, the reason is said
  rungs[3].click();
  assert.deepEqual(plain(sent), []);
  assert.equal(text(doc.querySelector("#action-status")), "the reference shows after your answer");
  rungs[1].click();
  assert.deepEqual(plain(sent[0][0]), { type: "hint" });
  dom.window.close();
});

test("an open explanation and « Ask a question » hand over to the assistant", () => {
  const { dom, doc, sent } = mountWithSend();
  const tried = { rungs: [{ kind: "reread", available: true }, { kind: "explain", available: true }] };
  dom.window.renderView(quizV2({ help: tried }));
  doc.querySelector(".help-ladder [data-rung=explain]").click();
  assert.deepEqual(plain(sent[0][0]), { type: "ask", text: "Explain this screen to me." });
  dom.window.renderView(quizV2({ help: tried, session_id: "two" }));
  doc.querySelector(".ask-button").click();
  assert.deepEqual(plain(sent[1][0]), { type: "ask" });
  // A view that does not offer the action shows no ask button, and an explanation rung with nothing to send.
  dom.window.renderView(quizV2({ help: tried, session_id: "three", actions: ["respond"] }));
  assert.equal(doc.querySelector(".ask-button"), null);
  doc.querySelector(".help-ladder [data-rung=explain]").click();
  assert.equal(sent.length, 2);
  dom.window.close();
});

test("every action of a version-2 scene is reachable from the keyboard, in reading order", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(quizV2());
  doc.querySelector(".choices input").click(); // a choice is picked: « Submit » is enabled
  const focusable = [...doc.querySelectorAll("#pane button, #pane input, #pane textarea, #pane summary, #pane a[href], #pane [tabindex]")]
    .filter((node) => node.getAttribute("tabindex") !== "-1" && !node.disabled);
  for (const node of focusable) {
    const tabindex = node.getAttribute("tabindex");
    assert.ok(tabindex === null || tabindex === "0", `no positive tabindex (${node.outerHTML.slice(0, 80)})`);
  }
  const order = (selector) => {
    const node = doc.querySelector(selector);
    assert.ok(node, `${selector} is in the pane`);
    const index = focusable.indexOf(node);
    assert.ok(index >= 0, `${selector} takes the keyboard focus`);
    return index;
  };
  const sequence = [
    ".choices input[value='0']", ".choices input[value='1']", ".validate",
    "[data-rung=reread]", "[data-rung=hint]", "[data-rung=explain]", "[data-rung=reference]", ".ask-button",
  ].map(order);
  assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b));
  order(".pane-menu summary"); // the menu (forget) too
  dom.window.close();
});

test("the delay between an action and the display of its answer is joined to the next action", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(quizV2());
  doc.querySelector(".help-ladder [data-rung=hint]").click();
  assert.deepEqual(plain(sent[0]), [{ type: "hint" }]); // nothing to report yet: no action came before
  dom.window.renderView(quizV2({ hint: { hint: "Think of the definition", remaining: 0 } }));
  doc.querySelector(".ask-button").click();
  assert.deepEqual(plain(sent[1][0]), { type: "ask" });
  const meta = sent[1][1];
  assert.ok(Number.isInteger(meta.client_ms) && meta.client_ms >= 0 && meta.client_ms < 60_000, `client_ms ${meta.client_ms}`);
  // Reported once: the action after that one carries the delay of its own predecessor, measured afresh.
  dom.window.renderView(quizV2({ session_id: "two" }));
  doc.querySelector(".ask-button").click();
  assert.ok(Number.isInteger(sent[2][1].client_ms));
  dom.window.renderView(quizV2({ session_id: "three" }));
  dom.window.renderView(quizV2({ session_id: "four" })); // a view nobody asked for reports nothing
  doc.querySelector(".ask-button").click();
  assert.ok(Number.isInteger(sent[3][1].client_ms));
  dom.window.close();
});

// INT-STUDIUM-058, task 4.3: the concept map in the panel, as a list. Every concept with its state in
// words, the answers behind it, what the state establishes and what it does not, and the claim the
// learner may make; the whole of it reachable from the keyboard.
const MAP_WORDS = {
  ...WORDS,
  pane_map_open: "Concept map", pane_map_close: "Close the map",
  pane_map_state_acquired: "acquired", pane_map_state_to_review: "to review", pane_map_state_current: "in progress",
  pane_map_state_seen: "seen, not assessed yet", pane_map_state_upcoming: "upcoming",
  pane_map_details: "Evidence and scope", pane_map_establishes: "What this state establishes",
  pane_map_not_established: "What it does not establish", pane_map_evidence: "Answers",
  pane_map_no_evidence: "No answer on this concept yet.",
  pane_map_by_key: "graded against the author's key", pane_map_by_judge: "assessed by a judge model",
  pane_map_by_self: "rated by you", pane_map_by_none: "assessed by nobody",
  pane_map_result_right: "right", pane_map_result_wrong: "wrong", pane_map_result_rated: "recall self-rated", pane_map_result_recorded: "recorded",
  pane_map_hints_one: "1 hint", pane_map_hints_many: "{count} hints", pane_map_day_unknown: "day unknown",
  pane_map_needs: "Needs: {list}", pane_map_claim_known: "I know it", pane_map_claim_unsure: "I am not sure",
  pane_map_contest_two: "Two check questions will follow.", pane_map_contest_one: "One check question will follow: the result will be partial.",
  pane_map_check_pending: "Check under way",
  pane_map_outcome_confirmed: "Last check: claim confirmed", pane_map_outcome_refuted: "Last check: claim not confirmed", pane_map_outcome_partial: "Last check: partial result",
};
const MAP = {
  concepts: [
    { id: "a", title: "Particles", state: "acquired", establishes: "Your last graded answer was right.", does_not_establish: "It does not say you will remember it.",
      evidence: [
        { scene_id: "q1", day: "2026-11-05", assessed_by: "key", result: "right", hints: 1 },
        { scene_id: "w1", day: "2026-11-06", assessed_by: "self", result: "rated", hints: 0 },
      ],
      contest: { allowed: true, claim: "unsure", questions: 2, outcome: "refuted" } },
    { id: "b", title: "Orbitals", state: "current", establishes: "This is the concept of your step.", does_not_establish: "The map concludes nothing yet.",
      evidence: [{ scene_id: "q2", day: null, assessed_by: "none", result: "recorded", hints: null }],
      contest: { allowed: true, claim: "known", questions: 1 } },
    { id: "c", title: "Spectra", state: "upcoming", establishes: "Not shown yet.", does_not_establish: "The map knows nothing of it.", evidence: [],
      contest: { allowed: false, claim: "known", questions: 0 } },
  ],
  edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "c" }],
};
const mapView = (extra = {}) => quizV2({ strings: MAP_WORDS, actions: ["respond", "hint", "end", "ask", "openMap"], ...extra });
const openMapView = (extra = {}) => mapView({ actions: ["respond", "hint", "end", "ask", "closeMap", "contest"], map: MAP, ...extra });

test("a view that offers the map shows a button for it, and one that does not shows none", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(quizV2());
  assert.equal(doc.querySelector(".map-button"), null);
  dom.window.renderView(mapView({ session_id: "two" }));
  const button = doc.querySelector(".map-button");
  assert.equal(text(button), "Concept map");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(doc.querySelector(".concept-map"), null);
  button.click();
  assert.deepEqual(plain(sent[0][0]), { type: "openMap" });
  dom.window.close();
});

test("an open map lists every concept with its state, its answers and what the state establishes", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(mapView());
  dom.window.renderView(openMapView());
  const map = doc.querySelector(".concept-map");
  assert.ok(map, "the map is drawn");
  assert.equal(map.getAttribute("aria-labelledby"), map.querySelector(".map-title").id);
  assert.equal(text(map.querySelector(".map-title")), "Concept map");
  // The map was just opened: the keyboard and the screen reader land on its heading.
  assert.equal(doc.activeElement, map.querySelector(".map-title"));
  const items = [...map.querySelectorAll("ul.map-list > li.map-concept")];
  assert.deepEqual(items.map((li) => text(li.querySelector(".map-concept-title"))), ["Particles", "Orbitals", "Spectra"]);
  assert.deepEqual(items.map((li) => text(li.querySelector(".map-state"))), ["acquired", "in progress", "upcoming"]);
  assert.deepEqual(items.map((li) => li.getAttribute("data-state")), ["acquired", "current", "upcoming"]);
  // What a concept needs, in words: a list has no arrows.
  assert.deepEqual(items.map((li) => text(li.querySelector(".map-needs"))), [null, "Needs: Particles", "Needs: Particles, Orbitals"]);
  const first = items[0];
  assert.equal(text(first.querySelector("details > summary")), "Evidence and scope");
  assert.match(text(first.querySelector(".map-scope")), /What this state establishes Your last graded answer was right\. What it does not establish It does not say you will remember it\./);
  assert.deepEqual([...first.querySelectorAll(".map-evidence li")].map(text), [
    "2026-11-05 · graded against the author's key · right · 1 hint",
    "2026-11-06 · rated by you · recall self-rated",
  ]);
  assert.deepEqual([...items[1].querySelectorAll(".map-evidence li")].map(text), ["day unknown · assessed by nobody · recorded"]);
  assert.equal(text(items[2].querySelector(".map-no-evidence")), "No answer on this concept yet.");
  // The button now closes the map.
  const button = doc.querySelector(".map-button");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  map.querySelector(".map-close").click();
  assert.deepEqual(plain(sent.at(-1)[0]), { type: "closeMap" });
  dom.window.close();
});

test("the claim a concept takes is a button; one question only, a check under way and the last outcome are said", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(openMapView());
  const items = [...doc.querySelectorAll(".map-concept")];
  const claim = (li) => li.querySelector(".map-claim");
  assert.equal(text(claim(items[0])), "I am not sure");
  assert.equal(text(items[0].querySelector(".map-contest-note")), "Two check questions will follow.");
  assert.equal(text(items[0].querySelector(".map-outcome")), "Last check: claim not confirmed");
  assert.equal(text(claim(items[1])), "I know it");
  assert.equal(text(items[1].querySelector(".map-contest-note")), "One check question will follow: the result will be partial.");
  assert.equal(claim(items[2]), null);                                 // nothing to check this concept with
  claim(items[1]).click();
  assert.deepEqual(plain(sent[0][0]), { type: "contest", concept_id: "b", claim: "known" });

  // While a check is under way no claim is offered, and the concept says so.
  const pending = structuredClone(MAP);
  pending.concepts[0].contest = { allowed: false, claim: "unsure", questions: 2 };
  pending.concepts[1].contest = { allowed: false, check_pending: true, claim: "known", questions: 2 };
  dom.window.renderView(openMapView({ session_id: "two", map: pending }));
  const during = [...doc.querySelectorAll(".map-concept")];
  assert.equal(doc.querySelector(".map-claim"), null);
  assert.equal(text(during[1].querySelector(".map-check-pending")), "Check under way");

  // A view that carries the map without the contest action (an older server) offers no claim.
  dom.window.renderView(openMapView({ session_id: "three", actions: ["respond", "closeMap"] }));
  assert.equal(doc.querySelector(".map-claim"), null);
  dom.window.close();
});

test("the map is reached from the keyboard after the scene's own controls, in reading order", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(openMapView());
  const focusable = [...doc.querySelectorAll("button, input, summary, textarea, [tabindex='0']")];
  const order = (selector) => {
    const node = doc.querySelector(selector);
    assert.ok(node, `${selector} exists`);
    const at = focusable.indexOf(node);
    assert.ok(at >= 0, `${selector} is focusable`);
    assert.notEqual(node.getAttribute("tabindex"), "-1");
    return at;
  };
  const sequence = [".validate", ".map-button", ".map-close", ".map-concept details > summary", ".map-claim"].map(order);
  assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b));
  dom.window.close();
});

test("a scene view's message is said in the status line (what a contest's check showed)", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(openMapView({ message: "Two check questions on this concept." }));
  assert.equal(text(doc.querySelector("#action-status")), "Two check questions on this concept.");
  assert.match(doc.querySelector("#action-status").className, /notice/);
  dom.window.close();
});

test("feedback the learner already left is not shown again when the map opens", () => {
  const { dom, doc } = mountWithSend();
  const verdict = { scene_id: "previous", graded: true, correct: true, assessed_by: "key", feedback: "Yes." };
  dom.window.renderView(mapView({ verdict }));
  assert.ok(doc.querySelector(".feedback-step"), "the answer's feedback comes first");
  doc.querySelector(".continue").click();
  assert.ok(doc.querySelector(".map-button"), "then the scene");
  // The server answers openMap with the same verdict still on the view: the scene stays.
  doc.querySelector(".map-button").click();
  dom.window.renderView(openMapView({ verdict }));
  assert.equal(doc.querySelector(".feedback-step"), null);
  assert.ok(doc.querySelector(".concept-map"));
  // The same verdict on a view that answers no such action is a new answer (a question replayed and
  // answered the same way): its feedback is its own step.
  dom.window.renderView(openMapView({ verdict, scene: { ...QUIZ, title: "The question again" } }));
  assert.ok(doc.querySelector(".feedback-step"));
  doc.querySelector(".continue").click();
  // A new answer's feedback is shown as ever.
  doc.querySelector(".choices input").click();
  doc.querySelector(".validate").click();
  dom.window.renderView(openMapView({ session_id: "one", verdict: { ...verdict, correct: false, feedback: "No." } }));
  assert.ok(doc.querySelector(".feedback-step"));
  dom.window.close();
});

test("closing the map gives the keyboard back to its button, and a notice stays in the status line", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(mapView());
  dom.window.renderView(openMapView());
  dom.window.renderView(mapView());
  assert.equal(doc.activeElement, doc.querySelector(".map-button"));
  assert.equal(doc.querySelector(".concept-map"), null);
  // A notice about the scene on screen (the map could not be read) is still there once the view is painted.
  dom.window.renderView(mapView({ kind: "notice", message: "The map cannot be shown yet." }));
  assert.equal(text(doc.querySelector("#action-status")), "The map cannot be shown yet.");
  assert.match(doc.querySelector("#action-status").className, /notice/);
  dom.window.close();
});

// INT-STUDIUM-058 § 2.6, task 5.2: the server's proposals in the panel. Shown at a pause, under the
// scene's own controls; each answer is one button; a notice is shown whatever the lesson waits for.
const PROMPT_WORDS = { ...MAP_WORDS, pane_prompts_heading: "Suggestions" };
const answerTo = (id, outcome) => ({ type: "prompt", id, outcome });
const REVIEW_PROMPT = {
  id: "review_due:start", kind: "review_due", reason: "3 concepts to review today", expires: "scene",
  actions: [{ label: "Review now", action: answerTo("review_due:start", "accept") }, { label: "Later", action: answerTo("review_due:start", "dismiss") }],
};
const NOTICE_PROMPT = { id: "adaptation_notice:quiz", kind: "adaptation_notice", reason: "Back to a prerequisite.", expires: "scene", actions: [] };
const READING = { id: "intro", type: "concept", title: "A page", markdown: "Read this." };
const pausedView = (extra = {}) => quizV2({
  strings: PROMPT_WORDS, scene: READING, actions: ["respond", "end", "ask", "prompt"],
  orientation: { ...V2.orientation, waiting: "read" }, prompts: [REVIEW_PROMPT, NOTICE_PROMPT], ...extra,
});

test("at a pause the panel shows each proposal with its reason and one button per answer, after the scene's controls", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(pausedView());
  const region = doc.querySelector(".prompts");
  assert.ok(region, "the proposals are drawn");
  assert.equal(region.getAttribute("aria-label"), "Suggestions");
  const items = [...region.querySelectorAll(".prompt")];
  assert.deepEqual(items.map((item) => item.getAttribute("data-kind")), ["review_due", "adaptation_notice"]);
  assert.deepEqual(items.map((item) => text(item.querySelector(".prompt-reason"))), ["3 concepts to review today", "Back to a prerequisite."]);
  assert.deepEqual([...items[0].querySelectorAll(".prompt-action")].map(text), ["Review now", "Later"]);
  assert.equal(items[1].querySelector(".prompt-action"), null);                // a notice asks nothing
  // Reading order: the scene's own control first, then the proposals.
  const focusable = [...doc.querySelectorAll("button, input, summary, textarea")];
  const continueAt = focusable.indexOf(doc.querySelector(".controls button"));
  assert.ok(continueAt >= 0 && continueAt < focusable.indexOf(items[0].querySelector(".prompt-action")));
  // One gesture refuses: the second button sends the dismissal.
  items[0].querySelectorAll(".prompt-action")[1].click();
  assert.deepEqual(plain(sent[0][0]), answerTo("review_due:start", "dismiss"));
  dom.window.close();
});

test("while an answer is owed the panel shows no proposal, only notices; without the action it offers no button", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(quizV2({ strings: PROMPT_WORDS, actions: ["respond", "hint", "end", "ask", "prompt"], prompts: [REVIEW_PROMPT, NOTICE_PROMPT] }));
  assert.deepEqual([...doc.querySelectorAll(".prompt")].map((item) => item.getAttribute("data-kind")), ["adaptation_notice"]);
  dom.window.renderView(quizV2({ session_id: "two", strings: PROMPT_WORDS, prompts: [REVIEW_PROMPT] }));
  assert.equal(doc.querySelector(".prompts"), null);
  // A view that does not offer the action its buttons send (an older server) shows the reason alone.
  dom.window.renderView(pausedView({ session_id: "three", actions: ["respond", "end"] }));
  assert.equal(text(doc.querySelector(".prompt-reason")), "3 concepts to review today");
  assert.equal(doc.querySelector(".prompt-action"), null);
  // No prompt, no region.
  dom.window.renderView(pausedView({ session_id: "four", prompts: [] }));
  assert.equal(doc.querySelector(".prompts"), null);
  dom.window.close();
});

test("dismissing a proposal does not bring back the feedback of the answer before", () => {
  const { dom, doc } = mountWithSend();
  const verdict = { scene_id: "previous", graded: true, correct: true, assessed_by: "key", feedback: "Yes." };
  dom.window.renderView(pausedView({ verdict }));
  doc.querySelector(".continue").click();
  doc.querySelectorAll(".prompt-action")[1].click();
  dom.window.renderView(pausedView({ verdict, prompts: [NOTICE_PROMPT] }));
  assert.equal(doc.querySelector(".feedback-step"), null);
  assert.deepEqual([...doc.querySelectorAll(".prompt")].map((item) => item.getAttribute("data-kind")), ["adaptation_notice"]);
  dom.window.close();
});

// INT-STUDIUM-058 F8 (walkthrough of 7 Nov, finding 3): the learner's own settings, drawn only from
// what the view offers: the attention level (the budget of the server's proposals), the panel's
// language, and « I have N minutes ».
const SETTINGS_WORDS = {
  ...PROMPT_WORDS, pane_settings: "Settings", pane_attention: "Suggestions from the lesson", pane_attention_quiet: "Quiet",
  pane_attention_normal: "Normal", pane_attention_coached: "Coached", pane_language: "Language", pane_replan: "Replan",
  pane_replan_minutes: "Minutes available",
};
const settingsView = (extra = {}) => quizV2({
  strings: SETTINGS_WORDS, actions: ["respond", "hint", "end", "ask", "setLanguage", "setAttention", "replan"], ...extra,
});

test("the settings region draws the attention level, the language and replan, with the current choice pressed", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(settingsView({ attention: "quiet" }));
  const region = doc.querySelector(".settings");
  assert.ok(region, "the settings are drawn");
  assert.equal(region.getAttribute("aria-label"), "Settings");
  const levels = [...region.querySelectorAll(".attention-level")];
  assert.deepEqual(levels.map(text), ["Quiet", "Normal", "Coached"]);
  assert.deepEqual(levels.map((b) => b.getAttribute("aria-pressed")), ["true", "false", "false"]);
  const languages = [...region.querySelectorAll(".language-choice")];
  assert.deepEqual(languages.map(text), ["FR", "EN"]);
  assert.deepEqual(languages.map((b) => b.getAttribute("aria-pressed")), ["false", "true"]); // the view is in English
  assert.equal(text(region.querySelector(".replan-button")), "Replan");
  assert.ok(region.querySelector("input.replan-minutes[type=number]"));
  // After the scene's controls and the proposals, at the bottom of the pane.
  const focusable = [...doc.querySelectorAll("button, input, summary, textarea")].filter((n) => !n.disabled);
  assert.ok(focusable.indexOf(doc.querySelector(".ask-button")) < focusable.indexOf(levels[0]));
  dom.window.close();
});

test("each setting sends its action with the shape the server reads", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(settingsView());
  doc.querySelector(".attention-level[data-level=quiet]").click();
  assert.deepEqual(plain(sent.at(-1)[0]), { type: "setAttention", level: "quiet" });
  dom.window.renderView(settingsView({ attention: "quiet" }));
  doc.querySelector(".language-choice[data-language=fr]").click();
  assert.deepEqual(plain(sent.at(-1)[0]), { type: "setLanguage", presentation_language: "fr" });
  dom.window.renderView(settingsView({ locale: "fr" }));
  const minutes = doc.querySelector(".replan-minutes");
  minutes.value = "15";
  doc.querySelector(".replan-button").click();
  assert.deepEqual(plain(sent.at(-1)[0]), { type: "replan", minutes: 15 });
  dom.window.close();
});

test("a setting not offered is not drawn; none offered, no region", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(settingsView({ actions: ["respond", "end", "setAttention"] }));
  assert.equal(doc.querySelectorAll(".attention-level").length, 3);
  assert.equal(doc.querySelector(".language-choice"), null);
  assert.equal(doc.querySelector(".replan-button"), null);
  dom.window.renderView(settingsView({ session_id: "two", actions: ["respond", "end"] }));
  assert.equal(doc.querySelector(".settings"), null);
  dom.window.close();
});

test("the settings stay usable while an answer is owed, and a setting keeps the feedback already left", () => {
  const { dom, doc } = mountWithSend();
  const verdict = { scene_id: "previous", graded: true, correct: true, assessed_by: "key", feedback: "Yes." };
  dom.window.renderView(settingsView({ verdict })); // waiting: answer
  doc.querySelector(".continue").click();
  const quiet = doc.querySelector(".attention-level[data-level=quiet]");
  assert.equal(quiet.disabled, false);
  quiet.click();
  dom.window.renderView(settingsView({ verdict, attention: "quiet" }));
  assert.equal(doc.querySelector(".feedback-step"), null);
  assert.equal(doc.querySelector(".attention-level[data-level=quiet]").getAttribute("aria-pressed"), "true");
  dom.window.close();
});

// Walkthrough 2026-11-07: a session the server no longer knows (it restarted, or the session was closed) is said as
// such, with a button that opens the same lesson again; any other error keeps the generic status line.
const LOST_WORDS = {
  ...SETTINGS_WORDS,
  pane_session_lost: "Session lost (the server restarted or the session was closed). Reopen the lesson: your progress is kept.",
  pane_reopen_lesson: "Reopen the lesson", pane_action_failed: "Action failed · {error}",
};
const LOST = "session not found: sid-42 (the server may have restarted, or the session was closed): call start_lesson_session…";

test("an action on a lost session replaces the scene with the notice and a reopen button, sent only on a click", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(settingsView({ strings: LOST_WORDS }));
  doc.querySelector(".choices input").click();
  doc.querySelector(".validate").click();
  assert.equal(sent.length, 1);
  dom.window.renderView({ type: "action_error", action: "respond", message: LOST });
  const notice = doc.querySelector(".session-lost");
  assert.ok(notice, "the notice is drawn");
  assert.equal(notice.getAttribute("role"), "alert");
  assert.match(text(notice), /^Session lost \(the server restarted or the session was closed\)\. Reopen the lesson: your progress is kept\./);
  assert.equal(doc.querySelector(".scene-title"), null, "the stale scene is gone");
  assert.equal(doc.querySelector(".settings"), null, "the settings stay out");
  assert.doesNotMatch(text(doc.body), /sid-42/, "the server's own words are not shown");
  assert.equal(sent.length, 1, "nothing is retried on its own");
  const reopen = doc.querySelector(".session-lost .reopen-lesson");
  assert.equal(text(reopen), "Reopen the lesson");
  reopen.click();
  assert.deepEqual(plain(sent.at(-1)[0]), { type: "reopen" });
  assert.equal(sent.length, 2);
  dom.window.close();
});

test("a lost session is recognised inside the tool's JSON error envelope, and a view of the new session replaces the notice", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(settingsView({ strings: LOST_WORDS }));
  dom.window.renderView({ type: "action_error", message: JSON.stringify({ error: LOST }) });
  assert.ok(doc.querySelector(".session-lost"));
  dom.window.renderView(settingsView({ strings: LOST_WORDS, session_id: "fresh" }));
  assert.equal(doc.querySelector(".session-lost"), null);
  assert.ok(doc.querySelector(".scene-title"));
  dom.window.close();
});

test("an unrelated action error keeps the scene and the generic status line", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(settingsView({ strings: LOST_WORDS }));
  dom.window.renderView({ type: "action_error", message: "tool panel_action timed out (not a session not found)" });
  assert.equal(doc.querySelector(".session-lost"), null);
  assert.ok(doc.querySelector(".scene-title"));
  assert.equal(text(doc.querySelector("#action-status")), "Action failed · tool panel_action timed out (not a session not found)");
  dom.window.close();
});

// Walkthrough 2026-11-07: the verdict chip names who wrote the key, as the conversation does.
test("a key verdict names the AI-drafted key, the learner's own key, or the author's key", () => {
  const words = { ...WORDS, pane_voice_key_ai: "Assessed by the AI-drafted key — check it against the cited passage", pane_voice_key_own: "Assessed by the key you wrote" };
  const verdict = { scene_id: "earlier", graded: true, correct: true, assessed_by: "key", feedback: "Well done." };
  const chip = (drafted_by, session_id) => {
    const { dom, doc } = mountWithSend();
    dom.window.renderView(quizV2({ strings: words, session_id, verdict,
      voices: { scene: { kind: "author", name: null, reviewed: false, drafted_by }, verdict: { kind: "key" } } }));
    const value = text(doc.querySelector(".feedback-step .voice-verdict"));
    dom.window.close();
    return value;
  };
  assert.equal(chip("agent", "a"), "Assessed by the AI-drafted key — check it against the cited passage");
  assert.equal(chip("learner", "b"), "Assessed by the key you wrote");
  assert.equal(chip("teacher", "c"), "Assessed by the author's key");
});

// A classmate's contribution a teacher reviews (teacher mode, drafted by a learner): the scene chip and the
// key verdict name the classmate, never « the key you wrote »; a self-study lesson keeps its own wording.
test("a classmate's contribution names the classmate in the scene chip and on the key verdict", async () => {
  const { browserPhrases: phrases } = await import("../../../packages/lesson-panel/src/phrases.ts");
  const en = phrases("en");
  const verdict = { scene_id: "earlier", graded: true, correct: true, assessed_by: "key", feedback: "Well done." };
  const render = (scene, session_id) => {
    const before = mountWithSend();
    before.dom.window.renderView(quizV2({ strings: en, session_id, voices: { scene } }));
    const out = { scene: text(before.doc.querySelector(".voice-scene")), chip: text(before.doc.querySelector(".voice-chip summary")) };
    before.dom.window.close();
    const after = mountWithSend();
    after.dom.window.renderView(quizV2({ strings: en, session_id: `${session_id}-v`, verdict, voices: { scene, verdict: { kind: "key" } } }));
    out.verdict = text(after.doc.querySelector(".feedback-step .voice-verdict"));
    after.dom.window.close();
    return out;
  };
  const classmate = { kind: "author", name: null, reviewed: false, drafted_by: "learner", from_classmate: true };
  assert.deepEqual(render(classmate, "a"), { scene: "Lesson contributed by a classmate. No approval is recorded for this lesson.",
    chip: en.pane_voice_short_classmate, verdict: "Assessed by the key written by a classmate" });
  assert.equal(render({ ...classmate, name: "Dr Lee", reviewed: true }, "b").scene, "Lesson contributed by a classmate, validated by Dr Lee");
  assert.equal(render({ ...classmate, name: "Dr Lee" }, "c").scene, "Lesson contributed by a classmate. Changed since its validation.");
  const own = render({ kind: "author", name: null, reviewed: false, drafted_by: "learner" }, "d");
  assert.equal(own.verdict, "Assessed by the key you wrote");
  const teacher = render({ kind: "author", name: null, reviewed: false, drafted_by: "teacher" }, "e");
  assert.equal(teacher.scene, "No approval is recorded for this lesson");
  assert.equal(teacher.chip, en.pane_voice_short_unreviewed);
});

// INT-STUDIUM-058 § 2.1, surface negotiation: a host that renders MCP Apps shows the panel for any call of
// open_lesson_panel, a conversation or forms surface included. The panel is then not the surface: it draws a
// short notice in the view's language, never the scene, its answer controls, the settings or the map, so
// no act is taken there at the wrong rank. « Play here » is offered when the client can render a panel.
const { browserPhrases } = await import("../../../packages/lesson-panel/src/phrases.ts");
const offSurface = (kind, locale, available = ["text", "form", "panel"]) => settingsView({
  locale, strings: browserPhrases(locale), surface: { rank: kind === "text" ? 1 : 2, kind, available },
  actions: ["respond", "hint", "end", "ask", "setLanguage", "setAttention", "replan", "openMap"],
});
const NOTICES = {
  text: { fr: /^Cette leçon se joue dans la conversation/, en: /^This lesson is played in the conversation/ },
  form: { fr: /^Cette leçon se joue en formulaires/, en: /^This lesson is played in forms/ },
};
const NOT_NEGOTIATED = { fr: /Tu réponds là-bas ; ce panneau montre seulement où tu en es\./, en: /You answer there; this panel only shows where you are\./ };
for (const kind of ["text", "form"]) for (const locale of ["fr", "en"]) {
  test(`a ${kind} surface draws the notice in ${locale}, without the scene, its controls, the settings or the map`, () => {
    const { dom, doc, sent } = mountWithSend();
    dom.window.renderView(offSurface(kind, locale));
    const notice = doc.querySelector(".surface-elsewhere");
    assert.ok(notice, "the notice is drawn");
    assert.match(text(notice.querySelector(".surface-elsewhere-title")), NOTICES[kind][locale]);
    assert.match(text(notice), NOT_NEGOTIATED[locale]);
    assert.equal(text(doc.querySelector(".surface-elsewhere .orientation-line")), "Test · step 1/2 · 3 min · your answer", "the status line stays");
    for (const selector of [".scene-title", ".controls", ".choices", ".validate", ".settings", ".map-button", ".concept-map", ".help-ladder", ".scene-head", ".prompts"]) {
      assert.equal(doc.querySelector(selector), null, `${selector} is not drawn`);
    }
    assert.equal(doc.querySelectorAll("#pane input, #pane textarea").length, 0, "no answer field");
    const play = doc.querySelector(".surface-elsewhere .play-here");
    assert.equal(text(play), locale === "fr" ? "Jouer ici" : "Play here");
    assert.equal(sent.length, 0, "nothing is sent on its own");
    play.click();
    assert.deepEqual(plain(sent.at(-1)[0]), { type: "playHere" });
    dom.window.close();
  });
}

test("no « Play here » when the client cannot render a panel", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(offSurface("form", "en", ["text", "form"]));
  assert.ok(doc.querySelector(".surface-elsewhere"));
  assert.equal(doc.querySelector(".play-here"), null);
  dom.window.close();
});

test("a panel surface still draws the scene with its controls and settings (guard)", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(settingsView({ locale: "en", strings: browserPhrases("en"), surface: { rank: 3, kind: "panel", available: ["text", "form", "panel"] } }));
  assert.equal(doc.querySelector(".surface-elsewhere"), null);
  assert.ok(doc.querySelector(".scene-title"));
  assert.ok(doc.querySelector(".choices"));
  assert.ok(doc.querySelector(".settings"));
  dom.window.close();
});

// --- Panel audit 2026-11-10: the defects and frictions the headless audit reproduced, and the next interface. ---
const EN = browserPhrases("en");
const next = (extra = {}) => quizV2({ strings: EN, ...extra });
const VERDICT_KEY = { kind: "key" };

test("A5: an answer nobody assessed, with nothing below, says it was recorded and that there is no reference", () => {
  const { dom, doc } = mountWithSend();
  const written = { id: "w", type: "explain_back", title: "Explain", prompt: "Why?" };
  dom.window.renderView(next({ scene: { ...READING, id: "after" }, verdict: { scene_id: "w", graded: true, assessed_by: "none" } }));
  assert.equal(text(doc.querySelector(".feedback-why")), EN.pane_uncertified_why_none);
  dom.window.renderView(next({ session_id: "two", scene: { ...READING, id: "after" }, verdict: { scene_id: "w", graded: true, assessed_by: "none", key_points: ["A point"] } }));
  assert.equal(text(doc.querySelector(".feedback-why")), EN.pane_uncertified_why);
  void written;
  dom.window.close();
});

test("A6: the control that has the focus is never disabled under the learner, and keeps it when the wait ends", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(next());
  doc.querySelector(".choices input").click();
  const validate = doc.querySelector(".validate");
  validate.focus();
  validate.click();
  assert.equal(validate.disabled, false, "the focused control stays enabled");
  assert.equal(validate.getAttribute("aria-disabled"), "true");
  assert.equal(doc.querySelector(".choices input").disabled, true, "the others wait");
  validate.click();
  assert.equal(sent.length, 1, "pressed again while pending, it sends nothing");
  dom.window.renderView({ type: "action_error", message: "boom" });
  assert.equal(validate.getAttribute("aria-disabled"), null);
  assert.equal(doc.activeElement, validate);
  // The focus fell to the page during the wait: it goes back to the control that sent the action.
  validate.click();
  validate.blur();
  dom.window.renderView({ type: "action_settled" });
  assert.equal(doc.activeElement, validate);
  dom.window.close();
});

test("A11: the scene and its feedback carry the content's language when the view gives it", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next({ content_language: "fr" }));
  assert.equal(doc.querySelector(".scene-title").getAttribute("lang"), "fr");
  assert.equal(doc.querySelector(".scene-body").getAttribute("lang"), "fr");
  assert.equal(doc.querySelector(".choices").getAttribute("lang"), "fr");
  dom.window.renderView(next({ content_language: "fr", verdict: { scene_id: "quiz", graded: true, correct: true, feedback: "Oui." }, scene: { ...READING, id: "after" } }));
  assert.equal(doc.querySelector(".feedback-card").getAttribute("lang"), "fr");
  dom.window.renderView(next({ session_id: "two" }));
  assert.equal(doc.querySelector(".scene-body").getAttribute("lang"), null, "without the field, nothing is claimed");
  dom.window.close();
});

test("A12: a scrollable asset body is a named region that takes the focus", async () => {
  const { dom, doc } = mountWithSend();
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollWidth", { configurable: true, get() { return this.classList.contains("asset-body") ? 900 : 0; } });
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 300; } });
  dom.window.renderView(next({ scene_assets: [{ kind: "equation_latex", title: "Quantum numbers", payload: "\\ell \\in \\{0, 1, \\dots, n-1\\}" }] }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const body = doc.querySelector(".asset-body");
  assert.equal(body.getAttribute("role"), "region");
  assert.match(body.getAttribute("aria-label"), /Quantum numbers/);
  assert.equal(body.getAttribute("tabindex"), "0");
  dom.window.close();
});

test("B4: a replay shows the key-free feedback the engine returned, withholds a reference it carries, and counts attempts", () => {
  const { dom, doc } = mountWithSend();
  const again = (extra) => next({ navigation: { kind: "replay" }, ...extra });
  dom.window.renderView(again({ verdict: { scene_id: "quiz", graded: true, correct: false, feedback: "Look at the subshell." } }));
  assert.match(text(doc.querySelector(".feedback-card")), /Look at the subshell\./);
  assert.equal(doc.querySelector(".feedback-withheld"), null);
  doc.querySelector(".continue").click();
  dom.window.renderView(again({ verdict: { scene_id: "quiz", graded: true, correct: false, feedback: "The answer is 30.", key_points: ["30"], reference_kind: "correct_choice" } }));
  assert.ok(doc.querySelector(".feedback-withheld"));
  assert.doesNotMatch(text(doc.querySelector(".feedback-step")), /30/);
  doc.querySelector(".continue").click();
  assert.match(text(doc.querySelector(".gate-why")), /Attempt 3/);
  dom.window.close();
});

test("B6: a contest's announcement is a navigation card at the top, not a status line", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next({ orientation: { ...V2.orientation, contest: { concept_id: "c", question: 1, total: 2 } }, message: "Two check questions on this concept." }));
  const card = doc.querySelector(".nav-card.nav-contest");
  assert.ok(card, "a card");
  assert.match(text(card), /Two check questions on this concept\./);
  assert.ok(card.compareDocumentPosition(doc.querySelector(".scene-body")) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "above the question, as a detour's card");
  assert.doesNotMatch(text(doc.querySelector("#action-status")), /Two check questions/);
  dom.window.close();
});

test("B8: « Choose another course » is in the menu whenever the view offers pickCourse", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(next());
  assert.equal(doc.querySelector(".pane-menu .menu-pick-course"), null);
  dom.window.renderView(next({ session_id: "two", actions: ["respond", "end", "pickCourse"] }));
  const item = doc.querySelector(".pane-menu .menu-pick-course");
  assert.equal(text(item), EN.pane_pick_course);
  item.click();
  assert.deepEqual(plain(sent.at(-1)[0]), { type: "pickCourse" });
  dom.window.close();
});

test("B14 and C5: the feedback of a written answer quotes it above the key points", () => {
  const { dom, doc } = mountWithSend();
  const written = { id: "w", type: "explain_back", title: "Explain", prompt: "Why?" };
  dom.window.renderView(next({ scene: written, actions: ["respond", "end", "ask"] }));
  const box = doc.querySelector(".controls textarea");
  box.value = "Because the nucleus holds the protons.";
  box.dispatchEvent(new dom.window.Event("input"));
  doc.querySelector(".controls .st-button--primary").click();
  dom.window.renderView(next({ scene: { ...READING, id: "after" }, verdict: { scene_id: "w", graded: true, assessed_by: "none", key_points: ["Protons are in the nucleus"] }, self_rating: { requested: true, scene_id: "w", grades: ["again", "hard", "good", "easy"] } }));
  const quote = doc.querySelector(".feedback-step .your-answer");
  assert.equal(text(quote.querySelector("blockquote")), "Because the nucleus holds the protons.");
  assert.ok(quote.compareDocumentPosition(doc.querySelector(".key-points")) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  dom.window.close();
});

test("C5: the feedback of a quiz opens with the session line, then the learner's answer beside the key the view carries", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next());
  doc.querySelectorAll(".choices input")[1].click();
  doc.querySelectorAll(".confrow .conf")[1].click();
  doc.querySelector(".validate").click();
  const verdict = { scene_id: "quiz", graded: true, correct: false, assessed_by: "key", feedback: "Count again.", key_points: ["First"], reference_kind: "correct_choice" };
  dom.window.renderView(next({ scene: { ...READING, id: "after" }, verdict, voices: { ...V2.voices, verdict: VERDICT_KEY } }));
  const step = doc.querySelector(".feedback-step");
  assert.ok(step.querySelector(".session-line"), "the session line heads the feedback");
  const rows = [...step.querySelectorAll(".answer-compare > div")].map(text);
  assert.deepEqual(rows, [`${EN.pane_answer_label} B · Second · confidence 1`, `${EN.pane_compare_key_author} First`]);
  assert.equal(step.querySelector(".key-points"), null, "the key is said once");
  // A view without the key shows the learner's answer alone.
  dom.window.renderView(next({ session_id: "two" }));
  doc.querySelectorAll(".choices input")[0].click();
  doc.querySelector(".validate").click();
  dom.window.renderView(next({ session_id: "two", scene: { ...READING, id: "after" }, verdict: { ...verdict, key_points: undefined, reference_kind: undefined } }));
  assert.deepEqual([...doc.querySelectorAll(".answer-compare > div")].map(text), [`${EN.pane_answer_label} A · First`]);
  dom.window.close();
});

test("B15: the 0 to 4 confidence shows the meaning of its two ends in words", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next());
  const ends = [...doc.querySelectorAll(".confrow .conf-ends > span")].map(text);
  assert.deepEqual(ends, [`0 · ${EN.pane_confidence_0}`, `4 · ${EN.pane_confidence_4}`]);
  dom.window.close();
});

test("landmarks: the pane is the main region and the screen has a first-level heading", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next());
  const pane = doc.querySelector("#pane");
  assert.ok(pane.tagName === "MAIN" || pane.getAttribute("role") === "main");
  assert.equal(doc.querySelectorAll("#pane h1").length, 1);
  dom.window.close();
});

test("C1: a compact session line, a short voice chip, and an action bar with confidence, « Submit » and « Help »", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next({ orientation: { step: { index: 6, total: 32 }, minutes_left: 67, reviews_due: 1, waiting: "answer" } }));
  assert.equal(text(doc.querySelector(".session-line")), "Step 6/32 · about 67 min · 1 due for review");
  const chip = doc.querySelector(".voice-chip");
  assert.equal(text(chip.querySelector("summary")), EN.pane_voice_short_validated);
  assert.equal(text(doc.querySelector(".voice-scene")), "Lesson validated by Prof. Test");
  const bar = doc.querySelector(".controls .action-bar");
  assert.ok(bar.querySelector(".confrow") && bar.querySelector(".validate") && bar.querySelector(".help-toggle"));
  assert.equal(doc.querySelector(".validate").disabled, true, "« Submit » waits for a choice");
  const order = [".choices input", ".confrow .conf", ".validate", ".help-toggle"].map((selector) => [...doc.querySelectorAll("#pane *")].indexOf(doc.querySelector(selector)));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "question, choices, confidence, submit, help");
  // The settings no longer follow the scene open: they are one disclosure away.
  dom.window.close();
});

test("C1: the rail follows the server's step; a detour is a marker, and aria-valuenow says the visible step", () => {
  const { dom, doc } = mountWithSend();
  const at = (index, extra = {}) => next({ scene: { ...QUIZ, id: `q${index}` }, orientation: { step: { index, total: 32 }, reviews_due: 0, waiting: "answer", ...extra } });
  dom.window.renderView(at(27));
  dom.window.renderView(at(5));
  const bar = () => doc.querySelector(".progress[role=progressbar]");
  assert.equal(bar().getAttribute("aria-valuenow"), "5", "the rail goes back with the server");
  assert.match(text(doc.querySelector(".session-line")), /^Step 5\/32/);
  dom.window.renderView(at(28, { step: { index: 28, total: 32, detour: { returns_to: "q5" } } }));
  assert.equal(bar().getAttribute("aria-valuenow"), "5", "a detour does not jump");
  assert.match(text(doc.querySelector(".session-line")), /^Step 5\/32 · detour, back to “A question”/);
  assert.ok(doc.querySelector(".progress [data-state=detour]"), "the detour is a marker");
  dom.window.close();
});

test("C4: one « Help » control opens the ladder in place; a hint lands under the question; the settings are collapsed", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next({ actions: ["respond", "hint", "end", "ask", "setAttention"] }));
  const toggle = doc.querySelector(".help-toggle");
  const ladder = doc.querySelector(".help-ladder");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), ladder.id);
  assert.ok(ladder.hidden);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(ladder.hidden, false);
  assert.ok(ladder.querySelector(".ask-slot"), "the question field opens here");
  dom.window.renderView(next({ actions: ["respond", "hint", "end", "ask", "setAttention"], hint: { hint: "Think of the definition", remaining: 0 } }));
  const hint = doc.querySelector("#hint");
  assert.match(text(hint), /Think of the definition/);
  assert.ok(doc.querySelector(".question").compareDocumentPosition(hint) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(hint.compareDocumentPosition(doc.querySelector(".controls")) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "under the question, above the choices");
  const settings = doc.querySelector(".settings").closest("details");
  assert.ok(settings && !settings.open, "the settings are behind a closed disclosure");
  dom.window.close();
});

test("C1: a detour back to a scene not shown yet keeps the last step the server gave on the path", () => {
  const { dom, doc } = mountWithSend();
  const at = (id, index, extra = {}) => next({ scene: { ...QUIZ, id }, orientation: { step: { index, total: 32, ...extra }, reviews_due: 0, waiting: "answer" } });
  dom.window.renderView(at("q6", 6));
  dom.window.renderView(at("recall", 28, { detour: { returns_to: "q7-not-yet-shown" } }));
  assert.equal(doc.querySelector(".progress[role=progressbar]").getAttribute("aria-valuenow"), "6");
  assert.equal(text(doc.querySelector(".session-line")), "Step 6/32 · detour");
  dom.window.close();
});

test("B2: a last hint says no « (0 left) » and prints nothing else", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next({ hint: { hint: "Think of the definition", remaining: 0 } }));
  assert.equal(text(doc.querySelector("#hint .hint-body")), "Think of the definition");
  assert.doesNotMatch(text(doc.querySelector("#hint")), /null|left/);
  dom.window.close();
});

// Follow-up 2026-11-10 (the server fields of the integrated fixes).
test("a detour reads the main-path step the server gives: the session line, the rail and aria-valuenow agree", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next({ scene: { ...QUIZ, id: "recall" }, progress: { index: 27, total: 32, detour: { returns_to_scene_id: "q5", returns_to_title: "Quantum numbers", returns_to_index: 5 } },
    orientation: { step: { index: 27, total: 32, detour: { returns_to: "q5" }, main: { index: 5, title: "Quantum numbers" } }, minutes_left: 70, reviews_due: 0, waiting: "answer" } }));
  assert.equal(doc.querySelector(".progress[role=progressbar]").getAttribute("aria-valuenow"), "5");
  assert.equal(text(doc.querySelector(".session-line")), "Step 5/32 · detour, back to “Quantum numbers” · about 70 min");
  assert.ok(doc.querySelector(".progress [data-state=detour]"));
  dom.window.renderView(next({ scene: { ...QUIZ, id: "q5" }, orientation: { step: { index: 5, total: 32 }, reviews_due: 0, waiting: "answer" } }));
  assert.equal(doc.querySelector(".progress[role=progressbar]").getAttribute("aria-valuenow"), "5");
  dom.window.close();
});

test("the explanation rung is labelled by what it explains, and asks for it", () => {
  const { dom, doc, sent } = mountWithSend();
  const open = (explains, session_id) => next({ session_id, help: { rungs: [{ kind: "explain", available: true }], explains } });
  dom.window.renderView(open("last_answer", "a"));
  const rung = doc.querySelector("[data-rung=explain]");
  assert.equal(text(rung), EN.pane_help_explain_last);
  rung.click();
  assert.deepEqual(plain(sent.at(-1)[0]), { type: "ask", text: EN.pane_help_explain_last_question });
  dom.window.renderView(open("screen", "b"));
  assert.equal(text(doc.querySelector("[data-rung=explain]")), EN.pane_help_explain_screen);
  dom.window.renderView(open(undefined, "c"));
  assert.equal(text(doc.querySelector("[data-rung=explain]")), EN.pane_help_explain);
  dom.window.close();
});

test("every answer the panel submits names the scene the learner was looking at", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(next());
  doc.querySelector(".choices input").click();
  doc.querySelector(".validate").click();
  assert.deepEqual(plain(sent.at(-1)[0]), { type: "respond", input: { kind: "quiz_choice", choiceId: "a" }, expected_scene_id: "quiz" });
  dom.window.renderView(next({ session_id: "two", scene: READING }));
  doc.querySelector(".controls .st-button--primary").click();
  assert.deepEqual(plain(sent.at(-1)[0]), { type: "respond", input: { kind: "ack" }, expected_scene_id: "intro" });
  dom.window.close();
});

test("a stale-scene refusal is a calm notice, not « try again »", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next());
  dom.window.renderView({ type: "action_error", action: "respond", message: JSON.stringify({ error: "the scene changed: read the current scene, then send the learner's answer to it" }) });
  const status = doc.querySelector("#action-status");
  assert.equal(text(status), EN.pane_scene_changed);
  assert.match(status.className, /notice/);
  dom.window.close();
});

test("the sticky bar's height is kept free at the bottom of the scrolling page, so no choice stays under it", async () => {
  const { dom, doc } = mountWithSend();
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return this.classList.contains("action-bar") ? 120 : 0; } });
  Object.defineProperty(dom.window, "innerHeight", { configurable: true, value: 760 });
  dom.window.renderView(next());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(doc.documentElement.style.getPropertyValue("--st-bar-space"), "120px");
  dom.window.close();
});

test("after « Session lost », the same view coming back (the server reopens the open session) is drawn again", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(next());
  dom.window.renderView({ type: "action_error", message: "session not found: one" });
  assert.ok(doc.querySelector(".session-lost"));
  dom.window.renderView(next());
  assert.equal(doc.querySelector(".session-lost"), null);
  assert.ok(doc.querySelector(".scene-title"));
  dom.window.close();
});
