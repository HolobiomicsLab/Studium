/**
 * Build identity for source and bundled lesson-mcp launches.
 *
 * The VS Code bundle command must append this exact shell fragment to its lesson-mcp esbuild call:
 * --define:__STUDIUM_BUILD__='{"origin":"bundled","built_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","git_sha":"'"$(git describe --always --dirty --abbrev=7)"'"}'
 */
import { execFileSync } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

export interface StudiumBuildInfo {
  origin: "source" | "bundled";
  built_at: string | null;
  git_sha: string | null;
}

declare const __STUDIUM_BUILD__: unknown;

const GIT_TIMEOUT_MS = 1_000;
export type GitExec = (
  command: string,
  args: readonly string[],
  options: { timeout: number },
) => string;

/** Package version shared by MCP protocol metadata and diagnostics. */
export const SERVER_VERSION = packageJson.version;

function parseBuildInfo(value: unknown): StudiumBuildInfo | null {
  if (!value || typeof value !== "object") return null;
  const build = value as Record<string, unknown>;
  if (build["origin"] !== "source" && build["origin"] !== "bundled") return null;
  const builtAt = build["built_at"];
  const gitSha = build["git_sha"];
  if (builtAt !== null && typeof builtAt !== "string") return null;
  if (gitSha !== null && typeof gitSha !== "string") return null;
  return { origin: build["origin"], built_at: builtAt, git_sha: gitSha };
}

function readEnvironmentBuild(): StudiumBuildInfo | null {
  const encoded = process.env["STUDIUM_BUILD_INFO"];
  if (!encoded) return null;
  try {
    return parseBuildInfo(JSON.parse(encoded));
  } catch {
    return null;
  }
}

const runGit: GitExec = (command, args, options) => execFileSync(command, [...args], {
  encoding: "utf8",
  timeout: options.timeout,
  stdio: ["ignore", "pipe", "ignore"],
});

/** Read the source checkout identity once, with bounded git calls. */
export function getSourceBuildInfo(exec: GitExec = runGit): StudiumBuildInfo {
  try {
    const gitSha = exec("git", ["rev-parse", "--short", "HEAD"], { timeout: GIT_TIMEOUT_MS }).trim();
    if (!gitSha) return { origin: "source", built_at: null, git_sha: null };
    const dirty = exec("git", ["status", "--short", "--untracked-files=no"], {
      timeout: GIT_TIMEOUT_MS,
    }).trim().length > 0;
    return { origin: "source", built_at: null, git_sha: `${gitSha}${dirty ? "-dirty" : ""}` };
  } catch {
    return { origin: "source", built_at: null, git_sha: null };
  }
}

const COMPILED_BUILD = typeof __STUDIUM_BUILD__ === "undefined"
  ? null
  : parseBuildInfo(__STUDIUM_BUILD__);
const RESOLVED_BUILD = COMPILED_BUILD ?? readEnvironmentBuild() ?? getSourceBuildInfo();

/** Resolve compile-time identity first, then an environment override, then source defaults. */
export function getBuildInfo(): StudiumBuildInfo {
  return RESOLVED_BUILD;
}
