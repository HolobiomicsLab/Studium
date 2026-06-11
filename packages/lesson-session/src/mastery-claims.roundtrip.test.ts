import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildMasteryClaims } from "./mastery-claims";
import type { LearnerState } from "@studium/learner-state";

/**
 * GATED true round-trip: when the real indicium package is importable (in its
 * own .venv), validate every emitted mastery node through the generated Pydantic
 * model (Claim/Evidence.model_validate, extra="forbid"). Parity with the Python
 * gated test (test_provenance_graph_to_indicium_conformance.py). SKIPS cleanly
 * when indicium is not installed — never a hard dependency of this package.
 *
 * Override the interpreter via STUDIUM_INDICIUM_PYTHON; defaults to the sibling
 * repo's venv. The check requires the interpreter to actually import indicium.
 */
const INDICIUM_PYTHON =
  process.env.STUDIUM_INDICIUM_PYTHON ?? "/Users/holobiomicslab/git/indicium/.venv/bin/python";

function indiciumImportable(): boolean {
  if (!existsSync(INDICIUM_PYTHON)) return false;
  try {
    execFileSync(INDICIUM_PYTHON, ["-c", "import indicium.generated.model"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function cs(alpha: number, beta: number, total_attempts = 3) {
  return { concept_id: "x", alpha, beta, consecutive_errors: 0, total_attempts, total_correct: 2, confidence_calibration: 0.1 };
}
function state(concept_states: Record<string, ReturnType<typeof cs>>): LearnerState {
  return { lesson_id: "L1", schema_version: "1.0", concept_states, scenes_completed: [], scenes_replayed: {}, history: [], session_started_at: "2026-06-11T00:00:00Z", last_decision: null } as unknown as LearnerState;
}
const OPTS = { pseudonym: "anon-7", sessionId: "sess-1", bundleId: "L1", activeUniverseId: "baseline", threshold: 0.8 };

const RUN = indiciumImportable();

const DECISION_CONTEXT_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

const VALIDATE_PY = `
import sys, json
from indicium.generated.model import Claim, Evidence
doc = json.load(sys.stdin)
for node in doc["@graph"]:
    body = {k: v for k, v in node.items() if k not in ("@type", "@context")}
    if node.get("@type") == "asb:Claim":
        Claim.model_validate(body)
    elif node.get("@type") == "sepio:0000002":
        Evidence.model_validate(body)
print("OK")
`;

describe.skipIf(!RUN)("buildMasteryClaims round-trips through the real indicium model", () => {
  it("Claim + Evidence nodes pass model_validate", () => {
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), OPTS);
    const out = execFileSync(INDICIUM_PYTHON, ["-c", VALIDATE_PY], { input: JSON.stringify(doc) }).toString();
    expect(out.trim()).toBe("OK");
  });

  it("breaking universe id 'remedial-v2' is sanitized and still validates against real indicium model", () => {
    const opts = { ...OPTS, activeUniverseId: "remedial-v2" };
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), opts);
    // Check the dotted pattern first (catches the bug immediately)
    const ev = doc["@graph"].find((n) => (n as Record<string, unknown>)["@type"] === "sepio:0000002") as Record<string, unknown>;
    const dc = ev.decision_context as string[];
    expect(dc).toBeDefined();
    expect(DECISION_CONTEXT_RE.test(dc[0]!)).toBe(true);
    // Then pass through the real Pydantic model
    const out = execFileSync(INDICIUM_PYTHON, ["-c", VALIDATE_PY], { input: JSON.stringify(doc) }).toString();
    expect(out.trim()).toBe("OK");
  });

  it("breaking universe id '2024-cohort' (leading digit) is sanitized and still validates against real indicium model", () => {
    const opts = { ...OPTS, activeUniverseId: "2024-cohort" };
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), opts);
    const ev = doc["@graph"].find((n) => (n as Record<string, unknown>)["@type"] === "sepio:0000002") as Record<string, unknown>;
    const dc = ev.decision_context as string[];
    expect(dc).toBeDefined();
    expect(DECISION_CONTEXT_RE.test(dc[0]!)).toBe(true);
    const out = execFileSync(INDICIUM_PYTHON, ["-c", VALIDATE_PY], { input: JSON.stringify(doc) }).toString();
    expect(out.trim()).toBe("OK");
  });
});
