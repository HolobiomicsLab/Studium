// Verify the TEACHER analytics path end to end: run a few full sessions with consented telemetry,
// then tools/class_report.py aggregates them (k-anonymous). Run from repo root:
//   node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/teacher_check.mjs
import { rmSync } from "node:fs";
import { SessionHost } from "../../packages/lesson-session-host/src/index.ts";

const DATA = `${process.cwd()}/fixtures/data`;
process.env.STUDIUM_DATA_DIR = DATA;              // same dir the extension uses (bundlesRoot/data)
process.env.STUDIUM_TELEMETRY_CONSENT = "granted";
try { rmSync(DATA, { recursive: true, force: true }); } catch { /* fresh */ }

const host = new SessionHost({ bundlesRoot: "fixtures", live: false });

async function runOne(learnerId, beGood) {
  const { sessionId, presentation } = await host.create("atomistique-l1/lesson.json", learnerId);
  let pres = presentation;
  for (let i = 0; i < 160; i++) {
    const sc = pres.scene;
    let input;
    if (sc.type === "quiz") {
      const correct = (sc.choices || []).find((x) => x.correct) || sc.choices[0];
      const wrong = (sc.choices || []).find((x) => !x.correct) || sc.choices[0];
      input = { kind: "quiz_choice", choiceId: (beGood || Math.random() > 0.4 ? correct : wrong).id };
    } else if (sc.type === "meta_checkpoint") input = { kind: "confidence", value: beGood ? 3 : 1 };
    else if (sc.type === "ai_critique") input = { kind: "critique", text: "ok" };
    // active-learning scenes: a "good" learner names the flaws / covers the key points (accent-free
    // markers the offline matcher recognises); a "weak" learner does not.
    else if (sc.type === "spot_the_flaw") input = { kind: "flaw_report", text: beGood ? "viole la regle de hund, trois electrons celibataires a spins paralleles, la bonne configuration est 2p3" : "rien a signaler" };
    else if (sc.type === "explain_back") input = { kind: "explanation", text: beGood ? "la fonction d'onde change de signe oppose d'un lobe a l'autre, separes par un plan nodal ou la probabilite de presence est nulle" : "je ne sais pas" };
    else input = { kind: "ack" };
    const t = await host.respond(sessionId, input);
    if (t.kind === "complete") return true;
    pres = t.presentation;
  }
  return false;
}

let done = 0;
for (const [id, good] of [["alice", true], ["bob", false], ["carol", true], ["dan", false], ["eve", true]]) {
  if (await runOne(id, good)) done++;
}
console.log(`completed ${done}/5 learner sessions → telemetry under ${DATA}`);
