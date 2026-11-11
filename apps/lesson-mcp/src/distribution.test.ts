// apps/lesson-mcp/src/distribution.test.ts
//
// The files through which Studium is installed without a checkout name the same server at the same
// version: the npm package (staged by .github/scripts/stage-npm-mcp.mjs), the MCP Registry entry
// (server.json), and the Claude Code plugin with its marketplace (.claude-plugin/). Nothing else keeps
// them in step, and a registry refuses, or a user installs, a mismatch only after the release.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import packageJson from "../package.json" with { type: "json" };

const root = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");
const json = (path: string): Record<string, any> => JSON.parse(read(path)) as Record<string, any>;
const NPM_PACKAGE = "studium-mcp";

describe("distribution manifests", () => {
  it("the extension and the server carry one product version", () => {
    expect(json("apps/studium-vscode/package.json")["version"]).toBe(packageJson.version);
  });

  it("server.json lists the npm package at the product version, under a name the registry accepts", () => {
    const server = json("server.json");
    expect(server["version"]).toBe(packageJson.version);
    expect(server["name"]).toMatch(/^io\.github\.HolobiomicsLab\/[a-zA-Z0-9._-]+$/);
    expect((server["description"] as string).length).toBeLessThanOrEqual(100);
    expect(server["packages"]).toHaveLength(1);
    expect(server["packages"][0]).toMatchObject({
      registryType: "npm", identifier: NPM_PACKAGE, version: packageJson.version, transport: { type: "stdio" },
    });
    // The staged npm manifest claims that registry name and ships the README written for npm users.
    const stage = read(".github/scripts/stage-npm-mcp.mjs");
    expect(stage).toContain(`name: "${NPM_PACKAGE}"`);
    expect(stage).toContain('mcpName: JSON.parse(readFileSync(join(root, "server.json"), "utf8")).name');
    expect(stage).toContain('"apps/lesson-mcp/README.npm.md"');
    expect(existsSync(new URL("apps/lesson-mcp/README.npm.md", root))).toBe(true);
    // npm compares `repository.url` with the repository the release workflow runs in, letter for letter,
    // before it accepts a trusted publication: the repository is HolobiomicsLab/Studium, capital S.
    expect(stage).toContain('url: "git+https://github.com/HolobiomicsLab/Studium.git"');
  });

  it("the Claude Code plugin starts that npm package and ships agents that exist", () => {
    const plugin = json(".claude-plugin/plugin.json");
    expect(plugin["name"]).toBe("studium");
    expect(plugin["version"]).toBe(packageJson.version);
    expect(plugin["mcpServers"]["studium"]).toMatchObject({ command: "npx", args: ["-y", NPM_PACKAGE] });
    expect(plugin["agents"]).toHaveLength(2);
    for (const agent of plugin["agents"] as string[]) {
      expect(agent.startsWith("./")).toBe(true);
      expect(existsSync(new URL(agent.slice(2), root))).toBe(true);
    }
    // The skills are found by the plugin's default scan of skills/ at its root.
    expect(existsSync(new URL("skills/studium-harness/SKILL.md", root))).toBe(true);
  });

  it("the marketplace lists the plugin of this repository under the same name", () => {
    const marketplace = json(".claude-plugin/marketplace.json");
    expect(marketplace["name"]).toBe("holobiomicslab");
    expect(marketplace["plugins"]).toEqual([expect.objectContaining({ name: "studium", source: "./" })]);
  });

  it("the help of the command names the package the manifests install", () => {
    expect(read("apps/lesson-mcp/src/index.ts")).toContain(`npx -y ${NPM_PACKAGE}`);
  });
});
