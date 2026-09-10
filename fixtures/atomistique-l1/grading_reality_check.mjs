// GRADING REALITY CHECK — a diagnostic, not an assertion.
//
// The other drivers in this directory answer the active-learning scenes with text built FROM the
// authored cue strings, so they prove the pipeline runs; they cannot prove it grades. This one
// answers as real L1 students would — correct chemistry in the student's own words, and wrong
// chemistry that happens to contain the cue words — and prints where Studium's verdict parts
// company with a teacher's.
//
// Offline (the default tester path: no LITELLM_BASE_URL, no :8002 shim) every free-text scene is
// graded by matchClaimsAgainstCritique, which credits a claim when its cue string appears
// ANYWHERE in the answer. It has no notion of negation, of who is asserting what, or of whether
// there are sentences at all. Run it and read the ✗ rows:
//   node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/grading_reality_check.mjs
// Exits 0 always — it reports, it does not gate.
import { readFileSync } from "node:fs";
import { grade } from "../../packages/lesson-session/src/grading/index.ts";
import { StubCritiqueEvaluator } from "../../packages/lesson-session/src/adapters/critique-evaluator.ts";

const deps = { critiqueEvaluator: new StubCritiqueEvaluator() };
const bundle = JSON.parse(readFileSync(new URL("./lesson.json", import.meta.url), "utf8"));
const byId = Object.fromEntries(bundle.scenes.map((s) => [s.id, s]));
const KIND = { spot_the_flaw: "flaw_report", explain_back: "explanation", comparison: "comparison",
  summary_audit: "summary_audit", prompt_practice: "prompt_submission", communication_sim: "communication" };

// teacher = the mark a chemistry teacher would give this answer for this scene.
const CASES = [
  { s: "s5b-spot-azote", teacher: "PASS", p: "correct: names the miscount and the unpaired electrons, never says 'Hund' or 'célibataire'",
    t: "La configuration est fausse : l'azote a 7 électrons, donc 1s² 2s² 2p³ et non 2p⁴. Dans une sous-couche p à moitié remplie les trois électrons restent non appariés, chacun dans une orbitale différente, spins parallèles." },
  { s: "s5b-spot-azote", teacher: "FAIL", p: "denies there is any flaw, in the scene's own vocabulary",
    t: "Je ne vois aucune erreur dans ce texte. La règle de Hund est bien respectée, l'azote n'a pas d'électrons célibataires et la configuration 2p3 donnée est correcte." },
  { s: "s5b-spot-azote", teacher: "FAIL", p: "the three cue words, no sentence", t: "hund celibataires 2p3" },
  { s: "s5b-spot-azote", teacher: "FAIL", p: "blank-ish (control)", t: "je ne sais pas" },

  { s: "s3b-explain-2p", teacher: "PASS", p: "correct teach-back in the student's own words",
    t: "L'amplitude de l'électron change de sens de part et d'autre du noyau : positive d'un côté, négative de l'autre, d'où les deux lobes. Entre les deux elle s'annule, donc l'électron ne s'y trouve jamais, et les lobes sont les régions où on a le plus de chances de le trouver." },
  { s: "s3b-explain-2p", teacher: "FAIL", p: "the cue words inside a physically wrong explanation",
    t: "La fonction d onde a deux lobes de signe oppose parce que l'electron tourne sur une orbite en huit ; le plan nodal est l'endroit ou il va le plus vite et la probabilite presence y est maximale." },

  { s: "s4b-audit-spectres", teacher: "PASS", p: "correct audit, natural phrasing",
    t: "Le résumé passe sous silence le caractère discret des niveaux — la raison même des raies. Il ne donne pas la relation entre l'énergie de la transition et la fréquence émise. Et il nomme la série sans dire qu'elle correspond aux transitions vers n=2, dans le domaine que l'œil perçoit." },
  { s: "s4b-audit-spectres", teacher: "FAIL", p: "praises the summary while listing the words",
    t: "Le résumé IA est fidèle et complet : il parle bien de l'énergie du photon, du fait que c'est quantifié, et de la série de Balmer dans le visible. Rien ne manque." },

  { s: "s3d-communicate-2p", teacher: "PASS", p: "good jargon-free analogy — a different image from the authored one",
    t: "Imagine deux bulles collées de part et d'autre du noyau. L'électron passe son temps dans l'une ou dans l'autre, comme quelqu'un qui fait des allers-retours entre deux chambres. Juste au milieu, sur la cloison, il n'est jamais là." },
  { s: "s3d-communicate-2p", teacher: "FAIL", p: "pure jargon — exactly what this scene forbids",
    t: "Deux zones de densité électronique, image d'une fonction propre de l'hamiltonien ; l'électron ne passe jamais par le plan nodal, un couloir de probabilité nulle." },

  { s: "s5d-prompt-hund", teacher: "PASS", p: "a genuinely good prompt, worded freely",
    t: "Tu t'adresses à un étudiant de première année qui connaît déjà Klechkowski et Pauli. Détaille le raisonnement qui justifie la règle de Hund, appuie-toi sur le cas de l'azote, et présente le résultat en cases quantiques, étape par étape." },
  { s: "s5d-prompt-hund", teacher: "FAIL", p: "four cue words in a row", t: "explique l1 exemple schema" },
];

const pad = (s, n) => String(s).padEnd(n);
const rows = [];
for (const c of CASES) {
  const sc = byId[c.s];
  const r = await grade(sc, { kind: KIND[sc.type], text: c.t }, deps);
  const tel = r.telemetry.find((x) => x.type === "critique_submitted");
  const studium = r.signal.correct ? "PASS" : "FAIL";
  rows.push({ ...c, studium, score: tel.llm_score, cover: tel.completion_rate, agree: studium === c.teacher });
}
console.log(`\n  ${pad("SCENE", 22)} ${pad("TEACHER", 8)} ${pad("STUDIUM", 8)} ${pad("score", 6)} ${pad("cover", 6)} ANSWER`);
console.log("  " + "-".repeat(128));
for (const r of rows) {
  console.log(`${r.agree ? "  " : "✗ "}${pad(r.s, 22)} ${pad(r.teacher, 8)} ${pad(r.studium, 8)} ${pad(r.score.toFixed(2), 6)} ${pad(r.cover.toFixed(2), 6)} ${r.p}`);
}
const dis = rows.filter((r) => !r.agree);
console.log(`\n  ${rows.length} answers, ${dis.length} graded against the teacher.`);
console.log(`  ${rows.filter((r) => r.teacher === "PASS" && r.studium === "FAIL").length} correct answers marked wrong; ` +
  `${rows.filter((r) => r.teacher === "FAIL" && r.studium === "PASS").length} wrong answers marked right.\n`);
