import { z } from "zod";

export const BlueprintEndpointEnum = z.enum([
  "progress", "calibration", "autonomy", "ai_literacy", "reasoning", "ai_audit",
]);

export const BlueprintMetricRefSchema = z.object({
  endpoint: BlueprintEndpointEnum,
  field: z.string().min(1),
  weight_in_dimension: z.number().min(0).max(1),
});

export const BlueprintDimensionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().min(0).max(1),
  metrics: z.array(BlueprintMetricRefSchema).min(1),
}).superRefine((dim, ctx) => {
  const sum = dim.metrics.reduce((acc, m) => acc + m.weight_in_dimension, 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `metrics weight_in_dimension must sum to 1.0 (got ${sum.toFixed(3)})`,
    });
  }
});

export const AssessmentBlueprintSchema = z.object({
  dimensions: z.array(BlueprintDimensionSchema).min(1),
}).superRefine((bp, ctx) => {
  const sum = bp.dimensions.reduce((acc, d) => acc + d.weight, 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `dimensions weight must sum to 1.0 (got ${sum.toFixed(3)})`,
    });
  }
});

export type AssessmentBlueprint = z.infer<typeof AssessmentBlueprintSchema>;
