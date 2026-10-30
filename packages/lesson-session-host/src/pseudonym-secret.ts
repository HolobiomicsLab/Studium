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
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SECRET_FILE = ".studium-secret";
/** The secret every durable install used before I-6, kept for data folders written with it. */
export const LEGACY_PSEUDO_SECRET = "dev-secret";

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

function holdsLearners(dataDir: string): boolean {
  try {
    return readdirSync(dataDir, { withFileTypes: true }).some((entry) => entry.isDirectory() && LEARNER_FOLDER.test(entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** The pseudonym secret of the durable data folder `dataDir` when STUDIUM_PSEUDO_SECRET is unset. */
export function installSecret(dataDir: string): InstallSecret {
  const file = join(dataDir, SECRET_FILE);
  const existing = readSecret(file);
  if (existing) return { secret: existing, source: "file" };
  if (holdsLearners(dataDir)) {
    if (!warned.has(dataDir)) {
      warned.add(dataDir);
      process.stderr.write(`studium: ${dataDir} already holds learner data and no ${SECRET_FILE}: keeping the legacy `
        + "pseudonym secret so no learner loses progress. Set STUDIUM_PSEUDO_SECRET to use your own secret.\n");
    }
    return { secret: LEGACY_PSEUDO_SECRET, source: "legacy" };
  }
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  const pending = join(dataDir, `${SECRET_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(pending, `${secret}\n`, { mode: 0o600, flag: "wx" });
  try {
    // link() never replaces an existing file: exactly one host's complete secret lands at `file`.
    linkSync(pending, file);
  } catch (error) {
    // Another host linked its secret first: use theirs (complete, since it was linked whole).
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return { secret: readSecret(file) ?? secret, source: "file" };
  } finally {
    unlinkSync(pending);
  }
  return { secret, source: "created" };
}
