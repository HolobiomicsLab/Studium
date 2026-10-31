// modulators.guard.test.ts — the single guard that keeps the M-series modulator vocabulary from drifting
// apart again. modulators.ts is the source of truth; three other copies are kept literal (to avoid a
// cross-package / cross-language dependency) and PINNED here: if any copy diverges from the registry's
// active set, this test fails. Also asserts the registry is internally consistent and that the generated
// doc lists every modulator. (Reading sibling source as text is deliberate — it catches a hand-edit to a
// mirror that a type check would not.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { MODULATORS, ACTIVE_MODULATOR_IDS, ACTIVE_MODULATORS, ModulatorSchema } from "./modulators.js";

const here = dirname(fileURLToPath(import.meta.url)); // packages/lesson-bundle-schema/src
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");
const mods = (s: string | undefined) => (s ? Array.from(new Set(s.match(/M\d/g) ?? [])).sort() : []);
const ACTIVE = [...ACTIVE_MODULATORS].sort();

describe("modulator registry — internal consistency", () => {
  it("the active-id tuple equals the registry's active filter and the zod enum options", () => {
    const fromRegistry = MODULATORS.filter((m) => m.status === "active").map((m) => m.id);
    expect(fromRegistry).toEqual([...ACTIVE_MODULATOR_IDS]);
    expect([...ModulatorSchema.options].sort()).toEqual(ACTIVE);
  });
  it("only M1, M3, M6 are active (the set that actually fires); M2/M4/M5 are retired", () => {
    expect(ACTIVE).toEqual(["M1", "M3", "M6"]);
    for (const id of ["M2", "M4", "M5"]) {
      const m = MODULATORS.find((x) => x.id === id);
      expect(m?.status, `${id} must be retired`).toBe("retired");
    }
  });
  it("M7 and M8 are NOT in the registry (never defined as modulators — a milestone namespace)", () => {
    expect(MODULATORS.find((m) => m.id === "M7" || m.id === "M8")).toBeUndefined();
  });
  it("every registry entry has a non-empty name + definition", () => {
    for (const m of MODULATORS) {
      expect(m.name.length, m.id).toBeGreaterThan(0);
      expect(m.definition.length, m.id).toBeGreaterThan(0);
    }
  });
});

describe("modulator mirrors — pinned to the registry active set (no drift)", () => {
  it("learner-state Decision.modulator enum matches the active set", () => {
    const src = read("../../learner-state/src/index.ts");
    const line = src.split("\n").find((l) => l.includes("modulator:") && l.includes("z.enum("));
    expect(mods(line)).toEqual(ACTIVE);
  });
  it("the Python bundle-schema mirror matches the active set", () => {
    const src = read("../python/lesson_bundle_schema/__init__.py");
    const line = src.split("\n").find((l) => l.startsWith("Modulator = Literal["));
    expect(mods(line)).toEqual(ACTIVE);
  });
  it("the scene-synth Python mirror matches the active set", () => {
    const src = read("../../../services/scene-synth/scene_synth_schemas.py");
    const line = src.split("\n").find((l) => l.startsWith("Modulator = Literal["));
    expect(mods(line)).toEqual(ACTIVE);
  });
});

describe("modulator doc — lists every registry entry", () => {
  it("docs/concepts/modulators.md mentions each id and its status", () => {
    const doc = read("../../../docs/concepts/modulators.md");
    for (const m of MODULATORS) {
      expect(doc, `doc must mention ${m.id}`).toContain(m.id);
      expect(doc, `doc must state ${m.id} status`).toMatch(new RegExp(`${m.id}[^\\n]*${m.status}`, "i"));
    }
  });
});
