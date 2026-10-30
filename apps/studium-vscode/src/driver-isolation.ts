// driver-isolation.ts — keep the extension drivers out of the developer's home (sprint decision I-10).
//
// A driver that starts the lesson-mcp server (directly over stdio, or through the extension under a fake
// `vscode`) inherits the C6 defaults of the stdio entry point: lessons in ~/.studium/library and durable
// progress in ~/.studium/data. A test run must never write there. isolateFromHome() points STUDIUM_HOME at a
// fresh temporary folder, sets STUDIUM_EPHEMERAL=1, drops an inherited STUDIUM_DATA_DIR (a caller that wants
// durable state sets its own temporary one, as the extension does with its storage folder), and points HOME
// at an empty sentinel folder, so anything that still falls back to the home directory lands where the driver
// can see it. homeUntouched() is the driver's closing check.
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface DriverIsolation {
  /** The empty folder HOME now points at. */
  home: string;
  /** The temporary STUDIUM_HOME. */
  studiumHome: string;
  /** The variables to give a child process (also applied to process.env). */
  env: Record<string, string>;
  /** True while nothing at all has been written into the sentinel HOME. */
  homeUntouched: () => boolean;
}

export function isolateFromHome(label: string): DriverIsolation {
  const root = mkdtempSync(join(tmpdir(), `studium-${label}-`));
  const home = join(root, "home");
  const studiumHome = join(root, "studium-home");
  mkdirSync(home, { recursive: true });
  const env = { HOME: home, USERPROFILE: home, STUDIUM_HOME: studiumHome, STUDIUM_EPHEMERAL: "1" };
  delete process.env["STUDIUM_DATA_DIR"];
  Object.assign(process.env, env);
  return { home, studiumHome, env, homeUntouched: () => existsSync(home) && readdirSync(home).length === 0 };
}
