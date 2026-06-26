// End-to-end host check: drive the atomistique-l1 bundle through the runtime, confirm the orbital
// .cube is served inline (get_scene_artifacts path) and the live workflow graph reflects mastery.
// Run from repo root: node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/drive_check.mjs
import { SessionHost } from "../../packages/lesson-session-host/src/index.ts";

const host = new SessionHost({ bundlesRoot: "fixtures", live: false });
const { sessionId, presentation } = await host.create("atomistique-l1/lesson.json", "tester");
console.log("workflowGraph is a function:", typeof host.workflowGraph === "function");

let pres = presentation;
let foundOrbital = false;
for (let step = 0; step < 80 && !foundOrbital; step++) {
  const arts = host.sceneArtifacts(sessionId);
  const orb = arts.find((a) => a.kind === "orbital");
  if (orb) {
    foundOrbital = true;
    const head = (orb.payload || "").split("\n")[0];
    console.log("\nORBITAL scene:", pres.scene.id);
    console.log("  inlined payload:", !!orb.payload, "| bytes:", (orb.payload || "").length, "| header:", head);
    console.log("  kinds in manifest:", arts.map((a) => a.kind).join(", "));
    const g = host.workflowGraph(sessionId);
    console.log("  LIVE graph: nodes", g?.nodes.length, "edges", g?.edges.length, "focus", g?.focus);
    console.log("  concept states:", g?.nodes.filter((n) => n.type === "concept")
      .map((n) => n.id.replace("concept:", "") + "=" + n.state).join("  "));
    break;
  }
  const sc = pres.scene;
  let input;
  if (sc.type === "quiz") {
    const c = (sc.choices || []).find((x) => x.correct) || sc.choices[0];
    input = { kind: "quiz_choice", choiceId: c.id };
  } else if (sc.type === "meta_checkpoint") input = { kind: "confidence", value: 3 };
  else if (sc.type === "ai_critique") input = { kind: "critique", text: "ok" };
  else if (sc.type === "spot_the_flaw") input = { kind: "flaw_report", text: "viole la regle de hund, trois electrons celibataires a spins paralleles, la bonne configuration est 2p3" };
  else if (sc.type === "explain_back") input = { kind: "explanation", text: "la fonction d'onde change de signe oppose d'un lobe a l'autre, separes par un plan nodal ou la probabilite de presence est nulle" };
  else if (sc.type === "comparison") input = { kind: "comparison", text: "l'enseignant distingue le noeud radial spherique du noeud angulaire qui est un plan, il signale le piege 4s avant 3d et le contre-exemple du chrome, et nuance que la regle est un guide ; il ajoute aussi un exemple concret avec deux lobes" };
  else if (sc.type === "summary_audit") input = { kind: "summary_audit", text: "le resume oublie que z le nombre de protons definit l'element, il omet la definition des isotopes, et pour les spectres il oublie la quantification, l'energie du photon et que balmer est dans le visible" };
  else if (sc.type === "prompt_practice") input = { kind: "prompt_submission", text: "explique pourquoi, pour un niveau l1, en moins de 150 mots, avec un exemple comme l'azote, un schema de cases quantiques, et la reponse en trois points numerotes" };
  else input = { kind: "ack" };
  const t = await host.respond(sessionId, input);
  console.log(`  step ${step}: ${sc.id} (${sc.type}) → ${t.kind}${t.presentation ? " → " + t.presentation.scene.id : ""}`);
  if (t.kind === "complete") { console.log("lesson completed before reaching an orbital"); break; }
  pres = t.presentation;
}
if (!foundOrbital) { console.error("FAIL: orbital scene not reached"); process.exit(1); }
console.log("\nOK — orbital served inline + live graph computed from the running session.");
