import { z } from "zod";
// ModulatorSchema is the single-source registry's active set {M1,M3,M6} (./modulators.ts). The package
// barrel re-exports it (and the full registry) via `export * from "./modulators"`.
import { ModulatorSchema } from "./modulators.js";

export const RuleConditionSchema = z.record(z.string(), z.string());

export const RuleActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("advance_to_next_scene") }),
  z.object({ kind: z.literal("replay_current_scene"), reason: z.string() }),
  z.object({ kind: z.literal("skip_to_next_concept") }),
  z.object({ kind: z.literal("show_calibration_panel") }),
  z.object({ kind: z.literal("show_explanation_panel") }),
]);

export const AdaptationRuleSchema = z.object({
  id: z.string(),
  when: RuleConditionSchema,
  action: RuleActionSchema,
  modulator: ModulatorSchema,
  explanation_short: z.string(),
});

export type AdaptationRule = z.infer<typeof AdaptationRuleSchema>;
