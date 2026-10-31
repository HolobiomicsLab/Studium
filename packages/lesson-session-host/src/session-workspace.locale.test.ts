import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";
import { SessionWorkspace } from "./session-workspace.js";

const roots: string[] = [];

function englishBundleRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "studium-locale-en-"));
  roots.push(root);
  writeFileSync(join(root, "lesson.json"), JSON.stringify({
    schema_version: "1.4",
    bundle_id: "workspace-en",
    source_plan_id: "plan",
    metadata: { title: "English", target: "L1", duration_minutes: 5, language: "en", discipline: "testing" },
    concepts: [{ id: "c1", title: "Concept", description: "Description", bloom_level_target: "understand" }],
    scenes: [
      { id: "intro", type: "intro", title: "Introduction", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "Read this." },
      { id: "concept", type: "concept", title: "Concept", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "Continue." },
    ],
    rules: [],
    validated_by: "teacher",
    validated_at: "2026-10-29T00:00:00Z",
  }));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SessionWorkspace learner locale", () => {
  it("writes English task and feedback chrome for an English bundle", async () => {
    const root = englishBundleRoot();
    const host = new SessionHost({ bundlesRoot: root, live: false });
    const { sessionId, presentation } = await host.create("lesson.json", "learner");
    const channel = mkdtempSync(join(tmpdir(), "studium-locale-channel-"));
    roots.push(channel);
    const workspace = new SessionWorkspace(host, channel);

    expect((presentation as unknown as { locale?: string }).locale).toBe("en");
    await workspace.writeStep(sessionId);
    expect(readFileSync(join(channel, "task.md"), "utf8")).toContain("Respond");
    writeFileSync(join(channel, "response.json"), JSON.stringify({ kind: "ack" }));
    await workspace.ingest(sessionId);

    const feedback = readFileSync(join(channel, "feedback.md"), "utf8");
    expect(feedback).toContain("Answer recorded");
    expect(feedback).toContain("next step");
    expect(feedback).not.toMatch(/[\u00c0-\u024f]/u);
    expect(feedback).not.toMatch(/\b(?:réponse|revoir|remédiation|prérequis|maîtrise)\b/iu);
  });
});
