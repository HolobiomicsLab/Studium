// vibe-uninstall.ts — the extension's vscode:uninstall hook (bundled to dist/vibe-uninstall.cjs): remove the Studium
// entries this extension wrote into the assistants' configurations (Mistral Vibe, and those of assistant-config.ts),
// so that no assistant keeps a server whose file is gone. Best effort: VS Code runs it as a plain Node script,
// outside the extension host; any failure leaves a file as it was. A hand-written entry is never removed.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { ASSISTANT_IDS, assistantConfigPath, disconnectAssistant } from "./assistant-config.js";
import { disconnectEntry, vibeConfigPath } from "./vibe-config.js";

function remove(path: string | null, without: (text: string) => string | null): void {
  if (!path) return;
  try {
    const next = without(readFileSync(path, "utf8"));
    if (next !== null) {
      copyFileSync(path, `${path}.studium-backup`);
      writeFileSync(path, next, "utf8");
    }
  } catch {
    // Nothing to do: no such assistant, no entry of ours, or an unreadable file.
  }
}

remove(vibeConfigPath(process.env, homedir()), disconnectEntry);
for (const id of ASSISTANT_IDS) {
  remove(assistantConfigPath(id, { env: process.env, homedir: homedir(), platform: process.platform, exists: existsSync }),
    (text) => disconnectAssistant(id, text));
}
