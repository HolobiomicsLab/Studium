// packages/lesson-session-host/src/persistence.ts
//
// Where Studium keeps a learner's lessons and progress when nothing says otherwise (contract C6,
// decision D4 of the 2026-10-30 production sprint):
//
//   STUDIUM_HOME        default ~/.studium
//   <home>/library      lessons written for the learner; always searched after BUNDLES_ROOT
//   <home>/data         durable learner state (STUDIUM_DATA_DIR wins)
//   STUDIUM_LEARNER_ID  the learner_id used when a call names none (default "anonymous")
//   STUDIUM_EPHEMERAL=1 the old behaviour: durable only when STUDIUM_DATA_DIR is set
//
// Pure on purpose: the environment and the home directory are arguments, so only an entry point
// (the stdio MCP server) applies these defaults, and the library code and its tests keep their
// in-memory default unless they configure a directory themselves.
import { join } from "node:path";

export interface PersistenceConfig {
  home: string;
  /** The learner's personal library, searched in addition to `bundlesRoot`. */
  libraryRoot: string;
  /** The root a bundle_ref is looked up in first: `BUNDLES_ROOT`, else the library. */
  bundlesRoot: string;
  /** Durable learner state; null keeps everything in memory (lost at restart). */
  dataDir: string | null;
  learnerIdDefault: string;
}

/** What `get_server_info` and `start_lesson_session` report (C6). */
export interface PersistenceInfo {
  durable: boolean;
  data_dir: string | null;
  library_root: string | null;
  learner_id_default: string;
  /** Present only when nothing is durable; meant for the harness to relay. */
  warning?: string;
}

export const DEFAULT_LEARNER_ID = "anonymous";

const NOT_DURABLE_WARNING = "Progress is kept in memory only and is lost when this server restarts; " +
  "set STUDIUM_DATA_DIR, or unset STUDIUM_EPHEMERAL, to keep it.";

/** A variable a harness exported empty (`VAR=`) is treated as unset. */
function setting(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function resolvePersistence(
  env: Readonly<Record<string, string | undefined>>,
  homedir: string,
): PersistenceConfig {
  const home = setting(env, "STUDIUM_HOME") ?? join(homedir, ".studium");
  const libraryRoot = join(home, "library");
  const explicitData = setting(env, "STUDIUM_DATA_DIR");
  const ephemeral = isTruthy(setting(env, "STUDIUM_EPHEMERAL"));
  return {
    home,
    libraryRoot,
    bundlesRoot: setting(env, "BUNDLES_ROOT") ?? libraryRoot,
    dataDir: explicitData ?? (ephemeral ? null : join(home, "data")),
    learnerIdDefault: setting(env, "STUDIUM_LEARNER_ID") ?? DEFAULT_LEARNER_ID,
  };
}

export function persistenceInfo(p: {
  dataDir: string | null;
  libraryRoot: string | null;
  learnerIdDefault: string;
}): PersistenceInfo {
  const info: PersistenceInfo = {
    durable: p.dataDir !== null,
    data_dir: p.dataDir,
    library_root: p.libraryRoot,
    learner_id_default: p.learnerIdDefault,
  };
  if (p.dataDir === null) info.warning = NOT_DURABLE_WARNING;
  return info;
}
