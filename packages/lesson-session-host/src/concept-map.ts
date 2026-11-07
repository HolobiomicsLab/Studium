// The learner's concept map: the lesson's concepts and their prerequisite links, each concept in the
// state the SESSION establishes — what was served, what was answered, which prerequisites were
// credited. `get_workflow_graph` reads posterior mastery alone, which stays under theta long after a
// gate was passed: at step 16 of atomistique-l1 it reports the first concept as current and every
// other as locked, the one being studied included (simulation of 6 Nov 2026). A map shown to a
// learner must say where they are, so it is drawn from the path instead.
import type { LearnerPath } from "@studium/lesson-session";

export type ConceptMapState = "acquired" | "to_review" | "current" | "seen" | "upcoming";
/** When the map is offered. The whole map at the structural moments, one position line at a new
 * concept: a map on every question would be noise. */
export type ConceptMapMoment = "start" | "new_concept" | "detour" | "detour_return" | "synthesis" | "complete" | "on_request";

export interface ConceptMapQuestion { step: number; scene_id: string; result: "correct" | "wrong" | "recorded" }
export interface ConceptMapNode {
  id: string;
  title: string;
  state: ConceptMapState;
  /** The answers given on this concept, in the order served. `recorded`: nobody assessed it. */
  questions: ConceptMapQuestion[];
  /** For an upcoming concept: its prerequisites still to review. */
  requires: string[];
}
/** From a prerequisite to the concept that needs it. Travelled once both ends were visited. */
export interface ConceptMapEdge { from: string; to: string; travelled: boolean }
export interface ConceptMap {
  schema: "studium/concept-map/v1";
  moment: ConceptMapMoment;
  /** What a chat harness is advised to show at this moment: the map, or `position_line` alone. */
  show: "map" | "line";
  /** The step being served (1-based, in the order of the session). */
  step: number;
  nodes: ConceptMapNode[];
  edges: ConceptMapEdge[];
  /** Where the learner comes from, where they are, what comes next (concept ids). */
  position: { from: string | null; at: string | null; next: string | null };
  position_line: string;
  /** The same map as a Mermaid flowchart, for a harness that renders diagrams. */
  mermaid: string;
  /** The same map as a list, readable anywhere. */
  display_markdown: string;
}

/** The part of a Learning Workflow Graph the map reads: a `prerequisite_for` edge has the dependent
 * concept as source and its prerequisite as target (graph-router.ts). */
export interface ConceptMapGraph { edges: readonly { relation: string; source: string; target: string }[] }

export interface ConceptMapInput {
  concepts: readonly { id: string; title: string }[];
  scenes: readonly { id: string; type?: string; concept_refs?: readonly string[] }[];
  lwg?: ConceptMapGraph | null;
  path: LearnerPath;
  /** The scene on screen; null once the lesson is complete. */
  currentSceneId: string | null;
  moment: ConceptMapMoment;
  locale: "fr" | "en";
}

const WORDS = {
  fr: {
    title: "Carte des notions", step: "étape {n}", sep: " : ",
    acquired: "acquise", to_review: "à revoir", current: "en cours", seen: "vue, pas encore évaluée", upcoming: "à venir",
    correct: "juste", wrong: "faux", recorded: "enregistrée", recorded_many: "{n} réponses enregistrées", requires: "demande {list}",
    from: "Tu viens de « {c} »", at: "tu es sur « {c} »", next: "ensuite « {c} »", done: "la leçon est terminée",
  },
  en: {
    title: "Concept map", step: "step {n}", sep: ": ",
    acquired: "acquired", to_review: "to review", current: "in progress", seen: "seen, not assessed yet", upcoming: "upcoming",
    correct: "correct", wrong: "wrong", recorded: "recorded", recorded_many: "{n} answers recorded", requires: "needs {list}",
    from: "You come from “{c}”", at: "you are on “{c}”", next: "next “{c}”", done: "the lesson is complete",
  },
} as const;

const CLASS_DEFS = [
  "classDef acquired fill:#EAF3DE,stroke:#3B6D11,color:#173404",
  "classDef to_review fill:#FAEEDA,stroke:#854F0B,color:#412402",
  "classDef current fill:#E6F1FB,stroke:#185FA5,color:#042C53,stroke-width:2px",
  "classDef seen fill:#F1EFE8,stroke:#5F5E5A,color:#2C2C2A",
  "classDef upcoming fill:#F1EFE8,stroke:#888780,color:#444441,stroke-dasharray:4 3",
];

const SHOW: Record<ConceptMapMoment, ConceptMap["show"]> = {
  start: "map", new_concept: "line", detour: "map", detour_return: "map", synthesis: "map", complete: "map", on_request: "map",
};

export function buildConceptMap(input: ConceptMapInput): ConceptMap {
  const { concepts, scenes, path, currentSceneId, moment, locale } = input;
  const w = WORDS[locale];
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const refsOf = (sceneId: string): readonly string[] => sceneById.get(sceneId)?.concept_refs ?? [];
  const known = new Set(concepts.map((c) => c.id));

  // Lesson order: the order in which the scenes first name each concept, then any concept no scene names.
  const order: string[] = [];
  for (const scene of scenes) for (const ref of scene.concept_refs ?? []) if (known.has(ref) && !order.includes(ref)) order.push(ref);
  for (const c of concepts) if (!order.includes(c.id)) order.push(c.id);
  const titleOf = (id: string): string => concepts.find((c) => c.id === id)?.title ?? id;

  const current = currentSceneId === null ? null : refsOf(currentSceneId)[0] ?? null;
  const passed = new Set(path.passed_prerequisites);
  const prerequisites = (id: string): string[] => (input.lwg?.edges ?? [])
    .filter((e) => e.relation === "prerequisite_for" && e.source === `concept:${id}`)
    .map((e) => e.target.replace(/^concept:/, "")).filter((p) => known.has(p));

  const base = order.map((id) => {
    const steps = path.steps.filter((step) => refsOf(step.scene_id).includes(id));
    const questions: ConceptMapQuestion[] = steps.filter((step) => step.answered).map((step) => ({
      step: step.step, scene_id: step.scene_id,
      result: step.correct === true ? "correct" : step.correct === false ? "wrong" : "recorded",
    }));
    const lastGraded = questions.filter((q) => q.result !== "recorded").at(-1);
    const state: ConceptMapState = id === current ? "current"
      : passed.has(id) || lastGraded?.result === "correct" ? "acquired"
      : lastGraded?.result === "wrong" ? "to_review"
      : steps.length > 0 ? "seen" : "upcoming";
    return { id, title: titleOf(id), state, questions };
  });
  const stateOf = new Map(base.map((node) => [node.id, node.state]));
  const nodes: ConceptMapNode[] = base.map((node) => ({
    ...node,
    requires: node.state === "upcoming" ? prerequisites(node.id).filter((p) => stateOf.get(p) === "to_review") : [],
  }));
  const edges: ConceptMapEdge[] = order.flatMap((id) => prerequisites(id).map((p) => ({
    from: p, to: id, travelled: stateOf.get(p) !== "upcoming" && stateOf.get(id) !== "upcoming",
  })));

  const visited = path.steps.map((step) => refsOf(step.scene_id)[0]).filter((c): c is string => c !== undefined && c !== current);
  const position = {
    from: visited.at(-1) ?? null,
    at: current,
    next: current === null ? null : order.slice(order.indexOf(current) + 1).find((id) => stateOf.get(id) === "upcoming") ?? null,
  };
  const positionLine = sentence([
    position.from ? w.from.replace("{c}", titleOf(position.from)) : "",
    position.at ? w.at.replace("{c}", titleOf(position.at)) : w.done,
    position.next ? w.next.replace("{c}", titleOf(position.next)) : "",
  ]);

  // Graded answers one by one; answers nobody assessed as a count once there are several.
  const answers = (node: ConceptMapNode): string[] => {
    const recorded = node.questions.filter((q) => q.result === "recorded");
    return [
      ...node.questions.filter((q) => q.result !== "recorded" || recorded.length === 1).map((q) => `Q${q.step} ${w[q.result]}`),
      ...(recorded.length > 1 ? [w.recorded_many.replace("{n}", String(recorded.length))] : []),
    ];
  };
  const detail = (node: ConceptMapNode): string => [
    ...answers(node),
    ...(node.requires.length ? [w.requires.replace("{list}", node.requires.map(titleOf).join(", "))] : []),
  ].join(", ");
  const step = path.steps.length + (currentSceneId === null ? 0 : 1);
  const lines = nodes.map((node) => {
    const text = `${node.title}${w.sep}${w[node.state]}`;
    const suffix = detail(node) ? ` (${detail(node)})` : "";
    return node.state === "current" ? `- **${text}**${suffix}` : `- ${text}${suffix}`;
  });
  const displayMarkdown = [`**${w.title}** (${w.step.replace("{n}", String(step))})`, lines.join("\n"), positionLine].join("\n\n");

  const key = (id: string): string => `n_${id.replace(/[^A-Za-z0-9]/g, "_")}`;
  const label = (text: string): string => text.replaceAll("\"", "#quot;");
  const mermaid = [
    "flowchart TD",
    ...nodes.map((node) => {
      const questions = answers(node).join(", ");
      return `  ${key(node.id)}["${label(node.title)}<br/>${w[node.state]}${questions ? ` · ${questions}` : ""}"]:::${node.state}`;
    }),
    ...edges.map((e) => `  ${key(e.from)} ${e.travelled ? "-->" : "-.->"} ${key(e.to)}`),
    ...CLASS_DEFS.map((def) => `  ${def}`),
  ].join("\n");

  return {
    schema: "studium/concept-map/v1", moment, show: SHOW[moment], step, nodes, edges, position,
    position_line: positionLine, mermaid, display_markdown: displayMarkdown,
  };
}

/** Join the parts with commas, capitalise the first letter, close with a full stop. */
function sentence(parts: string[]): string {
  const text = parts.filter((part) => part !== "").join(", ");
  return text === "" ? "" : `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
