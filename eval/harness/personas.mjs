// eval/harness/personas.mjs
// Pluggable STUDENT policies. A policy maps a presented scene + a running
// learner snapshot to a ResponseInput (response-input-schema.ts contract):
//   intro/concept/reproduction -> { kind: "ack" }
//   quiz                       -> { kind: "quiz_choice", choiceId }
//   meta_checkpoint            -> { kind: "confidence", value: 0..4 }
//   ai_critique                -> { kind: "critique", text }
//   discussion                 -> handled via submitTurn(text) before responding
//
// Three deterministic personas exercise different runtime branches:
//   proficient   — correct, calibrated-high; advances cleanly, mastery>=theta.
//   struggling   — wrong answers, low confidence; triggers replay/remediation,
//                  and (with an LWG) prereq-gating + universe escalation.
//   overconfident — wrong answers but confidence=4; exposes M3 calibration.
//
// The `claude` policy is async and shells the `claude` CLI per turn (live student).
// All policies expose: pick(scene, snapshot) -> { input, turns? } (turns are
// discussion submitTurn strings sent before the respond input).

import { spawnSync } from "node:child_process";

function correctChoiceId(scene) {
  const c = scene.choices.find((x) => x.correct);
  return c ? c.id : scene.choices[0].id;
}
function wrongChoiceId(scene) {
  const c = scene.choices.find((x) => !x.correct);
  return c ? c.id : scene.choices[0].id;
}
// Struggling/overconfident converge per CONCEPT (across different items), not per
// scene id: with multi-item remediation each error routes to a DIFFERENT unseen
// item, so a per-scene counter would reset every time and never reach "then
// correct" (infinite loop). Keying by concept models a learner who masters the
// idea after N attempts regardless of which item — and lets the run progress.
function conceptKey(scene) {
  return scene.concept_refs?.[0] ?? scene.id;
}

// A thorough critique that names every planted claim id AND echoes each
// flaws_expected phrase (so ai-audit-matcher scores true positives).
function thoroughCritique(scene) {
  const parts = scene.claims.map((cl) => {
    const flaws = (cl.flaws_expected || []).join(", ");
    return `Claim ${cl.id} is flawed: ${flaws}. The tutor's statement does not hold.`;
  });
  return parts.join(" ") + " Overall the tutor's claims are not adequately supported by evidence.";
}
function shallowCritique(scene) {
  // Mentions at most one claim id, no flaw keywords.
  const first = scene.claims[0];
  return first ? `I think ${first.id} sounds about right, not sure.` : "Looks fine to me.";
}

const proficient = {
  name: "proficient",
  pick(scene) {
    switch (scene.type) {
      case "quiz":
        return { input: { kind: "quiz_choice", choiceId: correctChoiceId(scene) } };
      case "meta_checkpoint":
        return { input: { kind: "confidence", value: 4 } }; // calibrated to high actual correctness
      case "ai_critique":
        return { input: { kind: "critique", text: thoroughCritique(scene) } };
      case "discussion":
        return {
          turns: [`A justification: ${scene.seed_claim} holds because the source supports it.`],
          input: { kind: "ack" },
        };
      default:
        return { input: { kind: "ack" } };
    }
  },
};

// STRUGGLING is stateful: it answers a given quiz WRONG the first `failsBefore`
// times it encounters that scene, then correct — modelling a student who
// eventually learns through remediation. This is what lets the run progress
// through replay -> prereq-gating -> universe escalation instead of looping
// forever on the same-item (the same-item-remediation defect #1 still shows up
// as the long replay streak in the transcript; without an eventual correct the
// session never advances at all, which the harness reports as a finding).
function makeStruggling(failsBefore = 2) {
  const seen = new Map(); // concept_key -> attempts (converge per-concept across items)
  return {
    name: "struggling",
    pick(scene) {
      switch (scene.type) {
        case "quiz": {
          const k = conceptKey(scene);
          const n = seen.get(k) ?? 0;
          seen.set(k, n + 1);
          const choiceId = n < failsBefore ? wrongChoiceId(scene) : correctChoiceId(scene);
          return { input: { kind: "quiz_choice", choiceId } };
        }
        case "meta_checkpoint":
          return { input: { kind: "confidence", value: 1 } }; // low, calibrated to low correctness
        case "ai_critique": {
          const k = conceptKey(scene);
          const n = seen.get(k) ?? 0;
          seen.set(k, n + 1);
          const text = n < failsBefore ? shallowCritique(scene) : thoroughCritique(scene);
          return { input: { kind: "critique", text } };
        }
        case "discussion":
          return { turns: ["Um, I am not sure what to say."], input: { kind: "ack" } };
        default:
          return { input: { kind: "ack" } };
      }
    },
  };
}

// OVERCONFIDENT: answers wrong but declares maximum confidence — exposes M3
// calibration (confidence 4 paired with low actual correctness). Stateful like
// struggling so it eventually advances and reaches the meta_checkpoint where the
// declared-vs-actual mismatch is observable; otherwise it loops forever.
function makeOverconfident(failsBefore = 2) {
  const seen = new Map();
  return {
    name: "overconfident",
    pick(scene) {
      switch (scene.type) {
        case "quiz": {
          const k = conceptKey(scene);
          const n = seen.get(k) ?? 0;
          seen.set(k, n + 1);
          const choiceId = n < failsBefore ? wrongChoiceId(scene) : correctChoiceId(scene);
          return { input: { kind: "quiz_choice", choiceId } };
        }
        case "meta_checkpoint":
          return { input: { kind: "confidence", value: 4 } }; // maximally confident (miscalibrated)
        case "ai_critique": {
          const k = conceptKey(scene);
          const n = seen.get(k) ?? 0;
          seen.set(k, n + 1);
          const text = n < failsBefore ? shallowCritique(scene) : thoroughCritique(scene);
          return { input: { kind: "critique", text } };
        }
        case "discussion":
          return { turns: ["Obviously correct, no doubt at all."], input: { kind: "ack" } };
        default:
          return { input: { kind: "ack" } };
      }
    },
  };
}

// HINT_RELIANT (P1): offloads onto scaffolding — answers a quiz WRONG once (to unlock
// heavy-scaffolding hints under remedial), then consumes every authored hint before
// answering correctly. The `hints` field tells the driver to call session.requestHint()
// before responding, which raises hint_count -> the M5 anti-offloading discount fires and
// autonomyRatio drops below 1.0 (the metric finally reflects scaffolding dependence).
function makeHintReliant(failsBefore = 0) {
  const seen = new Map();
  return {
    name: "hint_reliant",
    pick(scene) {
      switch (scene.type) {
        case "quiz": {
          const k = conceptKey(scene);
          const n = seen.get(k) ?? 0;
          seen.set(k, n + 1);
          const choiceId = n < failsBefore ? wrongChoiceId(scene) : correctChoiceId(scene);
          // Leans on hints for the FIRST couple of correct answers, then INTERNALISES and answers
          // autonomously: autonomyRatio stays <1 (exercises the M5 discount) but the autonomous
          // answers accumulate enough alpha to reach mastery -> the persona COMPLETES (a usable
          // EV-9 instrument), instead of offloading forever and hitting the turn cap.
          const wantsHint = n >= failsBefore && n < failsBefore + 2;
          return { input: { kind: "quiz_choice", choiceId }, hints: wantsHint ? (scene.hints?.length ?? 0) : 0 };
        }
        case "meta_checkpoint":
          return { input: { kind: "confidence", value: 2 } };
        case "ai_critique":
          return { input: { kind: "critique", text: shallowCritique(scene) } };
        case "discussion":
          return { turns: ["Can I get a hint?"], input: { kind: "ack" } };
        default:
          return { input: { kind: "ack" } };
      }
    },
  };
}

// MISCONCEPTION (M1): a learner with a STABLE misconception — repeatedly picks the SAME wrong
// distractor (the attractor = the last incorrect choice) before eventually correcting. Adds a
// distinct wrong-answer signature (vs struggling's "first wrong"), and is the consumer for the
// future misconception-tagged-distractor work (Eedi-style attractor mapping).
function makeMisconception(failsBefore = 2) {
  const seen = new Map();
  function attractorId(scene) {
    const wrongs = scene.choices.filter((x) => !x.correct);
    return wrongs.length ? wrongs[wrongs.length - 1].id : scene.choices[0].id;
  }
  return {
    name: "misconception",
    pick(scene) {
      switch (scene.type) {
        case "quiz": {
          const k = conceptKey(scene);
          const n = seen.get(k) ?? 0;
          seen.set(k, n + 1);
          const choiceId = n < failsBefore ? attractorId(scene) : correctChoiceId(scene);
          // asks for a hint WHILE stuck on the misconception (not once it clicks) -> sub-1.0 autonomy.
          return { input: { kind: "quiz_choice", choiceId }, hints: n < failsBefore ? 1 : 0 };
        }
        case "meta_checkpoint":
          return { input: { kind: "confidence", value: 3 } }; // confident in the misconception
        case "ai_critique":
          return { input: { kind: "critique", text: shallowCritique(scene) } };
        case "discussion":
          return { turns: ["I think it works the other way around."], input: { kind: "ack" } };
        default:
          return { input: { kind: "ack" } };
      }
    },
  };
}

// --- Live Claude student (shells the CLI per turn) ---
function renderScene(scene, snapshot) {
  const lines = [`SCENE TYPE: ${scene.type}`, `TITLE: ${scene.title}`];
  if (scene.markdown) lines.push(`CONTENT:\n${scene.markdown}`);
  if (scene.type === "quiz") {
    lines.push(`QUESTION: ${scene.question}`);
    lines.push("CHOICES:");
    for (const c of scene.choices) lines.push(`  [${c.id}] ${c.text}`);
  }
  if (scene.type === "meta_checkpoint") {
    lines.push(`PRE: ${scene.pre_question}`);
    lines.push(`SCALE (0..4): ${scene.scale_labels.join(" | ")}`);
  }
  if (scene.type === "ai_critique") {
    lines.push("CLAIMS TO CRITIQUE (some are deliberately flawed):");
    for (const cl of scene.claims) lines.push(`  - ${cl.id}: ${cl.text}`);
  }
  lines.push(`YOUR CURRENT MASTERY: ${JSON.stringify(snapshot.conceptMastery)}`);
  return lines.join("\n");
}

function claudeStudent(personaPrompt, model) {
  return {
    name: "claude",
    pick(scene, snapshot) {
      const sys =
        `You are simulating a STUDENT in an adaptive tutoring system. ${personaPrompt} ` +
        "Reply with STRICT JSON only matching the scene type:\n" +
        'quiz -> {"kind":"quiz_choice","choiceId":"<id>"}; ' +
        'meta_checkpoint -> {"kind":"confidence","value":0-4}; ' +
        'ai_critique -> {"kind":"critique","text":"..."}; ' +
        'intro/concept/reproduction -> {"kind":"ack"}.';
      const prompt = renderScene(scene, snapshot) + "\n\nRespond with the JSON ResponseInput now.";
      const args = ["-p", prompt, "--output-format", "json", "--append-system-prompt", sys];
      if (model) args.push("--model", model);
      const proc = spawnSync("claude", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      if (proc.status !== 0) throw new Error(`claude student failed: ${proc.stderr?.slice(0, 300)}`);
      const env = JSON.parse(proc.stdout);
      const text = env.result ?? "";
      const input = parseResponseInput(text, scene);
      return { input };
    },
  };
}

function parseResponseInput(text, scene) {
  let s = text.trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    obj = null;
  }
  // Validate against scene type; fall back to a safe default so a malformed
  // LLM turn never crashes the run (it gets recorded as a degraded turn).
  if (scene.type === "quiz") {
    const valid = obj && obj.kind === "quiz_choice" && scene.choices.some((c) => c.id === obj.choiceId);
    return valid ? obj : { kind: "quiz_choice", choiceId: scene.choices[0].id };
  }
  if (scene.type === "meta_checkpoint") {
    const v = obj && obj.kind === "confidence" ? Number(obj.value) : 2;
    return { kind: "confidence", value: Math.max(0, Math.min(4, Number.isFinite(v) ? v : 2)) };
  }
  if (scene.type === "ai_critique") {
    return obj && obj.kind === "critique" && typeof obj.text === "string"
      ? obj
      : { kind: "critique", text: text.slice(0, 800) };
  }
  return { kind: "ack" };
}

export function getPolicy(name, opts = {}) {
  switch (name) {
    case "proficient":
      return proficient;
    case "struggling":
      return makeStruggling(opts.failsBefore ?? 2);
    case "overconfident":
      // distinct trajectory (#1): commits confidently and self-corrects fast (1 error) — so its
      // run profile differs from struggling (2) and misconception (3); the auditor flagged collapse.
      return makeOverconfident(opts.failsBefore ?? 1);
    case "hint_reliant":
      return makeHintReliant(opts.failsBefore ?? 0);
    case "misconception":
      // a confused learner: holds the SAME wrong attractor and asks for a hint while stuck — so its
      // autonomyRatio is sub-1.0 (distinct from struggling's), giving a different run profile.
      return makeMisconception(opts.failsBefore ?? 2);
    case "claude":
      return claudeStudent(
        opts.personaPrompt ?? "Behave like a diligent average undergraduate.",
        opts.model,
      );
    default:
      throw new Error(`unknown persona policy: ${name}`);
  }
}

export const DETERMINISTIC_PERSONAS = [
  "proficient", "struggling", "overconfident", "hint_reliant", "misconception",
];
