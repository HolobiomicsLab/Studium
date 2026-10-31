// learner-profile-store.ts — the CROSS-LESSON learner profile persistence.
//
// The per-bundle LearnerState (FileStateStore) is keyed by (pseudonym, bundle_id) — it resumes a lesson.
// The PROFILE is keyed by a LEARNER-level pseudonym (salted by a fixed scope, NOT the bundle_id), so a
// concept mastered in lesson A can be SEEDED warm into lesson B. The host seeds it on create() and merges
// it back on completion. The pseudonym (RGPD-safe) is the only on-disk key — never the raw learnerId.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { LearnerProfileSchema, type LearnerProfile } from "@studium/learner-state";
import { ensurePrivateDirectory, readJsonFile, writeFileAtomic } from "./learner-files.js";

/** A fixed pseudonym scope so the learner profile key is STABLE across the learner's lessons (the
 * per-bundle pseudonym is salted by bundle_id and therefore differs per lesson). */
export const PROFILE_PSEUDONYM_SCOPE = "__learner_profile__";

export interface LearnerProfileStore {
  load(pseudonym: string): Promise<LearnerProfile | null>;
  save(profile: LearnerProfile): Promise<void>;
  delete(pseudonym: string): Promise<void>;
}

function sanitizeSegment(s: string): string { return s.replace(/[^A-Za-z0-9_.-]/g, "_"); }

/** In-memory profile store (the ephemeral/test default). Persists across sessions WITHIN one host
 * instance, so cross-lesson warm-start works without STUDIUM_DATA_DIR. */
export class InMemoryLearnerProfileStore implements LearnerProfileStore {
  private readonly byPseudonym = new Map<string, LearnerProfile>();
  async load(pseudonym: string): Promise<LearnerProfile | null> { return this.byPseudonym.get(pseudonym) ?? null; }
  async save(profile: LearnerProfile): Promise<void> { this.byPseudonym.set(profile.pseudonym, profile); }
  async delete(pseudonym: string): Promise<void> { this.byPseudonym.delete(pseudonym); }
}

/** Durable profile store: <dataDir>/<pseudonym>/profile.json — a per-learner tree shared across the
 * learner's bundles. L-11: load() returns null when there is no file, and throws a LearnerDataError
 * when one exists that does not parse (never « no profile », which the next save would write over);
 * save() writes the file whole (temporary file and rename), 0600 in a 0700 folder. */
export class FileLearnerProfileStore implements LearnerProfileStore {
  constructor(private readonly dataDir: string) {}
  private dir(pseudonym: string): string { return join(this.dataDir, sanitizeSegment(pseudonym)); }
  private path(pseudonym: string): string { return join(this.dir(pseudonym), "profile.json"); }
  async load(pseudonym: string): Promise<LearnerProfile | null> {
    return readJsonFile(this.path(pseudonym), (value) => LearnerProfileSchema.safeParse(value));
  }
  async save(profile: LearnerProfile): Promise<void> {
    await ensurePrivateDirectory(this.dataDir);
    await writeFileAtomic(this.path(profile.pseudonym), JSON.stringify(profile, null, 2));
  }
  async delete(pseudonym: string): Promise<void> { await rm(this.path(pseudonym), { force: true }); }
}
