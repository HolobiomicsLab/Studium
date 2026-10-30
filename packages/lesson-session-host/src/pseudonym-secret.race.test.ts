// packages/lesson-session-host/src/pseudonym-secret.race.test.ts
//
// I-6, review of G1: two hosts starting on the same fresh data folder at once (the VS Code extension's
// server and a Codex server) must agree on one secret, and neither may see a half-written secret file.
// The race is made deterministic: the first write of a secret starts, and before its bytes land a
// second host calls installSecret on the same folder (what a second process does in that window).
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const race: { dir: string | null; inner: { secret?: string; error?: unknown } | null } = { dir: null, inner: null };

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const writeFileSync = ((path: Parameters<typeof fs.writeFileSync>[0], data: string, options?: { mode?: number; flag?: string }) => {
    const dir = race.dir;
    if (dir && typeof path === "string" && path.startsWith(dir) && race.inner === null) {
      // The open half of the write: the file exists, empty, from here on.
      const fd = fs.openSync(path, options?.flag ?? "w", options?.mode ?? 0o666);
      race.inner = {};
      try { race.inner.secret = installSecretRef!(dir).secret; } catch (error) { race.inner.error = error; }
      fs.writeSync(fd, data);
      fs.closeSync(fd);
      return;
    }
    return fs.writeFileSync(path, data, options);
  }) as typeof fs.writeFileSync;
  return { ...fs, default: { ...fs, writeFileSync }, writeFileSync };
});

let installSecretRef: ((dir: string) => { secret: string; source: string }) | null = null;
const { installSecret, SECRET_FILE } = await import("./pseudonym-secret.js");
installSecretRef = installSecret;

const dirs: string[] = [];
afterEach(() => {
  race.dir = null; race.inner = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("I-6 — two hosts creating the secret of one fresh data folder at once", () => {
  it("the second host never reads a half-written secret, and both use the same one", () => {
    const dir = mkdtempSync(join(tmpdir(), "secret-race-"));
    dirs.push(dir);
    race.dir = dir;
    const outer = installSecret(dir);
    expect(race.inner, "the race window was exercised").not.toBeNull();
    expect(race.inner?.error).toBeUndefined();
    expect(race.inner?.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(outer.secret).toBe(race.inner?.secret);
    expect(statSync(join(dir, SECRET_FILE)).mode & 0o777).toBe(0o600);
    race.dir = null;
    expect(installSecret(dir)).toEqual({ secret: outer.secret, source: "file" });
  });
});
