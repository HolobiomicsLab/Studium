// packages/lesson-session/src/grading/ai-audit-matcher.ts
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
  return normalize(text).split(/\s+/).filter((t) => t.length > 0);
}
function flawMatches(flaw: string, normalizedCritique: string): boolean {
  const needle = normalize(flaw).trim();
  if (needle.length === 0) return false;
  if (normalizedCritique.includes(needle)) return true;
  const flawTokens = tokens(flaw);
  if (flawTokens.length === 0) return false;
  return flawTokens.every((t) => normalizedCritique.includes(t));
}

export function matchClaimsAgainstCritique(claims: ClaimLike[], critique: string): MatchResult {
  const normalizedCritique = normalize(critique);
  const allFlaws = claims.flatMap((c) => c.flaws_expected);
  const planted_errors = allFlaws.length;
  let true_positives = 0;
  for (const flaw of allFlaws) if (flawMatches(flaw, normalizedCritique)) true_positives += 1;
  return { planted_errors, true_positives, false_positives: 0, missed: planted_errors - true_positives };
}
