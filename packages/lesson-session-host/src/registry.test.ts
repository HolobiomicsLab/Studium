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
    const entry = {
      session: {} as never, deps: {} as never, bundle: {} as never, baseDir: "", assetCache: new Map<string, string>(),
      // The host's per-session bookkeeping (study loop): typed fields only, the registry stores the entry as is.
      bundleRef: "lesson.json", kind: "lesson" as const, authoring: {} as never, memory: {}, engineMemory: {},
      selfRated: new Set<string>(), moved: new Set<string>(), responses: 0, conceptStatesAtStart: {}, withheldSources: [],
      // L-11: when it opened (a forget after that closes it) and whether it read the learner's profile.
      openedAt: 0, profileSeen: false,
    };
    r.create("id1", entry);
    expect(r.has("id1")).toBe(true);
    expect(r.get("id1")).toBe(entry);
    expect(r.delete("id1")).toBe(true);
    expect(r.get("id1")).toBeUndefined();
  });
});
