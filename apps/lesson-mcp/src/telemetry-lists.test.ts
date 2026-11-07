// The interaction contract copies lists the server owns (INT-STUDIUM-058 § 2.10): the panel's actions,
// the prompt kinds and outcomes, the help rungs, the contest claims and outcomes, the resume causes.
// This test ties each copied list to its source, so that a label added on one side and not the other
// fails here rather than producing an event the contract refuses (or silently missing one).
//
// Where the server has a runtime list, the two are compared at runtime, order-insensitively. Where it
// has only a type, the comparison is type-level: an `Equal` assertion that fails `pnpm build` on drift,
// in both directions. The resume causes are string literals at their two emit sites (host.ts), so the
// second direction reads them from that source; the contract's `paused` is emitted by nothing and is
// named here as the one allowlisted extra.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { z } from "zod";
import {
  InteractionSchema, PromptShownSchema, PromptOutcomeSchema, HelpUsedSchema, ContestEventSchema, ResumeSchema,
} from "../../../packages/telemetry-events/src/events.js";
import { PanelActionSchema, HelpSchema } from "../../../packages/lesson-panel/src/view.js";
import { NOTICE_KINDS, PROMPT_KINDS, type InteractionAct, type ContestClaim, type ContestOutcome } from "@studium/lesson-session-host";

/** Type equality that fails the type check (and `pnpm build`) when either side drifts. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertEqual = <A, B>(_ok: Equal<A, B>): void => {};

/** A record covering exactly `T`, built from a list: a missing or extra key fails the assignment. */
function keyed<T extends string>(values: readonly T[]): Record<T, true> {
  return Object.fromEntries(values.map((value) => [value, true])) as Record<T, true>;
}

const sameSet = (a: readonly string[], b: readonly string[]) => [...a].sort().join(",") === [...b].sort().join(",");

describe("the interaction contract's lists mirror the server's", () => {
  it("the panel's actions", () => {
    const panel = PanelActionSchema.options.map((option) => option.shape.type.value);
    const contract = InteractionSchema.shape.act.options;
    expect(sameSet(panel, contract)).toBe(true);
    // Both directions at the type level: InteractionAct is exactly the contract's act union.
    const _fromServer: Record<InteractionAct, true> = keyed(contract);
    const _fromContract: Record<z.infer<typeof InteractionSchema>["act"], true> = keyed(panel as InteractionAct[]);
    expect(Object.keys(_fromServer)).toHaveLength(contract.length);
    expect(Object.keys(_fromContract)).toHaveLength(panel.length);
    assertEqual<InteractionAct, z.infer<typeof InteractionSchema>["act"]>(true);
  });

  it("the prompt kinds, shown and answered", () => {
    expect(sameSet([...PROMPT_KINDS], PromptShownSchema.shape.kind.options)).toBe(true);
    const proposals = PROMPT_KINDS.filter((kind) => !NOTICE_KINDS.has(kind));
    expect(sameSet(proposals, PromptOutcomeSchema.shape.kind.options)).toBe(true);
  });

  it("the help rungs", () => {
    const view = HelpSchema.shape.rungs.element.shape.kind.options;
    expect(sameSet([...view], HelpUsedSchema.shape.rung.options)).toBe(true);
  });

  it("the contest claims and outcomes", () => {
    expect(sameSet(["known", "unsure"], ContestEventSchema.shape.claim.options)).toBe(true);
    expect(sameSet(["confirmed", "refuted", "partial"], ContestEventSchema.shape.outcome.options)).toBe(true);
    assertEqual<ContestClaim, z.infer<typeof ContestEventSchema>["claim"]>(true);
    assertEqual<ContestOutcome, z.infer<typeof ContestEventSchema>["outcome"]>(true);
  });

  it("the resume causes, against the literals the host emits", () => {
    assertEqual<z.infer<typeof ResumeSchema>["cause"], "restart" | "surface_change" | "paused">(true);
    const source = readFileSync(resolve("../../packages/lesson-session-host/src/host.ts"), "utf8");
    const emitted = [...source.matchAll(/\{ type: "resume", cause: "([a-z_]+)" \}/g)].map((match) => match[1]!);
    // Every cause the host emits is in the contract, and the contract carries no other live cause.
    const contract = ResumeSchema.shape.cause.options;
    for (const cause of emitted) expect(contract).toContain(cause);
    // `paused` is the contract's one cause nothing emits (a break is a notice): named here, not dropped.
    expect(sameSet([...emitted, "paused"], contract)).toBe(true);
  });
});
