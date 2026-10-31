import { describe, expect, it } from "vitest";
import { getSourceBuildInfo, type GitExec } from "./build-info.js";

describe("getSourceBuildInfo", () => {
  it("reads HEAD at startup and appends the dirty marker with bounded git calls", () => {
    const calls: Array<{ args: readonly string[]; timeout: number }> = [];
    const exec: GitExec = (_command, args, options) => {
      calls.push({ args, timeout: options.timeout });
      return args[0] === "rev-parse" ? "eb5b1e1\n" : " M apps/lesson-mcp/src/server.ts\n";
    };

    expect(getSourceBuildInfo(exec)).toEqual({ origin: "source", built_at: null, git_sha: "eb5b1e1-dirty" });
    expect(calls.map((call) => call.args)).toEqual([
      ["rev-parse", "--short", "HEAD"],
      ["status", "--short", "--untracked-files=no"],
    ]);
    expect(calls.every((call) => call.timeout === 1_000)).toBe(true);
  });

  it("returns a clean SHA or null when git is unavailable", () => {
    const clean: GitExec = (_command, args) => args[0] === "rev-parse" ? "eb5b1e1\n" : "";
    expect(getSourceBuildInfo(clean).git_sha).toBe("eb5b1e1");
    expect(getSourceBuildInfo(() => { throw new Error("timeout"); }).git_sha).toBeNull();
  });
});
