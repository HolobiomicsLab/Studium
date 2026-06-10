// packages/lesson-session-host/src/registry.test.ts
import { describe, it, expect } from "vitest";
import { buildHostDeps } from "./deps.js";
import { SessionRegistry } from "./registry.js";
import { InMemoryStateStore } from "@studium/lesson-session/node";

describe("buildHostDeps + registry", () => {
  it("buildHostDeps(false) wires in-memory + stub adapters", () => {
    const d = buildHostDeps(false);
    expect(d.stateStore).toBeInstanceOf(InMemoryStateStore);
    expect(typeof d.clock.now()).toBe("string");
    expect(typeof d.idGen.uuid()).toBe("string");
  });
  it("registry create/get/has/delete", () => {
    const r = new SessionRegistry();
    const entry = { session: {} as never, deps: {} as never, bundle: {} as never };
    r.create("id1", entry);
    expect(r.has("id1")).toBe(true);
    expect(r.get("id1")).toBe(entry);
    expect(r.delete("id1")).toBe(true);
    expect(r.get("id1")).toBeUndefined();
  });
});
