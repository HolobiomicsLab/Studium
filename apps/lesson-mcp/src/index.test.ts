import { describe, it, expect } from "vitest";
import { MCP_SERVER_NAME, cliAnswer, hostFromEnvironment, processAncestors, startedUnder } from "./index.js";
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
    // D1/D2 (waiting review 2026-11-25): STUDIUM_OPEN_LINK, set by the VS Code extension, is listed too.
    for (const variable of ["STUDIUM_HOME", "BUNDLES_ROOT", "STUDIUM_DATA_DIR", "STUDIUM_EPHEMERAL", "STUDIUM_LEARNER_ID", "LITELLM_BASE_URL", "STUDIUM_OPEN_LINK"]) {
      expect(help).toContain(variable);
    }
    // D4 (waiting review 2026-11-25, owner decision 4): the switch that turns the browser player off, and what it does.
    expect(help).toContain("STUDIUM_BROWSER_PLAYER");
    expect(help).toMatch(/STUDIUM_BROWSER_PLAYER[\s\S]*off[\s\S]*127\.0\.0\.1/);
    expect(help).toContain("https://github.com/HolobiomicsLab/studium");
    // Plain text for a terminal: no line runs past 100 columns.
    expect(Math.max(...help.split("\n").map((line) => line.length))).toBeLessThanOrEqual(100);
  });

  it("starts the server for no argument or an unknown one", () => {
    expect(cliAnswer([])).toBeNull();
    expect(cliAnswer(["--stdio"])).toBeNull();
  });
});

// Vibe connection (spec 2026-11-26-vibe-connect): the entry the VS Code extension writes into Mistral Vibe's
// configuration keeps the pane link only under the editor that wrote it; Vibe Desktop gets the browser player.
describe("STUDIUM_OPEN_LINK_UNDER", () => {
  const ROOT = "/Applications/Visual Studio Code.app/";
  const LINK = "vscode://holobiomicslab.studium-vscode/open?bundle=";
  const env = { STUDIUM_OPEN_LINK: LINK, STUDIUM_LEARNER_ID: "vscode-learner", STUDIUM_OPEN_LINK_UNDER: ROOT, STUDIUM_EPHEMERAL: "1" };
  const browserLink = async () => "http://127.0.0.1:1/play";

  it("keeps the pane link when an ancestor runs from the editor's folder", () => {
    const { host } = hostFromEnvironment(env, "/home/ada", {
      servesOnePerson: true, browserLink,
      ancestors: () => ["/Users/ada/.local/bin/vibe-acp", `${ROOT}Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin) --type=extensionHost`],
    });
    expect(host.openLink).toBe(LINK);
    expect(host.editorNamesLearner).toBe(true);
  });

  it("drops it under Vibe Desktop: the browser player instead, the same learner", async () => {
    const { host } = hostFromEnvironment(env, "/home/ada", {
      servesOnePerson: true, browserLink, ancestors: () => ["/Users/ada/.local/bin/vibe-acp", "/Applications/Vibe.app/Contents/MacOS/Vibe"],
    });
    expect(host.openLink).toBeNull();
    expect(host.editorNamesLearner).toBe(false);
    expect(host.learnerFixed).toBe(true);
    expect(host.defaultLearnerId).toBe("vscode-learner");
    expect(await host.browserLinkFor("x/lesson.json")).toBe("http://127.0.0.1:1/play");
  });

  it("changes nothing without the variable", () => {
    const { host } = hostFromEnvironment({ STUDIUM_OPEN_LINK: LINK, STUDIUM_LEARNER_ID: "vscode-learner" }, "/home/ada", { ancestors: () => [] });
    expect(host.openLink).toBe(LINK);
  });

  it("reads the ancestors with ps, nearest first, and none on Windows", () => {
    const table: Record<number, string> = { 50: "40 /bin/vibe-acp", 40: "1 /Applications/Vibe.app/Contents/MacOS/Vibe" };
    expect(processAncestors(50, (pid) => table[pid]!, "darwin")).toEqual(["/bin/vibe-acp", "/Applications/Vibe.app/Contents/MacOS/Vibe"]);
    expect(processAncestors(50, () => { throw new Error("no ps"); }, "linux")).toEqual([]);
    expect(processAncestors(50, (pid) => table[pid]!, "win32")).toEqual([]);
    expect(startedUnder(ROOT, ["/bin/zsh", `${ROOT}Contents/MacOS/Electron`])).toBe(true);
  });
});
