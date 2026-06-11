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
  it("HmacPseudonymProvider is deterministic per learner + lesson + secret", async () => {
    const p = new HmacPseudonymProvider("secret");
    const a = await p.get("learner-1", "L1");
    const b = await p.get("learner-1", "L1");
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(await new HmacPseudonymProvider("other").get("learner-1", "L1")).not.toBe(a);
  });
  it("HmacPseudonymProvider salts on learnerId: distinct learners on the SAME lesson get DISTINCT pseudonyms", async () => {
    const p = new HmacPseudonymProvider("secret");
    const alice = await p.get("alice", "L1");
    const bob = await p.get("bob", "L1");
    expect(alice).not.toBe(bob);
    // and the same learner on a different lesson differs too (salt is learnerId:lessonId)
    expect(await p.get("alice", "L2")).not.toBe(alice);
  });
});
