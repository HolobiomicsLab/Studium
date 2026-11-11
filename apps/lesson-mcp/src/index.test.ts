import { describe, it, expect } from "vitest";
import { MCP_SERVER_NAME, cliAnswer, hostFromEnvironment } from "./index.js";
import packageJson from "../package.json" with { type: "json" };

describe("lesson-mcp", () => {
  it("exposes its server name", () => { expect(MCP_SERVER_NAME).toBe("studium-lesson"); });
});

// C6 / D4: the stdio entry point keeps lessons and progress under ~/.studium unless told otherwise.
describe("hostFromEnvironment", () => {
  it("defaults to a durable ~/.studium, the library as bundles root, and the anonymous learner", () => {
    const { host, config, live } = hostFromEnvironment({}, "/home/ada");
    expect(host.persistence()).toEqual({
      durable: true, data_dir: "/home/ada/.studium/data", library_root: "/home/ada/.studium/library", learner_id_default: "anonymous",
    });
    expect(host.bundlesRoot).toBe("/home/ada/.studium/library");
    expect(config.home).toBe("/home/ada/.studium");
    expect(live).toBe(false);
  });

  it("lets explicit variables win, and STUDIUM_EPHEMERAL=1 keep everything in memory", () => {
    const explicit = hostFromEnvironment({
      BUNDLES_ROOT: "/courses", STUDIUM_DATA_DIR: "/var/studium", STUDIUM_LEARNER_ID: "ada", STUDIUM_HOME: "/st",
    }, "/home/ada").host;
    expect(explicit.bundlesRoot).toBe("/courses");
    expect(explicit.persistence()).toEqual({ durable: true, data_dir: "/var/studium", library_root: "/st/library", learner_id_default: "ada" });

    const ephemeral = hostFromEnvironment({ STUDIUM_EPHEMERAL: "1" }, "/home/ada").host.persistence();
    expect(ephemeral).toMatchObject({ durable: false, data_dir: null });
    expect(ephemeral.warning).toMatch(/lost when this server restarts/);
  });
});

// The npm package is started by assistants over stdio; a person who runs it by hand to see what it
// is gets an answer and the shell back, not a silent process waiting on stdin.
describe("cliAnswer", () => {
  it("answers --version with the package version, alone on its line", () => {
    expect(cliAnswer(["--version"])).toBe(`${packageJson.version}\n`);
    expect(cliAnswer(["-v"])).toBe(`${packageJson.version}\n`);
  });

  it("answers --help with what the server is, how an assistant starts it, and where the guide is", () => {
    const help = cliAnswer(["--help"]) ?? "";
    expect(cliAnswer(["-h"])).toBe(help);
    expect(help).toContain(`studium-mcp ${packageJson.version}`);
    expect(help).toMatch(/started by an AI assistant over stdio/);
    expect(help).toContain("claude mcp add --scope user studium -- npx -y studium-mcp");
    expect(help).toContain("codex mcp add studium -- npx -y studium-mcp");
    for (const variable of ["STUDIUM_HOME", "BUNDLES_ROOT", "STUDIUM_DATA_DIR", "STUDIUM_EPHEMERAL", "STUDIUM_LEARNER_ID", "LITELLM_BASE_URL"]) {
      expect(help).toContain(variable);
    }
    expect(help).toContain("https://github.com/HolobiomicsLab/studium");
    // Plain text for a terminal: no line runs past 100 columns.
    expect(Math.max(...help.split("\n").map((line) => line.length))).toBeLessThanOrEqual(100);
  });

  it("starts the server for no argument or an unknown one", () => {
    expect(cliAnswer([])).toBeNull();
    expect(cliAnswer(["--stdio"])).toBeNull();
  });
});
