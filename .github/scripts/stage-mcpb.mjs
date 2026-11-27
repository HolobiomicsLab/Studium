#!/usr/bin/env node
// Stage the Claude Desktop bundle studium-vX.Y.Z.mcpb: the single-file MCP server the VS Code build already bundled
// (apps/studium-vscode/dist/lesson-mcp.cjs), the lessons shipped with it, an icon, and a manifest.json in the MCP Bundle
// format (https://github.com/anthropics/mcpb). Claude Desktop runs a "node" bundle with the Node it ships, so the
// person installing it needs neither Node nor a terminal: a double click on the file, then Install.
//
//   node .github/scripts/stage-mcpb.mjs <version> <stage-dir>
//
// Then `mcpb validate <stage-dir>/manifest.json` and `mcpb pack <stage-dir> <file>.mcpb` (tools/release/build.sh).
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [version, outArg] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) || !outArg) {
  console.error("usage: stage-mcpb.mjs <version, for example 0.6.7> <stage-dir>");
  process.exit(2);
}

const root = resolve(new URL("../..", import.meta.url).pathname);
const bundle = join(root, "apps/studium-vscode/dist/lesson-mcp.cjs");
const shipped = join(root, "apps/lesson-mcp/shipped-lessons");
for (const needed of [bundle, shipped]) {
  if (!existsSync(needed)) {
    console.error(`missing ${needed}: run \`pnpm --filter studium-vscode build\` first`);
    process.exit(1);
  }
}

const out = resolve(outArg);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "server"), { recursive: true });
// The server reads the shipped lessons from shipped-lessons/ beside itself (apps/lesson-mcp/src/index.ts).
copyFileSync(bundle, join(out, "server", "studium-mcp.cjs"));
cpSync(shipped, join(out, "server", "shipped-lessons"), { recursive: true });
// The brand icon (docs/assets/brand/studium-icon.svg) at the 512 px Claude Desktop recommends.
copyFileSync(join(root, "apps/lesson-mcp/mcpb/icon-512.png"), join(out, "icon.png"));
copyFileSync(join(root, "LICENSE"), join(out, "LICENSE"));
copyFileSync(join(root, "NOTICE"), join(out, "NOTICE"));

const source = JSON.parse(readFileSync(join(root, "apps/lesson-mcp/package.json"), "utf8"));
const docs = "https://github.com/HolobiomicsLab/Studium/blob/main/docs";
const manifest = {
  manifest_version: "0.3",
  name: "studium",
  display_name: "Studium",
  version,
  description: source.description,
  long_description: [
    "Studium turns sources you trust into lessons you play with Claude: it asks the questions and keeps the answer keys,",
    "Claude shows each step and passes on your own words. Say « I want to learn X with Studium »: Claude builds a lesson from",
    "your sources, plays it with you, and schedules spaced reviews. Your progress stays on your computer, in ~/.studium.",
    "Start with the lesson shipped with it, « Discover Studium » (about twelve minutes, English or French). A research prototype.",
  ].join(" "),
  author: { name: "HolobiomicsLab", url: "https://github.com/HolobiomicsLab" },
  repository: { type: "git", url: "https://github.com/HolobiomicsLab/Studium" },
  homepage: source.homepage,
  documentation: `${docs}/start/harnesses.md#claude-desktop`,
  support: "https://github.com/HolobiomicsLab/Studium/issues",
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "server/studium-mcp.cjs",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/studium-mcp.cjs"],
      // No judge model, even if the environment names one (docs/reference/configuration.md).
      env: { LITELLM_BASE_URL: "" },
    },
  },
  tools_generated: true,
  keywords: ["learning", "education", "spaced-repetition", "lessons", "tutor"],
  license: "Apache-2.0",
  compatibility: { platforms: ["darwin", "win32"], runtimes: { node: ">=20.0.0" } },
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`staged the Claude Desktop bundle studium@${version} in ${out}`);
