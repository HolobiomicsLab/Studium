// INT-STUDIUM-034 — the bridge returns what the Rust command actually returns.
//
// CI run 34270338027 is the first time any E2E harness got past the library, and session 1
// then died waiting for `[data-testid='lesson-player']`. The cause is one type:
// `load_bundle` is `Result<String, String>` (src-tauri/src/commands.rs) wrapping
// `read_lesson_json`, which reads `lesson.json` out of the zip as TEXT. A Rust `String`
// crosses the IPC as a JSON string, so `invoke("load_bundle")` resolves to a string — and
// `LessonPlayer` handed it straight to `LessonBundleSchema.parse`, a Zod OBJECT schema, which
// rejects it. The bundle was readable, the path was right, and the lesson was unplayable.
//
// The repository already knew this: `useTelemetry.ts:118` JSON.parses every element of
// `telemetry_outbox_drain`, which is `Vec<String>` on the same bridge. One String-returning
// command was parsed and the other was not.
//
// It survived every suite because the unit tests mock `../lib/tauri` — our own wrapper —
// with a double that resolves an already-parsed object. The double was more capable than the
// bridge, so the tests measured a contract that nothing implemented. These tests mock
// `@tauri-apps/api/core` instead, which is the boundary the runtime actually crosses.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const { tauri } = await import("./tauri");

const COMMANDS_RS = fileURLToPath(
  new URL("../../src-tauri/src/commands.rs", import.meta.url),
);

const LESSON_JSON = JSON.stringify({
  schema_version: "1.4",
  bundle_id: "demo-atomistique-001",
  metadata: { title: "Atomistique L1" },
  scenes: [],
});

beforeEach(() => {
  invokeMock.mockReset();
});

describe("loadBundle", () => {
  it("resolves an object when the command returns lesson.json as text", async () => {
    invokeMock.mockResolvedValue(LESSON_JSON);

    const raw = await tauri.loadBundle("/tmp/studium-e2e/demo-atomistique.zip");

    // Not `toEqual(...)` on the whole document: what failed in CI is that a Zod object schema
    // was handed a string, so the property under test is that a schema CAN read this.
    expect(typeof raw).toBe("object");
    expect((raw as { bundle_id: string }).bundle_id).toBe("demo-atomistique-001");
    expect(invokeMock).toHaveBeenCalledWith("load_bundle", {
      path: "/tmp/studium-e2e/demo-atomistique.zip",
    });
  });

  it("names the file when its lesson.json is not JSON", async () => {
    // A truncated or half-written zip entry otherwise surfaces as a bare `SyntaxError:
    // Unexpected token`, which says nothing about which bundle the learner clicked.
    invokeMock.mockResolvedValue("{ this is not json");

    await expect(tauri.loadBundle("/tmp/studium-e2e/broken.zip")).rejects.toThrow(
      /broken\.zip/,
    );
  });

  it("lets the command's own error through unchanged", async () => {
    // `load_bundle` already maps BundleError to a message naming the cause (missing
    // lesson.json, unreadable zip). Wrapping it again would bury it.
    invokeMock.mockRejectedValue(new Error("lesson.json manquant dans le bundle"));

    await expect(tauri.loadBundle("/tmp/studium-e2e/empty.zip")).rejects.toThrow(
      "lesson.json manquant dans le bundle",
    );
  });
});

describe("the Rust signature this parse depends on", () => {
  it("still returns a String, so the parse is still required", () => {
    // Read rather than remembered: if `load_bundle` is ever changed to return a structured
    // value, this parse becomes a double-parse and this test says so at the moment of the
    // change, instead of leaving the next reader to discover it the way CI just did.
    const source = readFileSync(COMMANDS_RS, "utf8");
    const signature = source.match(/pub fn load_bundle\([^)]*\)\s*->\s*([^{]+)\{/);

    expect(signature, "load_bundle not found in commands.rs").toBeTruthy();
    expect(signature?.[1]).toMatch(/Result<\s*String\s*,/);
  });
});
