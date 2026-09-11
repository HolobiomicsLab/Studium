import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const text = z.string().min(1).max(12000).refine(v => v.trim().length > 0, "Text must not be blank");
const confidence = z.number().int().min(0).max(4);
const identity = { experiment_id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/) };
const learner = { authorship: z.literal("learner"), consent: z.literal(true) };
/** Attribution is a declaration, not authenticated proof that a learner wrote this text. */
export const ExperimentInputSchema = z.discriminatedUnion("kind", [
  z.object({ ...identity, ...learner, kind: z.literal("predict"), prediction: text, justification: text, confidence }).strict(),
  z.object({ ...identity, kind: z.literal("begin") }).strict(),
  z.object({ ...identity, ...learner, kind: z.literal("observe"), text,
    evidence_refs: z.array(z.string().min(1).max(500)).max(30).default([]) }).strict(),
  z.object({ ...identity, ...learner, kind: z.literal("conclude"), text, confidence }).strict(),
]);
export type ExperimentInput = z.infer<typeof ExperimentInputSchema>;
const eventSchema = z.object({ sequence: z.number().int().positive(), recorded_at: z.string().datetime(), input: ExperimentInputSchema }).strict();
const experimentSchema = z.object({ experiment_id: z.string(), scene_id: z.string(), events: z.array(eventSchema).min(1).max(4) }).strict();
const documentSchema = z.object({ schema: z.literal("studium/experiment-journal/v1"), bundle_revision: z.string(),
  storage: z.enum(["private-local", "ephemeral"]), experiments: z.array(experimentSchema).max(200) }).strict();
export type ExperimentDocument = z.infer<typeof documentSchema>;
const order = ["predict", "begin", "observe", "conclude"] as const;

/** Canonical digest independent of object insertion order, including all provided fields. */
export function experimentRevision(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)]));
    return v;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Private append-only contributions, separate from response grading and teacher analytics.
 * A filesystem lock rejects overlapping writers; atomic rename preserves the last valid snapshot.
 * A leftover lock after process death requires explicit local inspection/removal, never silent stealing.
 */
export class ExperimentJournal {
  private memory: ExperimentDocument;
  private readonly file: string | undefined;
  constructor(private readonly revision: string, private readonly directory?: string) {
    this.memory = this.empty();
    this.file = directory ? join(directory, `${experimentRevision(revision)}.json`) : undefined;
  }

  private empty(): ExperimentDocument {
    return { schema: "studium/experiment-journal/v1", bundle_revision: this.revision,
      storage: this.directory ? "private-local" : "ephemeral", experiments: [] };
  }

  read(): ExperimentDocument {
    if (!this.file) return structuredClone(this.memory);
    if (!existsSync(this.file)) return this.empty();
    const doc = documentSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    if (doc.bundle_revision !== this.revision || doc.storage !== "private-local") throw new Error("Experiment journal revision mismatch");
    const ids = new Set<string>();
    for (const experiment of doc.experiments) {
      if (ids.has(experiment.experiment_id)) throw new Error("Duplicate experiment in journal");
      ids.add(experiment.experiment_id);
      experiment.events.forEach((event, index) => {
        if (event.sequence !== index + 1 || event.input.kind !== order[index] || event.input.experiment_id !== experiment.experiment_id)
          throw new Error("Invalid experiment event order");
      });
    }
    return doc;
  }

  record(raw: unknown, sceneId: string): ExperimentDocument {
    const input = ExperimentInputSchema.parse(raw);
    return this.locked(() => {
      const doc = this.read();
      let experiment = doc.experiments.find(e => e.experiment_id === input.experiment_id);
      if (!experiment) {
        if (input.kind !== "predict") throw new Error("A prediction is required before beginning an experiment");
        if (doc.experiments.length >= 200) throw new Error("Experiment journal capacity reached");
        experiment = { experiment_id: input.experiment_id, scene_id: sceneId, events: [] };
        doc.experiments.push(experiment);
      }
      const existing = experiment.events.find(e => e.input.kind === input.kind);
      if (existing) {
        if (experimentRevision(existing.input) === experimentRevision(input) && (input.kind !== "predict" || experiment.scene_id === sceneId)) return doc;
        throw new Error("Recorded contributions are immutable; use a new experiment ID for a new attempt");
      }
      const expected = order[experiment.events.length];
      if (input.kind !== expected) throw new Error(`Expected ${expected} before ${input.kind}`);
      experiment.events.push({ sequence: experiment.events.length + 1, recorded_at: new Date().toISOString(), input });
      if (this.file) {
        const temp = `${this.file}.${randomUUID()}.tmp`;
        try {
          writeFileSync(temp, JSON.stringify(doc, null, 2) + "\n", { flag: "wx", mode: 0o600 });
          renameSync(temp, this.file);
        } finally { rmSync(temp, { force: true }); }
      } else this.memory = structuredClone(doc);
      return structuredClone(doc);
    });
  }

  /** Called by host.forget; all revision journals in this learner/lesson scope are removed. */
  erase(): void {
    this.locked(() => {
      if (this.directory) {
        // Keep the lock until deletion completes; no removal outside this dedicated journal folder.
        for (const name of readdirSync(this.directory)) {
          if (/^[a-f0-9]{64}\.json(?:\.[a-f0-9-]+\.tmp)?$/.test(name)) rmSync(join(this.directory, name), { force: true });
        }
      }
      this.memory = this.empty();
    });
  }

  private locked<T>(fn: () => T): T {
    if (!this.directory) return fn();
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = join(this.directory, ".lock");
    let fd: number;
    try { fd = openSync(lock, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Experiment journal busy: retry after the current writer finishes; inspect stale .lock after interruption");
      throw error;
    }
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
      return fn();
    } finally { closeSync(fd); rmSync(lock, { force: true }); }
  }
}
