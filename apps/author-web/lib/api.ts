export type CorpusRef = {
  ref_id: string;
  ref_type: "local_file" | "doi" | "url" | "offline";
  title?: string;
  doi?: string;
  resolved?: boolean;
};

export type IngestManifest = {
  manifest_id: string;
  target: string;
  pages_extracted: number;
  text_preview: string;
  figures_count: number;
  references: CorpusRef[];
  keywords?: string;
  extractor: string;
};

export type SceneOutline = {
  id: string;
  type: string;
  title: string;
  objective_refs: string[];
  notes?: string;
  duration_minutes?: number;
};

export type LearningObjective = {
  id: string;
  description: string;
  bloom_level: string;
};

export type LessonPlan = {
  schema_version: string;
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
  metadata?: Record<string, unknown>;
};

export type PlanResponse = {
  lesson_plan: LessonPlan;
  critic_score: number;
  critic_annotations: string[];
};

const INGEST_URL = process.env.NEXT_PUBLIC_INGEST_SERVICE_URL || "http://localhost:8000";
const PLANNER_URL = process.env.NEXT_PUBLIC_PLANNER_SERVICE_URL || "http://localhost:8001";

export async function ingestCorpus(
  pdf: File,
  target: string,
  bib?: File,
  keywords?: string
): Promise<IngestManifest> {
  const form = new FormData();
  form.append("pdf", pdf);
  form.append("target", target);
  if (bib) form.append("bib", bib);
  if (keywords) form.append("keywords", keywords);

  const resp = await fetch(`${INGEST_URL}/ingest/corpus`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) throw new Error(`Ingest failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export async function generatePlan(manifest: IngestManifest): Promise<PlanResponse> {
  const resp = await fetch(`${PLANNER_URL}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      manifest_id: manifest.manifest_id,
      target: manifest.target,
      corpus_refs: manifest.references,
      text_preview: manifest.text_preview,
      keywords: manifest.keywords,
    }),
  });
  if (!resp.ok) throw new Error(`Plan generation failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}
