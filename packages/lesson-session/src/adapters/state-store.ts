import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LearnerStateSchema, type LearnerState } from "@studium/learner-state";
import type { StateStore } from "../ports.js";
export class FileStateStore implements StateStore {
  constructor(private readonly dir: string) {}
  private path(lessonId: string): string { return join(this.dir, `state-${lessonId}.json`); }
  async load(lessonId: string): Promise<LearnerState | null> {
    try { return LearnerStateSchema.parse(JSON.parse(await readFile(this.path(lessonId), "utf8"))); }
    catch { return null; }
  }
  async save(lessonId: string, state: LearnerState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(lessonId), JSON.stringify(state, null, 2), "utf8");
  }
}
