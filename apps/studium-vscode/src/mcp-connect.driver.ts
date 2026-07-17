// mcp-connect.driver.ts — unit test for resolveTsx (the package-manager-tolerant tsx resolver).
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/mcp-connect.driver.ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTsx } from "./mcp-connect.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", ".."); // apps/studium-vscode/src -> repo root

// 1) in the real monorepo it finds an existing tsx binary (not the PATH fallback).
{
  const t = resolveTsx(repoRoot);
  expect(t.endsWith("tsx"), "resolveTsx returns a tsx path/command");
  expect(t !== "tsx" && existsSync(t), `resolveTsx finds an installed tsx in the monorepo (got ${t})`);
}

// 2) when no candidate exists, it falls back to the bare command on PATH (never throws).
{
  expect(resolveTsx("/no/such/repo/root/xyz") === "tsx", "resolveTsx falls back to 'tsx' on PATH when no binary is found");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} mcp-connect assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — mcp-connect (resolveTsx) passed all ${checks} assertions.`);
