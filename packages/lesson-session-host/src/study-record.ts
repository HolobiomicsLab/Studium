// packages/lesson-session-host/src/study-record.ts
//
// Where a learner studied, kept beside their cross-lesson profile (<dataDir>/<pseudonym>/study.json):
//   - concepts: for each concept, the lesson and scene where it was last graded, so a review asked
//     for by learner_id alone routes to a playable scene (HJ-1: it used to return scene_id null);
//   - lessons: for each lesson started, how far the learner got (the study plan's "in progress");
//   - minutes_per_day: the minutes a day the learner said they have (RFR-06), read from the
//     learner_profile of the self-study lesson they play; the study plan sizes its next step with it.
// The profile itself (concept_states, concept_memory, completed_lessons) belongs to
// @studium/learner-state; this record is the host's own and needs no schema change there. Same
// RGPD-safe pseudonym key as the profile, and erased with it by forget(). Written whole and read
// strictly (learner-files.ts, L-11).
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readJsonFile, writeFileAtomic } from "./learner-files.js";

const ConceptRouteSchema = z.object({
  bundle_ref: z.string(),
  bundle_id: z.string(),
  scene_id: z.string(),
  lesson_title: z.string(),
});
const LessonProgressSchema = z.object({
  bundle_ref: z.string(),
  bundle_id: z.string(),
  title: z.string(),
  language: z.string(),
  scenes_completed: z.number().int().nonnegative(),
  total_scenes: z.number().int().nonnegative(),
  completed: z.boolean(),
  updated_at: z.string(),
});
export const StudyRecordSchema = z.object({
  schema: z.literal("studium-study/1"),
  concepts: z.record(z.string(), ConceptRouteSchema),
  lessons: z.record(z.string(), LessonProgressSchema),
  minutes_per_day: z.number().int().min(1).max(600).optional(),
});
export type ConceptRoute = z.infer<typeof ConceptRouteSchema>;
export type LessonProgress = z.infer<typeof LessonProgressSchema>;
export type StudyRecord = z.infer<typeof StudyRecordSchema>;

export function emptyStudyRecord(): StudyRecord {
  return { schema: "studium-study/1", concepts: {}, lessons: {} };
}

export interface StudyRecordStore {
  load(pseudonym: string): Promise<StudyRecord | null>;
  save(pseudonym: string, record: StudyRecord): Promise<void>;
  delete(pseudonym: string): Promise<void>;
}

function sanitizeSegment(s: string): string { return s.replace(/[^A-Za-z0-9_.-]/g, "_"); }

/** The ephemeral default: survives across this host's sessions, not a restart. */
export class InMemoryStudyRecordStore implements StudyRecordStore {
  private readonly byPseudonym = new Map<string, StudyRecord>();
  async load(pseudonym: string): Promise<StudyRecord | null> {
    const record = this.byPseudonym.get(pseudonym);
    return record ? structuredClone(record) : null;
  }
  async save(pseudonym: string, record: StudyRecord): Promise<void> { this.byPseudonym.set(pseudonym, structuredClone(record)); }
  async delete(pseudonym: string): Promise<void> { this.byPseudonym.delete(pseudonym); }
}

/** <dataDir>/<pseudonym>/study.json, next to profile.json. L-11: load() returns null when there is no
 * file and throws a LearnerDataError when one exists that does not parse; save() writes it whole
 * (temporary file and rename), 0600 in a 0700 folder. */
export class FileStudyRecordStore implements StudyRecordStore {
  constructor(private readonly dataDir: string) {}
  private dir(pseudonym: string): string { return join(this.dataDir, sanitizeSegment(pseudonym)); }
  private path(pseudonym: string): string { return join(this.dir(pseudonym), "study.json"); }
  async load(pseudonym: string): Promise<StudyRecord | null> {
    return readJsonFile(this.path(pseudonym), (value) => StudyRecordSchema.safeParse(value));
  }
  async save(pseudonym: string, record: StudyRecord): Promise<void> {
    await writeFileAtomic(this.path(pseudonym), JSON.stringify(record, null, 2));
  }
  async delete(pseudonym: string): Promise<void> { await rm(this.path(pseudonym), { force: true }); }
}
