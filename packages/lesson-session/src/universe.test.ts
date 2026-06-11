import { describe, it, expect } from "vitest";
import { thetaForVariant, resolveActiveVariant } from "./universe";
import { DEFAULT_THETA } from "@studium/adaptation-engine";

const universes = {
  variants: [
    { id: "baseline", description: "d", decisions: { prereq_strictness: "standard" } },
    { id: "remedial", description: "d", decisions: { prereq_strictness: "lenient" } },
  ],
  active: "baseline",
};

describe("universe helpers", () => {
  it("resolveActiveVariant returns the active variant", () => {
    expect(resolveActiveVariant(universes, "baseline")?.id).toBe("baseline");
    expect(resolveActiveVariant(universes, "remedial")?.id).toBe("remedial");
    expect(resolveActiveVariant(universes, "nope")).toBeNull();
    expect(resolveActiveVariant(undefined, "baseline")).toBeNull();
  });
  it("thetaForVariant maps prereq_strictness to theta", () => {
    expect(thetaForVariant(universes.variants[0])).toBe(0.8);   // standard
    expect(thetaForVariant(universes.variants[1])).toBe(0.6);   // lenient
    expect(thetaForVariant(null)).toBe(DEFAULT_THETA);          // no variant -> default
    expect(thetaForVariant({ id: "x", description: "", decisions: {} })).toBe(DEFAULT_THETA);
  });
});
