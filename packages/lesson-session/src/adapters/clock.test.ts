import { describe, it, expect } from "vitest";
import { SystemClock, RandomIdGen } from "./clock.js";
import { HmacPseudonymProvider } from "./pseudonym.js";

describe("node adapters — clock/id/pseudonym", () => {
  it("SystemClock returns a valid ISO timestamp", () => {
    expect(() => new Date(new SystemClock().now()).toISOString()).not.toThrow();
  });
  it("RandomIdGen returns distinct uuids", () => {
    const g = new RandomIdGen();
    expect(g.uuid()).not.toBe(g.uuid());
  });
  it("HmacPseudonymProvider is deterministic per lesson + secret", async () => {
    const p = new HmacPseudonymProvider("secret");
    const a = await p.get("L1");
    const b = await p.get("L1");
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(await new HmacPseudonymProvider("other").get("L1")).not.toBe(a);
  });
});
