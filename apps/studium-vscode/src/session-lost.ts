/** The server's reason when an action reached a session it no longer knows (the server restarted, or the session
 * was closed), else null. The host's error starts with « session not found »; mcp-connect.ts puts the tool's name in
 * front of it (`panel_action: session not found: …`). Only that prefix is read, never the rest of the message.
 * extension.ts forwards the reason to the pane, whose renderer shows the « session lost » notice and its reopen
 * button instead of the generic action error (walkthrough 2026-11-07). */
export function sessionLostReason(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  const reason = message.replace(/^[a-z_]+: (?=session not found)/, "");
  return reason.startsWith("session not found") ? reason : null;
}
