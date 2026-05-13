import Ajv from "ajv/dist/2020";
import schema from "./schema.json";

export type LearningObjective = {
  id: string;
  description: string;
  bloom_level: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
};

export type BibliographicRef = {
  perspicacite_doc_id: string;
  doi?: string;
  title: string;
  authors: string[];
  year?: number;
  excerpt: string;
  relevance_score: number;
  prov_derived_from: string;
};

export type CaseStudy = {
  title: string;
  summary: string;
  source_refs: string[];
};

export type ABSAsset = {
  asset_type: "spectrum_viewer_svg" | "code_snippet" | "data_csv" | "protocol_card_md" | "script_snippet";
  payload_inline?: string;
  payload_path?: string;
  abs_task_card_id?: string;
  prov_derived_from: string;
};

export type EnrichmentMetadata = {
  enricher_version: string;
  perspicacite_mode_used: "basic" | "advanced" | "profound" | "agentic";
  timestamp: string;
  degraded: boolean;
};

export type Evidence = {
  bibliographic_refs?: BibliographicRef[];
  case_studies?: CaseStudy[];
  abs_asset?: ABSAsset;
  enrichment_metadata: EnrichmentMetadata;
};

export type SceneOutline = {
  id: string;
  type: "intro" | "concept" | "quiz" | "simulation" | "reproduction" | "discussion" | "meta_checkpoint" | "ai_critique";
  title: string;
  objective_refs: string[];
  notes?: string;
  duration_minutes?: number;
  evidence?: Evidence;
  evidence_override?: "force" | "skip";
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
