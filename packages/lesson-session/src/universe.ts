import { DEFAULT_THETA } from "@studium/adaptation-engine";
import type { Universes, UniverseVariant } from "@studium/lesson-bundle-schema";

/** Prerequisite threshold for a `lenient` universe (vs DEFAULT_THETA=0.8 for standard). */
export const LENIENT_THETA = 0.6;

/** Prerequisite-gating threshold for a universe variant, from its prereq_strictness option.
 * standard -> 0.8 (DEFAULT_THETA); lenient -> 0.6 (earlier unlock). Unknown/absent -> default. */
export function thetaForVariant(variant: UniverseVariant | null | undefined): number {
  const strictness = variant?.decisions?.["prereq_strictness"];
  if (strictness === "lenient") return LENIENT_THETA;
  return DEFAULT_THETA; // "standard" or absent
}

/** Find the active variant by id, or null. */
export function resolveActiveVariant(
  universes: Universes | null | undefined,
  activeId: string,
): UniverseVariant | null {
  if (!universes) return null;
  return universes.variants.find((v) => v.id === activeId) ?? null;
}
