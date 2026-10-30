// packages/lesson-session-host/src/pseudonym-secret.ts
//
// I-6 (integration lead decision, 2026-10-30): the secret behind learner pseudonyms when
// STUDIUM_PSEUDO_SECRET is unset and state is durable. Until now every such install keyed its learner
// folders with the same public "dev-secret", so anyone holding a data folder and a learner's name could
// recompute that learner's pseudonym. Now:
//   - a data folder with no learner folder yet gets its own secret, `<dataDir>/.studium-secret`
//     (0600, 32 random bytes in hex), created once and read on every later start;
//   - a data folder that already holds learner folders and no secret file keeps the legacy secret, so
//     nobody loses their progress, and says so once on stderr (set STUDIUM_PSEUDO_SECRET to choose one);
//   - ephemeral mode (no data folder) is unchanged, and STUDIUM_PSEUDO_SECRET always wins (deps.ts).
// A secret file that exists but holds nothing is refused, never replaced: a new secret would orphan
// every learner of the folder. The secret is written whole to a temporary file first and then linked
// into place, so a second host starting on the same fresh folder at the same moment (the VS Code
// extension's server and a Codex server) never reads a half-written file: it finds no file, or a
// complete one, and the host whose link loses uses the winner's secret.
//
// L-11 (SEC-4 host side, CC-7): a marker, `<dataDir>/.studium-key-source`, says which secret keys the
// folder's learners — `install` (written with the secret file), `legacy` (an older folder, found keyed
// by the legacy secret) or `env` (STUDIUM_PSEUDO_SECRET, recorded by the host the first time it uses
// it there). The legacy secret is used only for a folder that predates the per-install secret: learner
// folders, no secret file and no marker. A folder that lost its secret file, or whose learners were
// keyed by STUDIUM_PSEUDO_SECRET, is refused in one line rather than silently keyed by the public
// legacy secret; and a folder holding no learner any more — every one of them forgotten — gets its
// own secret, whatever keyed it before. The data folder is created 0700.
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SECRET_FILE = ".studium-secret";
/** L-11: which secret keys this data folder's learner folders (see the header). Holds no secret. */
export const KEY_SOURCE_FILE = ".studium-key-source";
/** The secret every durable install used before I-6, kept for data folders written with it. */
export const LEGACY_PSEUDO_SECRET = "dev-secret";

export type KeySource = "install" | "legacy" | "env";

/** A learner folder: a 16-hex pseudonym (HmacPseudonymProvider). */
const LEARNER_FOLDER = /^[0-9a-f]{16}$/;

/** Data folders already told on stderr that they keep the legacy secret (once per process). */
const warned = new Set<string>();

export interface InstallSecret {
  secret: string;
  /** file: read from the secret file; created: just written; legacy: an older folder's secret. */
  source: "file" | "created" | "legacy";
}

function readSecret(file: string): string | null {
  let text: string;
  try { text = readFileSync(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const secret = text.trim();
  if (!secret) {
    throw new Error(`${file} is empty: restore it from a backup, or set STUDIUM_PSEUDO_SECRET to the secret this data folder was written with`);
  }
  return secret;
}

/** The secret `<dataDir>/.studium-secret` holds now, or null when it is absent, empty or unreadable —
 * how a running host tells that its data folder was erased or keyed afresh under it (L-11). */
export function currentInstallSecret(dataDir: string): string | null {
  try { return readSecret(join(dataDir, SECRET_FILE)); }
  catch { return null; }
}

/** Whether `dataDir` holds a learner folder (a 16-hex pseudonym folder). */
export function holdsLearners(dataDir: string): boolean {
  try {
    return readdirSync(dataDir, { withFileTypes: true }).some((entry) => entry.isDirectory() && LEARNER_FOLDER.test(entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** The folder's marker, or null when it has none. A marker that says anything else reads as `install`:
 * the folder is then refused rather than keyed by the legacy secret. */
export function readKeySource(dataDir: string): KeySource | null {
  let text: string;
  try { text = readFileSync(join(dataDir, KEY_SOURCE_FILE), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const source = text.trim();
  return source === "legacy" || source === "env" ? source : "install";
}

/** Write the marker: only when there is none, or `replace` it whole (temporary file and rename). */
function writeKeySource(dataDir: string, source: KeySource, opts: { replace?: boolean } = {}): void {
  const file = join(dataDir, KEY_SOURCE_FILE);
  if (!opts.replace) {
    try { writeFileSync(file, `${source}\n`, { mode: 0o600, flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return;
  }
  const pending = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(pending, `${source}\n`, { mode: 0o600, flag: "wx" });
  try { renameSync(pending, file); }
  catch (error) { rmSync(pending, { force: true }); throw error; }
}

/** L-11: a durable host keying learners with STUDIUM_PSEUDO_SECRET records it in a folder that has no
 * marker yet, so that unsetting the variable later is refused instead of orphaning those learners. */
export function markEnvKeyed(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeKeySource(dataDir, "env");
}

/** The pseudonym secret of the durable data folder `dataDir` when STUDIUM_PSEUDO_SECRET is unset. */
export function installSecret(dataDir: string): InstallSecret {
  const file = join(dataDir, SECRET_FILE);
  const existing = readSecret(file);
  if (existing) {
    writeKeySource(dataDir, "install"); // a folder keyed before the marker existed gets it now
    return { secret: existing, source: "file" };
  }
  if (holdsLearners(dataDir)) {
    const keyedBy = readKeySource(dataDir);
    if (keyedBy === "install") {
      throw new Error(`${dataDir} holds learner folders keyed by its ${SECRET_FILE}, which is missing: restore it from `
        + "a backup, or set STUDIUM_PSEUDO_SECRET to the secret it held; to start afresh, remove the learner folders");
    }
    if (keyedBy === "env") {
      throw new Error(`${dataDir} holds learner folders keyed by STUDIUM_PSEUDO_SECRET: set it to the same secret `
        + "again, or point STUDIUM_DATA_DIR at another folder");
    }
    // No marker: a folder written before the per-install secret (I-6). Say so once, and remember it.
    if (keyedBy === null) writeKeySource(dataDir, "legacy");
    if (!warned.has(dataDir)) {
      warned.add(dataDir);
      process.stderr.write(`studium: ${dataDir} already holds learner data and no ${SECRET_FILE}: keeping the legacy `
        + "pseudonym secret so no learner loses progress. Set STUDIUM_PSEUDO_SECRET to use your own secret.\n");
    }
    return { secret: LEGACY_PSEUDO_SECRET, source: "legacy" };
  }
  // No learner folder: a fresh folder, or one every learner was erased from — its own secret, whatever
  // keyed it before (the legacy secret is never used again after the last of its learners is forgotten).
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString("hex");
  const pending = join(dataDir, `${SECRET_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(pending, `${secret}\n`, { mode: 0o600, flag: "wx" });
  try {
    // link() never replaces an existing file: exactly one host's complete secret lands at `file`.
    linkSync(pending, file);
  } catch (error) {
    // Another host linked its secret first: use theirs (complete, since it was linked whole).
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    writeKeySource(dataDir, "install", { replace: true });
    return { secret: readSecret(file) ?? secret, source: "file" };
  } finally {
    unlinkSync(pending);
  }
  writeKeySource(dataDir, "install", { replace: true });
  return { secret, source: "created" };
}
