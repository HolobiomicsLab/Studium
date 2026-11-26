// vibe-uninstall.ts — the extension's vscode:uninstall hook (bundled to dist/vibe-uninstall.cjs): remove the Studium
// entry this extension wrote into Mistral Vibe's configuration, so that Vibe does not keep a server whose file is
// gone. Best effort: VS Code runs it as a plain Node script, outside the extension host; any failure leaves the file
// as it was. A hand-written entry is never removed.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { disconnectEntry, vibeConfigPath } from "./vibe-config.js";

try {
  const path = vibeConfigPath(process.env, homedir());
  const next = disconnectEntry(readFileSync(path, "utf8"));
  if (next !== null) {
    copyFileSync(path, `${path}.studium-backup`);
    writeFileSync(path, next, "utf8");
  }
} catch {
  // Nothing to do: no Vibe, no entry of ours, or an unreadable file.
}
