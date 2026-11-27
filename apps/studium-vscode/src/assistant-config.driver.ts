// assistant-config.driver.ts — unit tests for assistant-config.ts: each assistant's file is edited in place, one
// "studium" server at a time, and nothing else in it changes.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/assistant-config.driver.ts
import { parse as parseToml } from "smol-toml";
import { parse as parseJsonc } from "jsonc-parser";
import {
  ASSISTANT_IDS, assistantConfigPath, assistantEntryIsCurrent, codexEntryToml, connectAssistant, disconnectAssistant, studiumState,
  type AssistantId, type ConnectResult,
} from "./assistant-config.js";
import { VIBE_MARKER, VIBE_MARKER_KEY } from "./vibe-config.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const HELPER = "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)";
const entry = (version: string) => ({
  command: HELPER,
  args: [`/Users/ada/.vscode/extensions/holobiomicslab.studium-vscode-${version}/dist/lesson-mcp.cjs`],
  env: { ELECTRON_RUN_AS_NODE: "1", LITELLM_BASE_URL: "", STUDIUM_TELEMETRY_CONSENT: null, STUDIUM_LEARNER_ID: "vscode-learner" },
});
const textOf = (r: ConnectResult): string => ("text" in r ? r.text : (() => { throw new Error(JSON.stringify(r)); })());
const json = (text: string): any => parseJsonc(text, [], { allowTrailingComma: true });

// Where each assistant reads.
{
  const base = { env: {}, homedir: "/Users/ada", platform: "darwin" };
  expect(assistantConfigPath("codex", base) === "/Users/ada/.codex/config.toml", "codex: ~/.codex/config.toml");
  expect(assistantConfigPath("codex", { ...base, env: { CODEX_HOME: "~/cx" } }) === "/Users/ada/cx/config.toml", "codex: CODEX_HOME, ~ expanded");
  expect(assistantConfigPath("claude-code", base) === "/Users/ada/.claude.json", "claude code: ~/.claude.json");
  expect(assistantConfigPath("claude-code", { ...base, env: { CLAUDE_CONFIG_DIR: "/tmp/cc" } }) === "/tmp/cc/.claude.json", "claude code: CLAUDE_CONFIG_DIR");
  expect(assistantConfigPath("claude-desktop", base) === "/Users/ada/Library/Application Support/Claude/claude_desktop_config.json", "claude desktop on macOS");
  expect(assistantConfigPath("claude-desktop", { ...base, platform: "linux" }) === null, "no Claude Desktop on Linux");
  expect(assistantConfigPath("claude-desktop", { env: { APPDATA: "C:/Users/ada/AppData/Roaming" }, homedir: "C:/Users/ada", platform: "win32" })!.replace(/\\/g, "/")
    .endsWith("Roaming/Claude/claude_desktop_config.json"), "claude desktop on Windows: %APPDATA%");
  expect(assistantConfigPath("cursor", base) === "/Users/ada/.cursor/mcp.json", "cursor: ~/.cursor/mcp.json");
  expect(assistantConfigPath("opencode", base) === "/Users/ada/.config/opencode/opencode.json", "opencode: ~/.config/opencode/opencode.json");
  expect(assistantConfigPath("opencode", { ...base, env: { XDG_CONFIG_HOME: "/x" }, exists: (p) => p.endsWith(".jsonc") }) === "/x/opencode/opencode.jsonc",
    "opencode: XDG_CONFIG_HOME, and opencode.jsonc when it alone exists");
}

// Every assistant: an absent or blank file gets the entry alone; it is ours, current, and goes away on disconnect.
for (const id of ASSISTANT_IDS) {
  for (const start of [undefined, "", "  \n"]) {
    const text = textOf(connectAssistant(id, start, entry("0.6.6"), { replaceHandWritten: false }));
    const state = studiumState(id, text);
    expect(!!state?.present && state.ours, `${id}: the new file holds our entry (${JSON.stringify(start)})`);
    expect(state!.command.startsWith(HELPER), `${id}: the command keeps the helper's path whole (${state?.command})`);
    expect(assistantEntryIsCurrent(id, text, entry("0.6.6")) && !assistantEntryIsCurrent(id, text, entry("0.6.7")), `${id}: current for this version only`);
    const off = disconnectAssistant(id, text);
    expect(off !== null && !studiumState(id, off)!.present, `${id}: disconnect removes it`);
  }
}

// Codex: the shape `codex mcp add` writes, other servers and comments kept, a hand-written entry asked for.
{
  const block = codexEntryToml(entry("0.6.6"));
  const doc = parseToml(block) as any;
  const server = doc.mcp_servers.studium;
  expect(server.command === HELPER && server.args[0].endsWith("lesson-mcp.cjs"), "codex: command and args");
  expect(server.env[VIBE_MARKER_KEY] === VIBE_MARKER && server.env.ELECTRON_RUN_AS_NODE === "1", "codex: env with the marker");
  expect(!("STUDIUM_TELEMETRY_CONSENT" in server.env) && server.env.LITELLM_BASE_URL === "", "codex: null values dropped, empty kept");
  const user = 'model = "o9"  # mine\n\n[mcp_servers.perspicacite]\nurl = "http://localhost:8000/mcp"\n\n[profiles.fast]\nmodel = "mini"\n';
  const added = textOf(connectAssistant("codex", user, entry("0.6.6"), { replaceHandWritten: false }));
  expect(added.startsWith(user) && added.includes("# mine"), "codex: the file before is kept as it was");
  const parsed = parseToml(added) as any;
  expect(parsed.mcp_servers.perspicacite.url && parsed.profiles.fast.model === "mini" && parsed.model === "o9", "codex: other tables kept");
  // Updating replaces our two tables in place, before the tables that follow.
  const middle = user.replace("[profiles.fast]", block + "\n[profiles.fast]");
  const updated = textOf(connectAssistant("codex", middle, entry("0.6.7"), { replaceHandWritten: false }));
  expect(updated.includes("0.6.7") && !updated.includes("0.6.6") && (parseToml(updated) as any).profiles.fast.model === "mini", "codex: update in place");
  expect(updated.indexOf("[mcp_servers.studium]") < updated.indexOf("[profiles.fast]"), "codex: the entry stays where it was");
  const off = disconnectAssistant("codex", middle)!;
  expect(off !== null && !off.includes("studium") && (parseToml(off) as any).profiles.fast.model === "mini", "codex: disconnect keeps the rest");
  const hand = '[mcp_servers."studium"]\ncommand = "npx"\nargs = ["-y", "studium-mcp"]\n';
  const asked = connectAssistant("codex", hand, entry("0.6.6"), { replaceHandWritten: false });
  expect("refused" in asked && asked.refused === "hand-written" && asked.command === "npx -y studium-mcp", "codex: a hand-written entry is not replaced unasked");
  const replaced = textOf(connectAssistant("codex", hand, entry("0.6.6"), { replaceHandWritten: true }));
  expect(studiumState("codex", replaced)!.ours && !replaced.includes("npx"), "codex: replaced on a yes (quoted header)");
  expect(disconnectAssistant("codex", hand) === null, "codex: a hand-written entry is never removed");
  const dotted = '[mcp_servers]\nstudium.command = "npx"\n';
  const refusedDotted = connectAssistant("codex", dotted, entry("0.6.6"), { replaceHandWritten: true });
  expect("refused" in refusedDotted && refusedDotted.refused === "unparsable", "codex: dotted keys cannot be edited table by table: refused");
  const broken = connectAssistant("codex", "[mcp_servers\n", entry("0.6.6"), { replaceHandWritten: false });
  expect("refused" in broken && broken.refused === "unparsable", "codex: a file that does not parse is refused");
}

// Claude Code and Claude Desktop: mcpServers.studium, the rest of a big state file untouched.
for (const id of ["claude-code", "claude-desktop", "cursor"] as AssistantId[]) {
  const user = '{\n  "numStartups": 12,\n  "projects": {"/a": {"allowedTools": []}},\n  "mcpServers": {\n    "perspicacite": {"type": "http", "url": "http://localhost:8000/mcp"}\n  }\n}\n';
  const added = textOf(connectAssistant(id, user, entry("0.6.6"), { replaceHandWritten: false }));
  const doc = json(added);
  expect(doc.numStartups === 12 && doc.projects["/a"] && doc.mcpServers.perspicacite.url, `${id}: the rest kept`);
  const server = doc.mcpServers.studium;
  expect(server.command === HELPER && server.env[VIBE_MARKER_KEY] === VIBE_MARKER && !("STUDIUM_TELEMETRY_CONSENT" in server.env), `${id}: our entry`);
  expect(id !== "claude-desktop" ? server.type === "stdio" : !("type" in server), `${id}: type as \`claude mcp add\` writes it`);
  const hand = '{"mcpServers": {"studium": {"command": "npx", "args": ["-y", "studium-mcp"]}}}';
  const asked = connectAssistant(id, hand, entry("0.6.6"), { replaceHandWritten: false });
  expect("refused" in asked && asked.refused === "hand-written" && asked.command === "npx -y studium-mcp", `${id}: asks before replacing`);
  expect(disconnectAssistant(id, hand) === null, `${id}: never removes a hand-written entry`);
  const off = json(disconnectAssistant(id, added)!);
  expect(!off.mcpServers.studium && off.mcpServers.perspicacite && off.numStartups === 12, `${id}: disconnect keeps the rest`);
  const broken = connectAssistant(id, '{"mcpServers": {', entry("0.6.6"), { replaceHandWritten: false });
  expect("refused" in broken && broken.refused === "unparsable", `${id}: invalid JSON refused`);
  const array = connectAssistant(id, "[]", entry("0.6.6"), { replaceHandWritten: false });
  expect("refused" in array, `${id}: a file that is not an object is refused`);
}

// OpenCode: comments kept (JSONC), flat mcp.<name> by default, nested mcp.servers.<name> when the file nests already.
{
  const user = '{\n  // my setup\n  "$schema": "https://opencode.ai/config.json",\n  "model": "opencode/big-pickle",\n}\n';
  const added = textOf(connectAssistant("opencode", user, entry("0.6.6"), { replaceHandWritten: false }));
  expect(added.includes("// my setup"), "opencode: comments kept");
  const doc = json(added);
  const server = doc.mcp.studium;
  expect(server.type === "local" && server.enabled === true && server.command[0] === HELPER && server.command[1].endsWith("lesson-mcp.cjs"),
    "opencode: local, enabled, command list with its argument");
  expect(server.environment[VIBE_MARKER_KEY] === VIBE_MARKER && doc.model === "opencode/big-pickle", "opencode: environment with the marker, rest kept");
  const nested = '{"mcp": {"servers": {"other": {"type": "local", "command": ["x"]}}}}';
  const inNest = json(textOf(connectAssistant("opencode", nested, entry("0.6.6"), { replaceHandWritten: false })));
  expect(inNest.mcp.servers.studium?.type === "local" && inNest.mcp.servers.other && !inNest.mcp.studium, "opencode 2: nested beside the others");
  const hand = '{"mcp": {"studium": {"type": "local", "command": ["npx", "-y", "studium-mcp"]}}}';
  const asked = connectAssistant("opencode", hand, entry("0.6.6"), { replaceHandWritten: false });
  expect("refused" in asked && asked.refused === "hand-written" && asked.command === "npx -y studium-mcp", "opencode: asks before replacing");
}

console.log(failures.length === 0
  ? `OK — assistant-config driver passed all ${checks} assertions.`
  : `${failures.length} FAILED of ${checks}:\n  - ${failures.join("\n  - ")}`);
if (failures.length) process.exit(1);
