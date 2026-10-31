/**
 * Colour-blind-safe chart series. Colour is always paired with a dash pattern,
 * label, value, or geometry; no chart depends on a red/green distinction.
 */
export type ChartSeriesStyle = {
  stroke: string;
  dash?: string;
};

export const CHART_SERIES: readonly ChartSeriesStyle[] = [
  { stroke: "var(--st-accent)" },
  { stroke: "var(--st-accent-2)", dash: "9 4" },
  { stroke: "var(--st-text)", dash: "2 4" },
  { stroke: "var(--st-muted)", dash: "12 4 2 4" },
  { stroke: "var(--st-info)", dash: "1 5" },
];

export function chartSeriesStyle(index: number): ChartSeriesStyle {
  return CHART_SERIES[index % CHART_SERIES.length]!;
}

export const REASONING_SIGNAL_COLORS: Readonly<Record<string, string>> = {
  justification: "var(--st-accent)",
  hypothesis: "var(--st-accent-2)",
  counterexample: "var(--st-text)",
  synthesis: "var(--st-muted)",
  question: "var(--st-info)",
};

export const CHART_FALLBACK_COLOR = "var(--st-border-strong)";
