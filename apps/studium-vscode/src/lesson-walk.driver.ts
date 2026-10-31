// lesson-walk.driver.ts — END-TO-END proof that every scene type the extension wires now round-trips
// through the REAL lesson-mcp server + REAL graders without a SceneGradingError.
//
// Before Wave 1-3 the extension submitted {kind:"ack"} for comparison / summary_audit /
// prompt_practice / communication_sim (their graders THROW on a mismatched kind → the lesson hard-
// broke) and never reached the discussion turn loop. This walks two bundles to completion, picking
// the SAME ResponseInput the extension now sends (via scene-io.freeTextInput + the discussion
// submit_turn path), and asserts: (a) no submit ever throws, (b) every targeted scene type was
// exercised, (c) the bundle reaches `complete`.
//
// Run from the repo root (spawns the MCP server over stdio, like the extension does):
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/lesson-walk.driver.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freeTextInput } from "./scene-io.js";
import { JSDOM } from "jsdom";
import { browserPhrases, phrase } from "./phrases.js";
import { isolateFromHome } from "./driver-isolation.js";

type Json = Record<string, any>;
const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");           // apps/studium-vscode/src → repo root
// Launch through Node's loader instead of the tsx CLI. The CLI opens an IPC socket for its cache,
// which is unavailable in restricted CI/sandbox runners; the loader executes the same TypeScript.
const tsxLoader = resolve(repoRoot, "node_modules/.pnpm/node_modules/tsx/dist/loader.mjs");
const mcpDir = resolve(repoRoot, "apps/lesson-mcp");
// I-10: the server this walk starts keeps its state in memory under a temporary STUDIUM_HOME, never in ~/.studium.
const isolation = isolateFromHome("lesson-walk");

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

// --- the pane mirror (plan W4 acceptance) -------------------------------------------------------------
// Every REAL transition of the walk is posted to the REAL pane script (media/artifact-pane.js in jsdom)
// the way extension.ts posts it. The pane must show a graded verdict as its own step before the next
// scene, never print a rule id or a reason code, and end on the completion screen.
const paneSrc = readFileSync(resolve(here, "..", "media", "artifact-pane.js"), "utf8");
const RULE_ID = /\brule_[a-z0-9_]+/i;

function mountPane() {
  const dom = new JSDOM(`<!doctype html><html><body class="st-scope"><div id="pane"></div></body></html>`, {
    runScripts: "outside-only", pretendToBeVisual: true,
  });
  const win = dom.window as any;
  win.eval(paneSrc);
  win.__send = () => {}; // the walk answers through MCP itself, so the pane's own messages are dropped
  const $ = (sel: string) => win.document.querySelector(sel);
  return {
    $,
    post: (data: Json) => win.dispatchEvent(new win.MessageEvent("message", { data })),
    text: () => String($("#pane")?.textContent ?? ""),
  };
}
type Pane = ReturnType<typeof mountPane>;

function checkVisible(pane: Pane, label: string, t: Json | null) {
  const text = pane.text();
  expect(!RULE_ID.test(text), `${label}: no rule id is visible (found ${text.match(RULE_ID)?.[0]})`);
  const nav = t?.navigation;
  if (nav?.rule_id) expect(!text.includes(nav.rule_id), `${label}: the rule ${nav.rule_id} is not printed`);
  // An identifier-like reason ("errors_threshold") is engine vocabulary, not a sentence for the learner.
  if (typeof nav?.reason === "string" && /^[a-z][a-z0-9_]*$/.test(nav.reason)) {
    expect(!new RegExp(`\\b${nav.reason}\\b`).test(text), `${label}: the reason code ${nav.reason} is not printed`);
  }
}

/** Post a presentation (and the transition that led to it) as extension.ts pushScene does. */
function showOnPane(pane: Pane, label: string, pres: Json, t: Json | null) {
  const locale = pres.locale === "en" ? "en" : "fr";
  pane.post({
    type: "render", locale, strings: browserPhrases(locale), scene_assets: [],
    scene: pres.scene, progress: { index: (pres.index ?? 0) + 1, total: pres.total },
    mastery: {}, reviewDue: [], calibration: [], authoring: pres.authoring ?? null,
    verdict: t?.verdict ?? null, navigation: t?.navigation ?? null, self_rating: t?.self_rating ?? null,
  });
  checkVisible(pane, label, t);
  if (t?.verdict?.graded) expect(!!pane.$(".feedback-step"), `${label}: the graded verdict is its own step`);
  pane.$(".feedback-step .continue")?.click();
  expect(!pane.$(".feedback-step") && !!pane.$(".scene-title"), `${label}: Continue leads to the next scene`);
  checkVisible(pane, label, t);
}

/** Post the end of the lesson as extension.ts does on `complete`. */
function showCompletion(pane: Pane, label: string, t: Json) {
  pane.post({
    type: "done", message: phrase("extension_done", { count: t.summary?.scenesCompleted ?? 0 }, "fr"),
    verdict: t.verdict ?? null, self_rating: t.self_rating ?? null,
    completion: { consolidated: [], to_revisit: [], detours: 0, next_review_at: t.review_plan?.next_due_at ?? null, due_now: 0, actions: ["restart", "pick"] },
  });
  if (t.verdict?.graded) expect(!!pane.$(".feedback-step"), `${label}: the last graded verdict is its own step`);
  pane.$(".feedback-step .continue")?.click();
  expect(!!pane.$(".completion"), `${label}: the lesson ends on the completion screen`);
  checkVisible(pane, label, t);
}

// All the answer-key cues a CORRECT free-text answer should hit, read from the UNREDACTED bundle on
// disk (the MCP server redacts them from the wire). Including them makes coverage pass so the
// mastery-gated router actually unlocks the later scenes (otherwise wrong answers stall the walk on
// the early frontier). This is the test reading the answer key — not the extension.
function cuesOf(raw: Json): string {
  const fromKeyPoints = (raw.key_points || []).flatMap((k: Json) => k.cues || []);
  const fromClaims = (raw.claims || []).flatMap((c: Json) => c.flaws_expected || []);
  const claimIds = (raw.claims || []).map((c: Json) => c.id);           // ai_critique counts mentioned claim ids
  return [...fromKeyPoints, ...fromClaims, ...claimIds].join(" ; ") || "réponse";
}

// Pick the input the extension's surfaces produce, but with a CORRECT payload (from `raw`) so the
// lesson progresses to completion. The KIND is exactly what the extension sends (scene-io); only the
// content is answer-key-informed, which is the part the runtime grades.
function inputFor(scene: Json, raw: Json): Json {
  if (scene.type === "quiz") {
    const correct = (raw.choices || []).find((c: Json) => c.correct);
    return { kind: "quiz_choice", choiceId: correct?.id ?? raw.choices?.[0]?.id ?? "a" };
  }
  if (scene.type === "meta_checkpoint") return { kind: "confidence", value: 3 };
  if (scene.type === "ai_critique") return { kind: "critique", text: cuesOf(raw) };
  const ft = freeTextInput(scene.type, cuesOf(raw));
  return ft ?? { kind: "ack" };
}

async function walk(bundlesRoot: string, bundleRef: string, expectTypes: string[], requireComplete: boolean) {
  // index the raw (unredacted) scenes by id so inputFor can answer correctly.
  const rawBundle: Json = JSON.parse(readFileSync(resolve(bundlesRoot, bundleRef), "utf8"));
  const rawById = new Map<string, Json>((rawBundle.scenes || []).map((s: Json) => [s.id, s]));
  const env: Record<string, string> = { ...(process.env as any), ...isolation.env, BUNDLES_ROOT: bundlesRoot };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", tsxLoader, "src/index.ts"],
    cwd: mcpDir,
    env,
    stderr: "ignore",
  });
  const client = new Client({ name: "lesson-walk", version: "0.0.0" });
  await client.connect(transport);
  const call = async (n: string, a: Json): Promise<Json> => {
    const r: any = await client.callTool({ name: n, arguments: a });
    const data = JSON.parse(r.content?.[0]?.text ?? "{}");
    if (r.isError) throw new Error(`${n}: ${data.error}`);
    return data;
  };

  const seen = new Set<string>();
  let completed = false;
  try {
    const started = await call("start_lesson_session", { bundle_ref: bundleRef, learner_id: "walk" });
    const sid = started.session_id as string;
    let pres = started.presentation as Json;
    const pane = mountPane();
    showOnPane(pane, `[${bundleRef}] first scene`, pres, null);
    // Who wrote the lesson (spec 2026-10-30): these are teacher lessons, so the pane receives an
    // authoring block without a notice, and draws no self-study banner on the demo. The server has a
    // judge model exactly when it runs live, i.e. when LITELLM_BASE_URL is set (lesson-mcp index.ts).
    expect(started.authoring?.mode === "teacher" && started.authoring?.notice === null,
      `[${bundleRef}] start_lesson_session says a teacher wrote the lesson, with no self-study notice`);
    expect(started.authoring?.judge === Boolean(process.env.LITELLM_BASE_URL),
      `[${bundleRef}] start_lesson_session reports judge=${Boolean(process.env.LITELLM_BASE_URL)} (got ${started.authoring?.judge})`);
    expect(JSON.stringify(pres.authoring) === JSON.stringify(started.authoring),
      `[${bundleRef}] the presentation the pane reads carries the same authoring block`);
    for (let step = 0; step < 400; step++) {
      const scene = pres.scene as Json;
      seen.add(scene.type);
      // ANSWER-KEY LEAK GUARD (2026-10-29 trial): nothing that restates the right answer may reach the
      // client before the answer — quiz feedback texts, hints, choice `correct` flags, cues, reveals.
      for (const key of ["feedback_correct", "feedback_incorrect", "hints", "claims", "key_points", "model_correction", "model_explanation", "model_answer"]) {
        expect(!(key in scene), `[${bundleRef}] public scene ${scene.id} (${scene.type}) exposes \`${key}\` before the answer`);
      }
      for (const c of scene.choices ?? []) expect(!("correct" in c), `[${bundleRef}] public quiz ${scene.id} exposes a choice \`correct\` flag`);
      // discussion is multi-turn: the extension submits a turn (submit_turn) then advances with ack.
      if (scene.type === "discussion") {
        await call("submit_turn", { session_id: sid, text: "Oui, parce que la configuration électronique l'explique — mais la charge nucléaire nuance l'effet." });
      }
      const input = inputFor(scene, rawById.get(scene.id) ?? scene);
      let t: Json;
      try {
        t = (await call("submit_response", { session_id: sid, input })).transition;
      } catch (e: any) {
        // a SceneGradingError here is exactly the Wave 1-3 bug — record the offending scene type.
        expect(false, `[${bundleRef}] submit_response threw for scene type "${scene.type}" with input kind "${input.kind}": ${e.message}`);
        break;
      }
      if (process.env.DEBUG_WALK) console.error(`  ${String(step).padStart(3)} ${scene.type}#${scene.id} [${input.kind}] → ${t.kind}`);
      // The transition states its verdict and its ONE navigation decision; a quiz verdict carries the
      // feedback the learner earned (the public scene no longer does).
      expect(!!t.navigation && typeof t.navigation.kind === "string", `[${bundleRef}] transition after ${scene.id} carries a navigation record`);
      if (t.kind !== "complete") expect(!!t.verdict && t.verdict.scene_id === scene.id, `[${bundleRef}] transition after ${scene.id} carries its verdict`);
      if (scene.type === "quiz" && t.kind !== "complete") expect(typeof t.verdict?.feedback === "string" && t.verdict.feedback.length > 0, `[${bundleRef}] quiz ${scene.id} verdict carries the earned feedback`);
      if (t.kind === "complete") { showCompletion(pane, `[${bundleRef}] end`, t); completed = true; break; }
      pres = t.presentation as Json;
      showOnPane(pane, `[${bundleRef}] ${scene.id} → ${pres.scene?.id}`, pres, t);
    }
  } finally {
    await client.close().catch(() => {});
  }

  for (const ty of expectTypes) expect(seen.has(ty), `[${bundleRef}] exercised scene type "${ty}" (seen: ${[...seen].sort().join(",")})`);
  if (requireComplete) expect(completed, `[${bundleRef}] lesson reached \`complete\` without a grading error`);
  return seen;
}

(async () => {
  // 1) wave-scenes — a minimal, UN-gated bundle (rules:[]) holding every active-learning scene type.
  //    Correct answers walk it linearly to `complete`, proving each Wave-1 type round-trips through
  //    its real grader with the kind the extension now sends (the kind-throw bug is gone).
  await walk(
    resolve(repoRoot, "apps/studium-vscode/src/fixtures"),
    "wave-scenes.json",
    ["spot_the_flaw", "explain_back", "comparison", "summary_audit", "prompt_practice", "communication_sim"],
    true,
  );

  // 2) all-scene-types — the only bundle with a discussion scene. Proves the Wave-2 turn loop
  //    (submit_turn) + ai_critique + reproduction, end-to-end to `complete`.
  await walk(
    resolve(repoRoot, "packages/lesson-session/src/fixtures"),
    "all-scene-types.json",
    ["discussion", "ai_critique", "reproduction"],
    true,
  );

  // 3) atomistique-l1 — the DEFAULT/demo bundle whose 4th scene is summary_audit (the case that hard-
  //    broke the lesson at scene 4 before the fix). Here we only assert it gets PAST summary_audit
  //    without a grading error — full completion is gated by the adaptive engine's mastery rules
  //    (out of scope: synthetic answers can't satisfy them), but the demo-breaking throw is gone.
  await walk(
    resolve(repoRoot, "fixtures"),
    "atomistique-l1/lesson.json",
    ["summary_audit"],
    false,
  );

  expect(isolation.homeUntouched(), `I-10: the walk wrote nothing into the home directory (${isolation.home})`);
  expect(!existsSync(resolve(isolation.studiumHome, "data")), "I-10: the ephemeral server kept no durable state under STUDIUM_HOME");

  if (failures.length) {
    console.error(`FAIL — ${failures.length}/${checks} lesson-walk assertions failed:`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`OK — lesson-walk passed all ${checks} assertions (both bundles completed, every wired scene type round-tripped without a grading error).`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
