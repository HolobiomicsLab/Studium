import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

function payload(result: Awaited<ReturnType<Client["callTool"]>>) {
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
}

describe("session language over MCP", () => {
  it("supports start and change with the same host preference exposed by operator context", async () => {
    const fixtures = resolve(fileURLToPath(new URL("../../../fixtures/", import.meta.url)));
    const host = new SessionHost({ bundlesRoot: fixtures, live: false, dataDir: null }); // I-10: in memory
    const server = buildMcpServer(host);
    const client = new Client({ name: "language-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      const started = payload(await client.callTool({ name: "start_lesson_session", arguments: {
        bundle_ref: "capsule-judgment-demo/lesson.json", learner_id: "language-test", presentation_language: "pt-BR",
        now_ms: Date.UTC(2035, 0, 1),
      } }));
      expect(started.language.selected_language).toBe("pt-BR");
      expect(started.resume.kind).toBe("new");
      expect(started.authoring).toEqual(started.presentation.authoring);
      expect(started.authoring.mode).toBe("teacher");
      const changed = payload(await client.callTool({ name: "set_session_language", arguments: {
        session_id: started.session_id, presentation_language: "ja",
      } }));
      expect(changed.language.selected_language).toBe("ja");
      const context = payload(await client.callTool({ name: "get_operator_context", arguments: { session_id: started.session_id } }));
      expect(context.language).toEqual(changed.language);
      expect(JSON.stringify(context)).not.toMatch(/flaws_expected|model_correction/);

      const invalid = await client.callTool({ name: "set_session_language", arguments: {
        session_id: started.session_id, presentation_language: "bad_tag",
      } });
      expect(invalid.isError).toBe(true);
      expect(payload(await client.callTool({ name: "get_operator_context", arguments: { session_id: started.session_id } })).language.selected_language).toBe("ja");
    } finally {
      await client.close(); await server.close();
    }
  });
});
