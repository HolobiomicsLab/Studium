// The concept map as a view of the session (INT-STUDIUM-058 § 2.7). Drawn from the exportable record
// studium/concept-map-record/v1 (lesson-session-host concept-map-record.ts), never from
// get_workflow_graph: for each concept its state, the answers behind that state, and one sentence on
// what the state establishes and one on what it does not. It quotes no passage and carries none of
// the learner's words: titles, states, scene ids, days and counts only.
import { phrase, type Locale } from "./phrases.js";
import type { MapContest, MapEvidence, MapView } from "./view.js";

type MapState = MapView["concepts"][number]["state"];

/** What the view reads of a record; a ConceptMapRecord fits. `evidence` is absent from a record
 * written by a server that did not keep it: the day and the hints of an answer are then unknown. */
export interface MapRecord {
  map: { nodes: readonly { id: string; title: string; state: MapState }[]; edges: readonly { from: string; to: string }[] };
  scenes: readonly { scene_id: string; concept_ids: readonly string[] }[];
  path: readonly { step: number; scene_id: string; answered: boolean; correct: boolean | null; assessed_by: string | null }[];
  evidence?: readonly { step: number; day: string; hints: number; self_rated: boolean }[];
  /** The learner's contests: the one under way, how many check questions each concept can be asked
   * now, those settled. Absent from a record written by a server that takes no contest. */
  contest?: {
    pending: { concept_id: string; claim: "known" | "unsure"; asked: number; answered: number } | null;
    questions: Readonly<Record<string, number>>;
    history: readonly { concept_id: string; outcome: "confirmed" | "refuted" | "partial" }[];
  };
}

/** The map of one session, in the view's language. Pure. */
export function mapView(record: MapRecord, locale: Locale): MapView {
  const facts = new Map((record.evidence ?? []).map((fact) => [fact.step, fact]));
  const conceptsOf = new Map(record.scenes.map((scene) => [scene.scene_id, scene.concept_ids]));
  // An answer is evidence for every concept its scene names; a screen read is evidence for none.
  const evidenceOf = (conceptId: string): MapEvidence[] => record.path
    .filter((step) => step.answered && (conceptsOf.get(step.scene_id) ?? []).includes(conceptId))
    .map((step) => {
      const fact = facts.get(step.step);
      const assessed = step.assessed_by === "key" || step.assessed_by === "judge" ? step.assessed_by : fact?.self_rated ? "self" : "none";
      return {
        scene_id: step.scene_id, day: fact?.day ?? null, assessed_by: assessed,
        result: step.correct === true ? "right" : step.correct === false ? "wrong" : fact?.self_rated ? "rated" : "recorded",
        hints: fact?.hints ?? null,
      };
    });
  const contests = record.contest;
  const contestOf = (node: { id: string; state: MapState }): MapContest | undefined => {
    if (!contests) return undefined;
    const pending = contests.pending?.concept_id === node.id ? contests.pending : null;
    const questions = pending ? pending.asked : contests.questions[node.id] ?? 0;
    const last = contests.history.filter((settled) => settled.concept_id === node.id).at(-1);
    return {
      allowed: !contests.pending && questions > 0, ...(pending ? { check_pending: true } : {}),
      claim: node.state === "acquired" ? "unsure" : "known", questions, ...(last ? { outcome: last.outcome } : {}),
    };
  };
  return {
    concepts: record.map.nodes.map((node) => {
      const contest = contestOf(node);
      return {
        id: node.id, title: node.title, state: node.state, evidence: evidenceOf(node.id),
        establishes: phrase(`map_establishes_${node.state}`, {}, locale),
        does_not_establish: phrase(`map_not_established_${node.state}`, {}, locale),
        ...(contest ? { contest } : {}),
      };
    }),
    edges: record.map.edges.map((edge) => ({ from: edge.from, to: edge.to })),
  };
}
