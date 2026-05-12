export type MatchResult = {
  planted_errors: number;
  true_positives: number;
  false_positives: number;
  missed: number;
};

type ClaimLike = { id: string; flaws_expected: string[] };

function normalize(text: string): string {
  return text.toLowerCase().replace(/[_-]/g, " ");
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function flawMatches(flaw: string, normalizedCritique: string): boolean {
  const needle = normalize(flaw).trim();
  if (needle.length === 0) return false;
  // First try direct substring (handles "small_sample" → "small sample size").
  if (normalizedCritique.includes(needle)) return true;
  // Fallback : all tokens of the flaw appear somewhere in the critique
  // (handles "small_sample" → "sample is too small", reordered tokens).
  const flawTokens = tokens(flaw);
  if (flawTokens.length === 0) return false;
  return flawTokens.every((t) => normalizedCritique.includes(t));
}

export function matchClaimsAgainstCritique(
  claims: ClaimLike[],
  critique: string,
): MatchResult {
  const normalizedCritique = normalize(critique);
  const allFlaws = claims.flatMap((c) => c.flaws_expected);
  const planted_errors = allFlaws.length;

  let true_positives = 0;
  for (const flaw of allFlaws) {
    if (flawMatches(flaw, normalizedCritique)) {
      true_positives += 1;
    }
  }
  const missed = planted_errors - true_positives;
  // false_positives v1 = 0 ; v2 would require enumerating known-not-planted
  // keywords (out of scope for heuristic v1, defer to ADR if needed).
  const false_positives = 0;
  return { planted_errors, true_positives, false_positives, missed };
}
