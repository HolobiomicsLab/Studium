// The interaction events of INT-STUDIUM-058 § 2.10: what the consented stream may say about how a
// lesson was used (acts, prompts, help, contests, resumes, review receipts). They carry closed
// labels, counts, delays and references, never a text. The examples are shared with the Python
// reader's test (tests/test_interaction_events_python.py): one file, both sides.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ContestEventSchema, HelpUsedSchema, InteractionSchema, PromptOutcomeSchema, PromptShownSchema, ResumeSchema,
  ReviewReceiptEventSchema, TelemetryEventSchema,
} from "./events.js";

const cases = JSON.parse(readFileSync(new URL("../tests/interaction-events.json", import.meta.url), "utf8")) as {
  base: Record<string, unknown>;
  valid: Record<string, unknown>[];
  invalid: { why: string; event: Record<string, unknown> }[];
};
const NEW_TYPES = ["interaction", "prompt_shown", "prompt_outcome", "help_used", "contest", "resume", "review_receipt"];

describe("interaction events", () => {
  it("accepts one event of each type, and the examples cover the seven types", () => {
    for (const event of cases.valid) {
      const parsed = TelemetryEventSchema.safeParse({ ...cases.base, ...event });
      expect(parsed.success, JSON.stringify(event)).toBe(true);
    }
    expect([...new Set(cases.valid.map((event) => event["type"]))]).toEqual(NEW_TYPES);
  });

  it.each(cases.invalid.map((c) => [c.why, c.event] as const))("refuses %s", (_why, event) => {
    expect(TelemetryEventSchema.safeParse({ ...cases.base, ...event }).success).toBe(false);
  });

  it("holds no free-text field: beyond the base, a closed label, a number, or a reference named *_id", () => {
    const schemas = [InteractionSchema, PromptShownSchema, PromptOutcomeSchema, HelpUsedSchema, ContestEventSchema, ResumeSchema, ReviewReceiptEventSchema];
    const base = new Set(Object.keys(cases.base));
    const unwrap = (field: { _def: { typeName: string; innerType?: unknown } }): { _def: { typeName: string } } =>
      field._def.typeName === "ZodOptional" ? unwrap(field._def.innerType as never) : field;
    const seen: string[] = [];
    for (const schema of schemas) {
      for (const [name, field] of Object.entries(schema.shape)) {
        if (base.has(name) || name === "type") continue;
        const kind = unwrap(field as never)._def.typeName;
        seen.push(`${name}:${kind}`);
        if (kind === "ZodString") expect(name, "a string field must be a reference").toMatch(/_id$/);
        else expect(["ZodEnum", "ZodNumber"], `${name} is ${kind}`).toContain(kind);
      }
    }
    expect(seen.length).toBeGreaterThan(15);
  });
});
