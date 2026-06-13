// reveal.ts — TS mirror of grounding_relevance/relevance.py (tokenize/jaccard).
import type { LessonBundle, Scene } from "@studium/lesson-bundle-schema";

const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
  "her", "was", "one", "our", "out", "had", "has", "have", "with",
  "this", "that", "from", "they", "will", "would", "there", "their", "what",
  "which", "when", "were", "been", "being", "into", "than", "then", "them",
  "these", "those", "some", "such", "only", "other", "more", "most", "also",
  "your", "about", "over", "between", "both", "each", "after", "before",
  "because", "while", "where", "how", "why", "who", "whom", "its",
  "should", "could", "may", "might", "must", "shall", "does", "did", "doing",
  "his", "she", "him", "use", "using", "used", "via", "per", "etc",
  // FR function words (the runtime is French; the Python side adds these too in EV-3b)
  "les", "des", "une", "que", "qui", "pour", "dans", "est", " est", "avec", "pas",
]);

const TOKEN_SPLIT = /[^0-9a-zA-ZÀ-ſ]+/; // include Latin-1 accents for FR

export function tokenize(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text || typeof text !== "string") return out;
  for (const raw of text.toLowerCase().split(TOKEN_SPLIT)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const DEFAULT_REVEAL_JACCARD = 0.5;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True if `text` reveals any banned answer: a normalized-substring match OR token
 * Jaccard ≥ theta against any banned string. Biased toward catching reveals — a
 * false flag only swaps in a safe fallback, which never reveals. */
export function revealsAnswer(
  text: string,
  banned: string[],
  theta: number = DEFAULT_REVEAL_JACCARD,
): boolean {
  const normText = normalize(text);
  const textToks = tokenize(text);
  for (const b of banned) {
    const nb = normalize(b);
    if (nb.length >= 6 && normText.includes(nb)) return true;
    if (jaccard(textToks, tokenize(b)) >= theta) return true;
  }
  return false;
}

/** Answer strings a tutor must not reveal during a discussion scene: the discussion's
 * own seed_claim, plus the correct-choice text and feedback_correct of every quiz
 * scene sharing a concept_ref with it. */
export function collectBannedAnswers(bundle: LessonBundle, scene: Scene): string[] {
  const banned: string[] = [];
  const seed = (scene as { seed_claim?: string }).seed_claim;
  if (seed) banned.push(seed);
  const concepts = new Set(scene.concept_refs ?? []);
  for (const s of bundle.scenes) {
    if (s.id === scene.id || s.type !== "quiz") continue;
    if (!(s.concept_refs ?? []).some((c) => concepts.has(c))) continue;
    const q = s as Extract<Scene, { type: "quiz" }>;
    for (const ch of q.choices) if (ch.correct && ch.text) banned.push(ch.text);
    if (q.feedback_correct) banned.push(q.feedback_correct);
  }
  return banned;
}
