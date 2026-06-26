// review-fsrs.ts — client-side FSRS review-queue read for the VS Code extension.
//
// The authoritative scheduler lives in packages/adaptation-engine/src/fsrs.ts and is also exposed
// as SessionHost.reviewQueue(). The extension can't import that package: it is not a declared
// dependency and esbuild bundles only `vscode`, the MCP SDK, and typed-graph-lens. So we re-derive
// the SAME signal from the LearnerState the existing get_session_state MCP tool returns. These
// formulas are a verbatim copy of fsrs.ts's read side — keep them in lockstep. The companion driver
// (review-fsrs.driver.ts) asserts numeric parity against the real fsrs.ts.
//
// This surfaces, per concept, whether the learner is DUE for a spaced-repetition review. It is a
// recall-timing cue, NOT a mastery score, so it is safe to show the learner (no answer leak).

const DAY = 86_400_000;
const DECAY = -0.5;
const FACTOR = 19 / 81;
const W = [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61];

export type Mem = { stability: number; difficulty: number; last: number | null; reps: number };
const clampD = (d: number): number => Math.max(1, Math.min(10, d));

export function gradeFromAnswer(correct: boolean, hintCount: number): 1 | 2 | 3 {
  if (!correct) return 1;
  return hintCount > 0 ? 2 : 3;
}

export function retrievability(m: Mem, now: number): number {
  if (m.reps === 0 || m.last === null || m.stability <= 0) return 0;
  const t = Math.max(0, (now - m.last) / DAY);
  return Math.pow(1 + FACTOR * (t / m.stability), DECAY);
}

export function dueAt(m: Mem, rr = 0.9): number {
  if (m.last === null || m.stability <= 0) return 0;
  return m.last + (m.stability / FACTOR) * (Math.pow(rr, 1 / DECAY) - 1) * DAY;
}

export function isDue(m: Mem, now: number, rr = 0.9): boolean {
  if (m.reps === 0 || m.last === null) return true;
  return dueAt(m, rr) <= now;
}

function initD(g: number): number {
  return clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);
}

export function reviewMemory(m: Mem, grade: 1 | 2 | 3, now: number): Mem {
  if (m.reps === 0 || m.last === null || m.stability <= 0) {
    const s0 = grade === 1 ? W[0] : grade === 2 ? W[1] : W[2];
    return { stability: Math.max(0.1, s0), difficulty: initD(grade), last: now, reps: 1 };
  }
  const R = retrievability(m, now);
  const dNext = clampD(W[7] * initD(3) + (1 - W[7]) * (m.difficulty - W[6] * (grade - 3)));
  let sNext: number;
  if (grade === 1) {
    const sLapse = W[11] * Math.pow(dNext, -W[12]) * (Math.pow(m.stability + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R));
    sNext = Math.max(0.1, Math.min(sLapse, m.stability));
  } else {
    const hard = grade === 2 ? W[15] : 1;
    const inc = Math.exp(W[8]) * (11 - dNext) * Math.pow(m.stability, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) * hard;
    sNext = m.stability * (1 + Math.max(0, inc));
  }
  return { stability: sNext, difficulty: dNext, last: now, reps: m.reps + 1 };
}

type AnyJson = Record<string, any>;

/** Reconstruct one concept's FSRS memory from a LearnerState's answer history. */
export function memoryFromHistory(conceptId: string, state: AnyJson): Mem {
  const history: AnyJson[] = Array.isArray(state && state.history) ? state.history : [];
  let m: Mem = { stability: 0, difficulty: 0, last: null, reps: 0 };
  for (const h of history) {
    const sig = h && h.signal;
    if (!sig || sig.kind !== "answer_submitted" || sig.concept_id !== conceptId) continue;
    const t = Date.parse(h.timestamp);
    if (Number.isNaN(t)) continue;
    m = reviewMemory(m, gradeFromAnswer(!!sig.correct, sig.hint_count | 0), t);
  }
  return m;
}

/** Concept ids the learner is DUE to review now, derived from the LearnerState. */
export function reviewDueConcepts(state: AnyJson, now: number = Date.now()): string[] {
  const conceptStates = (state && state.concept_states) || {};
  const due: string[] = [];
  for (const cid of Object.keys(conceptStates)) {
    const m = memoryFromHistory(cid, state);
    if (m.reps > 0 && isDue(m, now)) due.push(cid);
  }
  return due;
}
