// End-to-end check for the active-learning scenes: drive the atomistique-l1 bundle to completion,
// and at each spot_the_flaw / explain_back scene submit a GOOD answer and confirm the scene's concept
// mastery moves (the scene feeds the Beta posterior like a quiz/critique). Offline, no API key.
// Run from repo root: node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/active_learning_check.mjs
import { SessionHost } from "../../packages/lesson-session-host/src/index.ts";

const host = new SessionHost({ bundlesRoot: "fixtures", live: false });
const { sessionId, presentation } = await host.create("atomistique-l1/lesson.json", "active-tester");

const GOOD = {
  spot_the_flaw: "viole la regle de hund, trois electrons celibataires a spins paralleles, la bonne configuration est 2p3",
  explain_back: "la fonction d'onde change de signe oppose d'un lobe a l'autre, separes par un plan nodal ou la probabilite de presence est nulle",
};
const masteryOf = (pres, cid) => (pres.learnerSnapshot?.conceptMastery || {})[cid];

let pres = presentation;
const seen = [];
for (let step = 0; step < 200; step++) {
  const sc = pres.scene;
  let input;
  if (sc.type === "quiz") { const c = (sc.choices || []).find((x) => x.correct) || sc.choices[0]; input = { kind: "quiz_choice", choiceId: c.id }; }
  else if (sc.type === "meta_checkpoint") input = { kind: "confidence", value: 3 };
  else if (sc.type === "ai_critique") input = { kind: "critique", text: "ok" };
  else if (sc.type === "spot_the_flaw") input = { kind: "flaw_report", text: GOOD.spot_the_flaw };
  else if (sc.type === "explain_back") input = { kind: "explanation", text: GOOD.explain_back };
  else input = { kind: "ack" };

  const isAL = sc.type === "spot_the_flaw" || sc.type === "explain_back";
  const cid = sc.concept_refs?.[0];
  const before = isAL ? masteryOf(pres, cid) : undefined;

  const t = await host.respond(sessionId, input);

  if (isAL) {
    const after = t.presentation ? masteryOf(t.presentation, cid) : masteryOf(pres, cid);
    const body = sc.type === "spot_the_flaw" ? sc.flawed_content : sc.prompt;
    seen.push({ id: sc.id, type: sc.type, concept: cid, before, after });
    console.log(`\n● ${sc.type}  (${sc.id})  → concept ${cid}`);
    console.log(`  body: ${String(body).slice(0, 72)}…`);
    console.log(`  answered GOOD → transition ${t.kind};  mastery[${cid}] ${before?.toFixed?.(3) ?? "—"} → ${after?.toFixed?.(3) ?? "—"}`);
  }
  if (t.kind === "complete") { console.log(`\nlesson completed at step ${step}.`); break; }
  pres = t.presentation;
}

const types = seen.map((s) => s.type);
if (!types.includes("spot_the_flaw") || !types.includes("explain_back")) {
  console.error("FAIL: did not encounter both active-learning scenes", types);
  process.exit(1);
}
// a GOOD answer must not LOWER the scene's concept mastery (it should feed it, like a correct quiz)
for (const s of seen) {
  if (typeof s.after !== "number") { console.error(`FAIL: ${s.id} has no mastery for ${s.concept}`); process.exit(1); }
  if (typeof s.before === "number" && s.after < s.before - 1e-9) {
    console.error(`FAIL: ${s.id} mastery dropped on a GOOD answer: ${s.before} → ${s.after}`); process.exit(1);
  }
}
console.log(`\nOK — drove both active-learning scenes (${seen.map((s) => s.id).join(", ")}); a good answer fed each concept's mastery (asserted non-decreasing).`);
