// dist-load.driver.ts — the built files load (2026-11-27). Studium 0.6.6 shipped an extension that did not start at all:
// esbuild had bundled jsonc-parser's UMD build, whose require("./impl/format") resolves nowhere once bundled, so
// activation failed before any command was registered (« command 'studium.connectAssistant' not found »). The drivers
// run the sources through tsx, where that require resolves; only loading dist/ shows it. So this driver loads
// dist/extension.js with a stand-in for the vscode module, and runs dist/vibe-uninstall.cjs (the uninstall hook)
// against a temporary home, never the real configuration files.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const failures: string[] = [];
let checks = 0;
const expect = (ok: boolean, what: string) => { checks++; if (!ok) failures.push(what); };

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const extension = join(dist, "extension.js");
const uninstall = join(dist, "vibe-uninstall.cjs");
expect(existsSync(extension) && existsSync(uninstall), `the build is there (${dist}); run pnpm --filter studium-vscode build first`);

// Any property of the stand-in is a callable stand-in: loading the bundle only defines things; activate() is not called.
const standIn: any = new Proxy(function () { return standIn; }, { get: (_t, key) => key === Symbol.toPrimitive ? () => "" : standIn, apply: () => standIn, construct: () => standIn });
const load = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: unknown[]) { return request === "vscode" ? standIn : load.call(this, request, ...rest); };
// Loading must not read `navigator`: Zod's allowsEval probe does, and Node 21+ then warns (PendingMigrationError). The lesson
// schema validator is needed only when a lesson is imported, so lesson-archive is reached by a dynamic import().
const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let navigatorReads = 0;
Object.defineProperty(globalThis, "navigator", { configurable: true, get() { navigatorReads++; return navigatorBefore?.get?.call(globalThis) ?? navigatorBefore?.value; } });
let loaded: any = null;
try { loaded = createRequire(import.meta.url)(extension); } catch (e: any) { failures.push(`dist/extension.js loads (got: ${e?.message ?? e})`); }
finally {
  (Module as any)._load = load;
  if (navigatorBefore) Object.defineProperty(globalThis, "navigator", navigatorBefore); else delete (globalThis as any).navigator;
}
expect(navigatorReads === 0, `loading dist/extension.js reads no navigator (read ${navigatorReads} times): the lesson schema validator is not evaluated at start-up`);
expect(typeof loaded?.activate === "function" && typeof loaded?.deactivate === "function", "dist/extension.js exports activate and deactivate");

const home = mkdtempSync(join(tmpdir(), "studium-dist-load-"));
try {
  const run = spawnSync(process.execPath, [uninstall], {
    env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData"), XDG_CONFIG_HOME: join(home, ".config"),
      CODEX_HOME: join(home, ".codex"), CLAUDE_CONFIG_DIR: join(home, ".claude"), VIBE_HOME: join(home, ".vibe") },
    encoding: "utf8", timeout: 20000,
  });
  expect(run.status === 0, `dist/vibe-uninstall.cjs runs to its end on an empty home (exit ${run.status}: ${(run.stderr || run.stdout || "").slice(0, 300)})`);
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log(failures.length === 0
  ? `OK — dist-load (the built extension and uninstall hook load) passed all ${checks} assertions.`
  : `${failures.length} FAILED of ${checks}:\n  - ${failures.join("\n  - ")}`);
if (failures.length) process.exit(1);
