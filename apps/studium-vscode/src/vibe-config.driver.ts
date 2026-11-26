// vibe-config.driver.ts — unit tests for vibe-config.ts: Vibe's config.toml is edited one table at a time.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/vibe-config.driver.ts
import { parse } from "smol-toml";
import {
  VIBE_MARKER, VIBE_MARKER_KEY, connectEntry, disconnectEntry, editorInstallRoot, entryIsCurrent, findStudiumTable,
  hasOurEntry, hasStudiumServer, otherStudiumServer, studiumEntryToml, vibeConfigPath, vibeHome,
} from "./vibe-config.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const HELPER = "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)";
const entry = (version: string) => ({
  command: HELPER,
  args: [`/Users/ada/.vscode/extensions/holobiomicslab.studium-vscode-${version}/dist/lesson-mcp.cjs`],
  env: { ELECTRON_RUN_AS_NODE: "1", LITELLM_BASE_URL: "", STUDIUM_TELEMETRY_CONSENT: null, STUDIUM_LEARNER_ID: "vscode-learner" },
});
const block = studiumEntryToml(entry("0.6.6"));
const servers = (text: string) => (parse(text) as { mcp_servers?: Array<Record<string, any>> }).mcp_servers ?? [];
const studiumOf = (text: string) => servers(text).filter((s) => s["name"] === "studium");
const textOf = (r: ReturnType<typeof connectEntry>): string => ("text" in r ? r.text : (() => { throw new Error(JSON.stringify(r)); })());

// Where Vibe reads.
expect(vibeConfigPath({}, "/Users/ada") === "/Users/ada/.vibe/config.toml", "default: ~/.vibe/config.toml");
expect(vibeHome({ VIBE_HOME: "~/vibe-alt" }, "/Users/ada") === "/Users/ada/vibe-alt", "VIBE_HOME with ~ is expanded");
expect(vibeHome({ VIBE_HOME: "  " }, "/Users/ada") === "/Users/ada/.vibe", "a blank VIBE_HOME is unset");
expect(editorInstallRoot(HELPER) === "/Applications/Visual Studio Code.app/", `macOS: the .app bundle (got ${editorInstallRoot(HELPER)})`);
expect(editorInstallRoot("/usr/share/code/code") === "/usr/share/code", "elsewhere: the executable's folder");

// The block parses, names studium, carries the marker, and drops null env values; paths with spaces survive.
{
  const [server] = studiumOf(block);
  // Vibe splits a string command on spaces (shlex): measured, "mcp_transport_failed" with the VS Code helper's path.
  expect(Array.isArray(server?.["command"]) && server?.["command"][0] === HELPER && server?.["transport"] === "stdio",
    `the command is a one-item list, the path with its spaces whole (got ${JSON.stringify(server)})`);
  expect(server?.["env"]?.[VIBE_MARKER_KEY] === VIBE_MARKER, "the block carries the marker");
  expect(!("STUDIUM_TELEMETRY_CONSENT" in (server?.["env"] ?? {})) && server?.["env"]?.["LITELLM_BASE_URL"] === "", "null values are left out, empty ones kept");
  const windows = studiumEntryToml({ command: "C:\\Program Files\\Microsoft VS Code\\Code.exe", args: ['C:\\x\\"q"\\lesson-mcp.cjs'], env: {} });
  expect(studiumOf(windows)[0]?.["command"]?.[0] === "C:\\Program Files\\Microsoft VS Code\\Code.exe", "backslashes are escaped");
  expect(studiumOf(windows)[0]?.["args"]?.[0] === 'C:\\x\\"q"\\lesson-mcp.cjs', "quotes are escaped");
}

// A missing or blank file: the block alone.
expect(textOf(connectEntry(undefined, block, { replaceHandWritten: false })) === block, "no file: the block");
expect(textOf(connectEntry("\n  \n", block, { replaceHandWritten: false })) === block, "a blank file: the block");

// Another user's file: everything kept byte for byte, the entry appended.
const USER = `# my Vibe settings
active_model = "devstral"

[[mcp_servers]]
name = "linear"   # my tracker
transport = "http"
url = "https://mcp.linear.app/mcp"

[mcp_servers.headers]
X-Team = "bio"

[tools.bash]
permission = "ask"
`;
{
  const once = textOf(connectEntry(USER, block, { replaceHandWritten: false }));
  expect(once.startsWith(USER), "appending keeps the user's file byte for byte");
  expect(servers(once).length === 2 && studiumOf(once).length === 1, "two servers after appending");
  expect(hasOurEntry(once) && hasStudiumServer(once) && !hasOurEntry(USER), "the entry is recognised as ours");
  expect(entryIsCurrent(once, block), "the entry just written is current");
  // A new Studium version: ours is replaced in place, the rest untouched.
  const newer = studiumEntryToml(entry("0.6.7"));
  expect(!entryIsCurrent(once, newer), "another version is not current");
  const twice = connectEntry(once, newer, { replaceHandWritten: false });
  const again = textOf(twice);
  expect("replaced" in twice && twice.replaced === "ours", "ours is replaced without asking");
  expect(again === USER + "\n" + newer, `replacing ours keeps everything else (got ${JSON.stringify(again)})`);
  // Disconnect removes only ours.
  expect(disconnectEntry(again) === USER, `disconnecting gives the user's file back (got ${JSON.stringify(disconnectEntry(again))})`);
  expect(disconnectEntry(USER) === null, "nothing of ours: null");
}

// Ours in the middle of the file, followed by a sub-table of the next server and a plain table.
{
  const middle = `[[mcp_servers]]
name = "a"
transport = "stdio"
command = "a"

${block}
[[mcp_servers]]
name = "b"
transport = "stdio"
command = "b"

[mcp_servers.env]
B = "1"
`;
  const table = findStudiumTable(middle)!;
  expect(middle.slice(table.start, table.end).trimEnd() === block.trimEnd(), `the table ends at the next [[mcp_servers]] (got ${JSON.stringify(middle.slice(table.start, table.end))})`);
  const removed = disconnectEntry(middle)!;
  expect(servers(removed).map((s) => s["name"]).join() === "a,b" && servers(removed)[1]?.["env"]?.["B"] === "1", "removing ours keeps a and b with b's env");
}

// A hand-written studium entry (the old npx page): refused, then replaced on a yes.
{
  const HAND = `[[mcp_servers]]
name = "studium"
transport = "stdio"
command = "npx"
args = ["-y", "studium-mcp"]

[mcp_servers.env]
LITELLM_BASE_URL = ""
`;
  const refused = connectEntry(HAND, block, { replaceHandWritten: false });
  expect("refused" in refused && refused.refused === "hand-written" && "command" in refused && refused.command === "npx -y studium-mcp",
    `a hand-written entry is refused, naming its command (got ${JSON.stringify(refused)})`);
  const yes = connectEntry(HAND, block, { replaceHandWritten: true });
  expect(textOf(yes) === block && "replaced" in yes && yes.replaced === "hand-written", "on a yes it is replaced");
  expect(disconnectEntry(HAND) === null, "disconnect never removes a hand-written entry");
  expect(otherStudiumServer(HAND.replace('name = "studium"', 'name = "my-studium"')) === "my-studium", "Studium under another name is seen");
  expect(otherStudiumServer(USER) === null, "no other Studium in the user's file");
}

// A file that does not parse, or servers written as an inline array: refused, nothing to write.
{
  const broken = connectEntry('active_model = "devstral\n', block, { replaceHandWritten: true });
  expect("refused" in broken && broken.refused === "unparsable", "an unparsable file is refused");
  const inline = connectEntry('mcp_servers = [{ name = "studium", transport = "stdio", command = "npx" }]\n', block, { replaceHandWritten: true });
  expect("refused" in inline && inline.refused === "unparsable", "an inline array of servers is refused (cannot edit table by table)");
}

if (failures.length) { console.error(`FAIL (${failures.length}/${checks}):`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log(`OK — vibe-config driver passed all ${checks} assertions`);
