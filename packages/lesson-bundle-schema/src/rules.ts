import { z } from "zod";

export const RuleConditionSchema = z.record(z.string(), z.string());

export const RuleActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("advance_to_next_scene") }),
  z.object({ kind: z.literal("replay_current_scene"), reason: z.string() }),
  z.object({ kind: z.literal("skip_to_next_concept") }),
  z.object({ kind: z.literal("show_calibration_panel") }),
  z.object({ kind: z.literal("show_explanation_panel") }),
]);

export const ModulatorSchema = z.enum(["M1", "M2", "M3", "M6"]);

export const AdaptationRuleSchema = z.object({
  id: z.string(),
  when: RuleConditionSchema,
  action: RuleActionSchema,
  modulator: ModulatorSchema,
  explanation_short: z.string(),
});

export type AdaptationRule = z.infer<typeof AdaptationRuleSchema>;
