// packages/lesson-session-host/src/key-class.test.ts
//
// The key-class table of spec 2026-10-30 « apprenant autonome » (Contrat commun): for each scene
// type, who holds the key that grades it. The table is enumerated against the schema's own
// discriminator, so a scene type added to SceneSchema without a class fails here.
import { describe, it, expect } from "vitest";
import { SceneSchema } from "@studium/lesson-bundle-schema";
import { SCENE_KEY_CLASS, keyClassOf } from "./key-class.js";

const SPEC_TABLE: Record<string, readonly string[]> = {
  ungraded: ["intro", "concept", "meta_checkpoint"],
  author_keyed: ["quiz", "spot_the_flaw"],
  production: [
    "explain_back", "comparison", "summary_audit", "prompt_practice", "communication_sim", "discussion", "ai_critique",
  ],
  externally_grounded: ["reproduction"],
};
const SPEC_ROWS = Object.entries(SPEC_TABLE).flatMap(([keyClass, types]) => types.map((type) => [type, keyClass]));

describe("SCENE_KEY_CLASS", () => {
  it("classifies exactly the 13 discriminator values of SceneSchema", () => {
    const schemaTypes = [...SceneSchema.optionsMap.keys()].map(String).sort();
    expect(schemaTypes).toHaveLength(13);
    expect(Object.keys(SCENE_KEY_CLASS).sort()).toEqual(schemaTypes);
  });

  it("matches the spec table row for row", () => {
    expect(SPEC_ROWS).toHaveLength(13);
    expect(Object.fromEntries(SPEC_ROWS)).toEqual(SCENE_KEY_CLASS);
  });

  it.each(SPEC_ROWS)("keyClassOf(%s) is %s", (type, keyClass) => {
    expect(keyClassOf(type!)).toBe(keyClass);
  });

  it("returns null for a name that is not a scene type (a signal kind, an unknown type)", () => {
    expect(keyClassOf("confidence_declared")).toBeNull();
    expect(keyClassOf("hologram")).toBeNull();
    expect(keyClassOf("toString")).toBeNull();
  });
});
