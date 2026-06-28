// learner-profile-store.ts — the CROSS-LESSON learner profile persistence.
//
// The per-bundle LearnerState (FileStateStore) is keyed by (pseudonym, bundle_id) — it resumes a lesson.
// The PROFILE is keyed by a LEARNER-level pseudonym (salted by a fixed scope, NOT the bundle_id), so a
// concept mastered in lesson A can be SEEDED warm into lesson B. The host seeds it on create() and merges
// it back on completion. The pseudonym (RGPD-safe) is the only on-disk key — never the raw learnerId.
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LearnerProfileSchema, type LearnerProfile } from "@studium/learner-state";

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
 * learner's bundles. load() is fail-safe (null on missing/parse/validation error). */
export class FileLearnerProfileStore implements LearnerProfileStore {
  constructor(private readonly dataDir: string) {}
  private dir(pseudonym: string): string { return join(this.dataDir, sanitizeSegment(pseudonym)); }
  private path(pseudonym: string): string { return join(this.dir(pseudonym), "profile.json"); }
  async load(pseudonym: string): Promise<LearnerProfile | null> {
    try {
      const parsed = LearnerProfileSchema.safeParse(JSON.parse(await readFile(this.path(pseudonym), "utf8")));
      return parsed.success ? parsed.data : null;
    } catch { return null; }
  }
  async save(profile: LearnerProfile): Promise<void> {
    await mkdir(this.dir(profile.pseudonym), { recursive: true });
    await writeFile(this.path(profile.pseudonym), JSON.stringify(profile, null, 2), "utf8");
  }
  async delete(pseudonym: string): Promise<void> { await rm(this.path(pseudonym), { force: true }); }
}
