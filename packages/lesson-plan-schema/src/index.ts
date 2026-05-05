import Ajv from "ajv/dist/2020";
import schema from "./schema.json";

export type LearningObjective = {
  id: string;
  description: string;
  bloom_level: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
};

export type SceneOutline = {
  id: string;
  type: "intro" | "concept" | "quiz" | "simulation" | "reproduction" | "discussion" | "meta_checkpoint" | "ai_critique";
  title: string;
  objective_refs: string[];
  notes?: string;
  duration_minutes?: number;
};

export type CorpusRef = {
  ref_id: string;
  ref_type: "local_file" | "doi" | "url" | "offline";
  title?: string;
  doi?: string;
  file_path?: string;
  resolved?: boolean;
};

export type LessonPlan = {
  schema_version: "1.0";
  id: string;
  title: string;
  language: string;
  target: string;
  duration_minutes: number;
  learning_objectives: LearningObjective[];
  scene_outlines: SceneOutline[];
  corpus_refs: CorpusRef[];
  critic_score?: number;
  critic_annotations?: string[];
  status: "draft" | "critic_reviewed" | "approved";
  validated_by?: string;
  metadata?: {
    subject: string;
    author: string;
    created: string;
    tags?: string[];
    [key: string]: unknown;
  };
};

const ajv = new Ajv({ strict: true });
const _validate = ajv.compile(schema);

export function validatePlan(data: unknown): { valid: boolean; errors: string[] } {
  const valid = _validate(data) as boolean;
  const errors = (_validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? ""}`
  );
  return { valid, errors };
}

export function loadSchema(): object {
  return schema;
}
