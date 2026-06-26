// End-to-end check for the active-learning scenes: drive the atomistique-l1 bundle to completion,
// and at each active-learning scene (spot_the_flaw / explain_back / comparison / summary_audit /
// prompt_practice) submit a GOOD answer and confirm the scene's concept mastery moves (the scene
// feeds the Beta posterior like a quiz/critique). Offline, no API key.
// Run from repo root: node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/active_learning_check.mjs
import { SessionHost } from "../../packages/lesson-session-host/src/index.ts";

const host = new SessionHost({ bundlesRoot: "fixtures", live: false });
const { sessionId, presentation } = await host.create("atomistique-l1/lesson.json", "active-tester");

// A GOOD answer per scene.type — the DEFAULT used when a type has a single instance.
const GOOD = {
  spot_the_flaw: "viole la regle de hund, trois electrons celibataires a spins paralleles, la bonne configuration est 2p3",
  explain_back: "la fonction d'onde change de signe oppose d'un lobe a l'autre, separes par un plan nodal ou la probabilite de presence est nulle",
  comparison: "le cours de l'enseignant signale le piege 4s avant 3d, donne le contre-exemple du chrome qui viole la regle, et nuance que c'est un guide",
  summary_audit: "le resume oublie que les niveaux sont quantifies, omet la relation d'energie du photon, et ne dit pas que balmer est dans le visible",
  prompt_practice: "explique pourquoi, en restant pour un niveau l1, en moins de 150 mots, et donne la reponse en trois points numerotes",
  communication_sim: "je te fais une image simple : deux zones de chaque cote du noyau, comme deux pieces separees par un couloir, avec au milieu un endroit ou l'electron ne passe jamais",
};
// Per-scene overrides: a type can have SEVERAL instances with DIFFERENT cue sets (Wave1-C added a
// comparison/summary_audit/prompt_practice on other concepts), so a type-level answer no longer fits
// every scene. Key by scene.id where the cues differ; fall back to GOOD[type] otherwise.
const GOOD_BY_ID = {
  // summary_audit on c-particules (Z/protons defines the element; isotopes)
  "s1b-audit-particules": "le resume oublie que z le nombre de protons definit l'element, et il omet la definition des isotopes",
  // comparison on c-orbitales-formes (radial vs angular nodes)
  "s3c-compare-noeuds": "l'enseignant distingue le noeud radial spherique du noeud angulaire qui est un plan, il relie la formule a l'orbitale 3d avec ses deux lobes",
  // prompt_practice on c-remplissage (regle de Hund) — cues: explique, l1, exemple, schema
  "s5d-prompt-hund": "explique pourquoi, pour un niveau l1, avec un exemple comme l'azote, et donne un schema de cases quantiques",
};
const goodFor = (sc) => GOOD_BY_ID[sc.id] ?? GOOD[sc.type];
// scene.type -> ResponseInput.kind for the active-learning scenes.
const AL_INPUT_KIND = {
  spot_the_flaw: "flaw_report",
  explain_back: "explanation",
  comparison: "comparison",
  summary_audit: "summary_audit",
  prompt_practice: "prompt_submission",
  communication_sim: "communication",
};
const masteryOf = (pres, cid) => (pres.learnerSnapshot?.conceptMastery || {})[cid];

// Drive a session to completion. `weakBefore` (optional set of scene ids) get a deliberately WEAK answer
// so the concept does not certify (mastery_c >= 0.8 → skip_to_next_concept) before a later same-concept
// scene is reached — this is how the second pass reaches communication_sim, which the default GOOD walk
// skips once c-orbitales-formes is mastered by the quiz+explain_back+comparison trio that precedes it.
async function walk(sessionId, presentation, { weakBefore = new Set() } = {}) {
  let pres = presentation;
  const seen = [];
  for (let step = 0; step < 200; step++) {
    const sc = pres.scene;
    const weak = weakBefore.has(sc.id);
    let input;
    if (sc.type === "quiz") {
      const c = weak ? (sc.choices || []).find((x) => !x.correct) : (sc.choices || []).find((x) => x.correct);
      input = { kind: "quiz_choice", choiceId: (c || sc.choices[0]).id };
    }
    else if (sc.type === "meta_checkpoint") input = { kind: "confidence", value: 3 };
    else if (sc.type === "ai_critique") input = { kind: "critique", text: "ok" };
    else if (AL_INPUT_KIND[sc.type]) input = { kind: AL_INPUT_KIND[sc.type], text: weak ? "je ne sais pas" : goodFor(sc) };
    else input = { kind: "ack" };

    const isAL = Boolean(AL_INPUT_KIND[sc.type]);
    const cid = sc.concept_refs?.[0];
    const before = isAL ? masteryOf(pres, cid) : undefined;

    const t = await host.respond(sessionId, input);

    if (isAL && !weak) {
      const after = t.presentation ? masteryOf(t.presentation, cid) : masteryOf(pres, cid);
      const body = sc.flawed_content ?? sc.prompt ?? sc.source_content ?? sc.task;
      seen.push({ id: sc.id, type: sc.type, concept: cid, before, after });
      console.log(`\n● ${sc.type}  (${sc.id})  → concept ${cid}`);
      console.log(`  body: ${String(body).slice(0, 72)}…`);
      console.log(`  answered GOOD → transition ${t.kind};  mastery[${cid}] ${before?.toFixed?.(3) ?? "—"} → ${after?.toFixed?.(3) ?? "—"}`);
    }
    if (t.kind === "complete") { console.log(`\nlesson completed at step ${step}.`); break; }
    pres = t.presentation;
  }
  return seen;
}

const seen = await walk(sessionId, presentation);

// Second pass — the communication_sim scene (s3d-communicate-2p) sits 4th on c-orbitales-formes, AFTER the
// quiz+explain_back+comparison trio: the comparison is the 3rd answer-graded attempt, which tips mastery_c
// >= 0.8 (total_attempts >= 3) and fires rule_mastery_high_skip (skip_to_next_concept), so the default GOOD
// walk skips it. Reach it with a fresh session where ONLY the immediately-preceding comparison gets a WEAK
// answer (one error → no replay loop; mastery_c stays < 0.8 → no skip), then answer communication_sim GOOD
// and assert it feeds the concept's mastery — the same end-to-end property asserted for the other scenes.
const COMM_WEAK_BEFORE = new Set(["s3c-compare-noeuds"]);
{
  const r2 = await host.create("atomistique-l1/lesson.json", "comm-tester");
  const seen2 = await walk(r2.sessionId, r2.presentation, { weakBefore: COMM_WEAK_BEFORE });
  const comm = seen2.find((s) => s.type === "communication_sim");
  if (comm) seen.push(comm);
}

const types = seen.map((s) => s.type);
const REQUIRED = ["spot_the_flaw", "explain_back", "comparison", "summary_audit", "prompt_practice", "communication_sim"];
const missing = REQUIRED.filter((t) => !types.includes(t));
if (missing.length) {
  console.error("FAIL: did not encounter all active-learning scenes; missing:", missing, "saw:", types);
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
