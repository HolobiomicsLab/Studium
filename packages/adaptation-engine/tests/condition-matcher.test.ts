import { describe, it, expect } from "vitest";
import { matchesCondition } from "../src/condition-matcher";

describe("matchesCondition", () => {
  it("operator >= matches", () => {
    expect(matchesCondition({ x: ">=2" }, { x: 3 })).toBe(true);
    expect(matchesCondition({ x: ">=2" }, { x: 1 })).toBe(false);
  });

  it("operator <= matches", () => {
    expect(matchesCondition({ x: "<=2" }, { x: 1 })).toBe(true);
  });

  it("operator == matches", () => {
    expect(matchesCondition({ x: "==true" }, { x: true })).toBe(true);
    expect(matchesCondition({ x: "==false" }, { x: false })).toBe(true);
  });

  it("operator != matches", () => {
    expect(matchesCondition({ x: "!=foo" }, { x: "bar" })).toBe(true);
  });

  it("multiple keys all must match", () => {
    expect(matchesCondition({ x: ">=2", y: "==true" }, { x: 3, y: true })).toBe(true);
    expect(matchesCondition({ x: ">=2", y: "==true" }, { x: 3, y: false })).toBe(false);
  });

  it("unknown key → no match (false)", () => {
    expect(matchesCondition({ z: ">=2" }, { x: 3 })).toBe(false);
  });
});
