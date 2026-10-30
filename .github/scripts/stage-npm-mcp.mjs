#!/usr/bin/env node
// Stage the npm package `studium-mcp`: the single-file MCP server that the VS Code build already
// bundled (apps/studium-vscode/dist/lesson-mcp.cjs), with a manifest that has no runtime dependency.
//
//   node .github/scripts/stage-npm-mcp.mjs <version> <out-dir>
//
// The workspace package @studium/lesson-mcp stays private: its dependencies are workspace links that
// npm cannot resolve. What a user installs is the bundle, so the manifest is written here.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [version, outArg] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) || !outArg) {
  console.error("usage: stage-npm-mcp.mjs <version, for example 0.2.0> <out-dir>");
  process.exit(2);
}

const root = resolve(new URL("../..", import.meta.url).pathname);
const bundle = join(root, "apps/studium-vscode/dist/lesson-mcp.cjs");
if (!existsSync(bundle)) {
  console.error(`missing ${bundle}: run \`pnpm --filter studium-vscode build\` first`);
  process.exit(1);
}

const out = resolve(outArg);
mkdirSync(out, { recursive: true });

// The extension build has no shebang banner; `bin` needs one.
const code = readFileSync(bundle, "utf8");
const server = join(out, "studium-mcp.cjs");
writeFileSync(server, code.startsWith("#!") ? code : `#!/usr/bin/env node\n${code}`);
chmodSync(server, 0o755);

copyFileSync(join(root, "LICENSE"), join(out, "LICENSE"));
copyFileSync(join(root, "NOTICE"), join(out, "NOTICE"));
copyFileSync(join(root, "apps/lesson-mcp/README.md"), join(out, "README.md"));

const source = JSON.parse(readFileSync(join(root, "apps/lesson-mcp/package.json"), "utf8"));
const manifest = {
  name: "studium-mcp",
  version,
  description: source.description,
  license: "Apache-2.0",
  homepage: "https://github.com/HolobiomicsLab/studium#readme",
  repository: { type: "git", url: "git+https://github.com/HolobiomicsLab/studium.git", directory: "apps/lesson-mcp" },
  bugs: { url: "https://github.com/HolobiomicsLab/studium/issues" },
  keywords: ["mcp", "model-context-protocol", "learning", "education", "spaced-repetition", "codex", "claude-code"],
  bin: { "studium-mcp": "studium-mcp.cjs" },
  files: ["studium-mcp.cjs", "LICENSE", "NOTICE", "README.md"],
  engines: source.engines,
};
writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`staged studium-mcp@${version} in ${out}`);
