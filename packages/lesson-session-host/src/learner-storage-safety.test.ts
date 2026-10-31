import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { defaultLearnerProfile } from "@studium/learner-state";
import { FileLearnerProfileStore } from "./learner-profile-store.js";
import { emptyStudyRecord, FileStudyRecordStore } from "./study-record.js";
import * as files from "./learner-files.js";

const PSEUDONYM = "0123456789abcdef";
const dirs: string[] = [];
const temporary = () => {
  const dir = mkdtempSync(join(tmpdir(), "learner-storage-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("L-11 storage ownership", () => {
  it.each(["profile", "study"])("tightens existing directories when saving %s", async (kind) => {
    const data = temporary();
    const learner = join(data, PSEUDONYM);
    mkdirSync(learner);
    chmodSync(data, 0o755);
    chmodSync(learner, 0o755);
    if (kind === "profile") {
      await new FileLearnerProfileStore(data).save(defaultLearnerProfile(PSEUDONYM, new Date(0).toISOString()));
    } else {
      await new FileStudyRecordStore(data).save(PSEUDONYM, emptyStudyRecord());
    }
    expect(statSync(data).mode & 0o777).toBe(0o700);
    expect(statSync(learner).mode & 0o777).toBe(0o700);
    expect(statSync(join(learner, `${kind}.json`)).mode & 0o777).toBe(0o600);
  });

  it("never steals an old lock from a live process", async () => {
    const dir = temporary();
    const lock = join(dir, files.LOCK_FILE);
    writeFileSync(lock, `${process.pid} slow-but-live-owner\n`);
    utimesSync(lock, new Date(0), new Date(0));
    let entered = false;
    // A paused server must keep exclusivity past any age threshold.
    await expect(files.withFileLock(dir, async () => { entered = true; }, { timeoutMs: 25, staleMs: 1 }))
      .rejects.toThrow(/another Studium server/);
    expect(entered).toBe(false);
    expect(readFileSync(lock, "utf8")).toContain("slow-but-live-owner");
  });

  it("does not remove a successor's lock during owner cleanup", async () => {
    const dir = temporary();
    const lock = join(dir, files.LOCK_FILE);
    await files.withFileLock(dir, async () => {
      rmSync(lock);
      writeFileSync(lock, `${process.pid} replacement-owner\n`);
    });
    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(lock, "utf8")).toContain("replacement-owner");
  });

  it("does not guess that an old lock with an unknown owner is abandoned", async () => {
    const dir = temporary();
    const lock = join(dir, files.LOCK_FILE);
    writeFileSync(lock, "");
    utimesSync(lock, new Date(0), new Date(0));
    await expect(files.withFileLock(dir, async () => "entered", { timeoutMs: 25, staleMs: 1 }))
      .rejects.toThrow(/another Studium server/);
    expect(existsSync(lock)).toBe(true);
  });

  it("preserves a tombstone through deletion and later recreation of the learner's profile", async () => {
    const data = temporary();
    const profile = new FileLearnerProfileStore(data);
    const before = files.readLearnerTombstone(data, PSEUDONYM);
    expect(before).toBeNull();
    const after = await files.withLearnerLock(data, PSEUDONYM, async () => {
      const token = await files.writeLearnerTombstone(data, PSEUDONYM);
      await profile.delete(PSEUDONYM);
      rmSync(join(data, PSEUDONYM), { recursive: true, force: true });
      return token;
    });
    expect(after).toMatch(/^[0-9a-f]{32}$/);
    expect(files.readLearnerTombstone(data, PSEUDONYM)).toBe(after);
    await profile.save(defaultLearnerProfile(PSEUDONYM, new Date(0).toISOString()));
    expect(files.readLearnerTombstone(data, PSEUDONYM)).not.toBe(before);
    const metadata = join(data, ".learner-locks", PSEUDONYM);
    expect(statSync(join(data, ".learner-locks")).mode & 0o777).toBe(0o700);
    expect(statSync(metadata).mode & 0o777).toBe(0o700);
    expect(statSync(join(metadata, "tombstone")).mode & 0o777).toBe(0o600);
    const next = await files.withLearnerLock(data, PSEUDONYM,
      () => files.writeLearnerTombstone(data, PSEUDONYM));
    expect(next).not.toBe(after);
  });

  it("refuses a damaged tombstone instead of treating an erased learner as new", () => {
    const data = temporary();
    const metadata = join(data, ".learner-locks", PSEUDONYM);
    mkdirSync(metadata, { recursive: true });
    writeFileSync(join(metadata, "tombstone"), "");
    expect(() => files.readLearnerTombstone(data, PSEUDONYM)).toThrow(/tombstone/);
  });

  it("serializes actual processes through the full load-modify-save transaction", async () => {
    const data = temporary();
    const metadata = join(data, ".learner-locks", PSEUDONYM);
    mkdirSync(metadata, { recursive: true });
    writeFileSync(join(metadata, files.LOCK_FILE), `${2 ** 31 - 1} crashed-owner\n`);
    const module = fileURLToPath(new URL("./learner-files.ts", import.meta.url));
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const loader = createRequire(import.meta.url).resolve("tsx", { paths: [join(root, "node_modules/.pnpm/node_modules")] });
    const run = promisify(execFile);
    const script = `
      import { withLearnerLock } from ${JSON.stringify(module)};
      import { readFile, writeFile } from 'node:fs/promises';
      const [dir, pseudonym] = process.argv.slice(1);
      for (let i = 0; i < 5; i++) {
        await withLearnerLock(dir, pseudonym, async () => {
          let count = 0;
          try { count = Number(await readFile(dir + '/count', 'utf8')); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          await new Promise((resolve) => setTimeout(resolve, 5));
          await writeFile(dir + '/count', String(count + 1));
        });
      }
    `;
    await Promise.all(Array.from({ length: 3 }, () => run(process.execPath,
      ["--import", loader, "--input-type=module", "-e", script, data, PSEUDONYM],
      { env: { ...process.env, STUDIUM_EPHEMERAL: "1" }, timeout: 10_000 })));
    expect(readFileSync(join(data, "count"), "utf8")).toBe("15");
  });
});
