export type ReasoningSignal =
  | "justification" | "hypothesis" | "question" | "counterexample" | "synthesis";

export type ClassifyResult = { signal: ReasoningSignal; confidence: number };
export type LLMClient = { complete: (prompt: string) => Promise<string> };

const VALID_SIGNALS: ReasoningSignal[] = [
  "justification", "hypothesis", "question", "counterexample", "synthesis",
];

/** The lesson's language (RT-9): the prompt is written in it, so the turn is read in it. */
export type ScorerLocale = "fr" | "en";

const PROMPT_TEMPLATES: Record<ScorerLocale, string> = {
  fr: `Tu es un classificateur de signaux de raisonnement dialogique.

Sujet : {topic}
Tour étudiant : {turn}

Classifie ce tour parmi exactement UN signal :
- justification : argument qui explique pourquoi quelque chose est vrai
- hypothesis : proposition d'explication possible à vérifier
- question : interrogation ouverte qui demande clarification
- counterexample : exemple qui contredit une affirmation
- synthesis : regroupement de plusieurs idées en une conclusion

Le tour de l'étudiant est en français.
Réponds en JSON strict : {"signal": "<un des 5>", "confidence": <0..1>}.`,
  en: `You classify dialogic reasoning signals.

Topic: {topic}
Learner's turn: {turn}

Classify this turn as exactly ONE signal:
- justification: an argument explaining why something is true
- hypothesis: a possible explanation still to be checked
- question: an open question asking for clarification
- counterexample: an example that contradicts a claim
- synthesis: several ideas brought together into one conclusion

The learner's turn is in English.
Reply in strict JSON: {"signal": "<one of the 5>", "confidence": <0..1>}.`,
};

export async function classifyTurn(
  llm: LLMClient,
  turn: string,
  topic: string,
  options: { timeoutMs?: number; locale?: ScorerLocale } = {},
): Promise<ClassifyResult | null> {
  const timeoutMs = options.timeoutMs ?? 2000;
  // Replacement FUNCTIONS, so a `$&` or `$'` typed by the learner is inserted literally.
  const prompt = PROMPT_TEMPLATES[options.locale ?? "fr"].replace("{topic}", () => topic).replace("{turn}", () => turn);
  const llmPromise = llm.complete(prompt);
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timerId = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const raw = await Promise.race([llmPromise, timeout]);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw as string);
      if (
        typeof parsed.signal !== "string" ||
        !VALID_SIGNALS.includes(parsed.signal as ReasoningSignal) ||
        typeof parsed.confidence !== "number" ||
        parsed.confidence < 0 || parsed.confidence > 1
      ) {
        return null;
      }
      return { signal: parsed.signal, confidence: parsed.confidence };
    } catch {
      return null;
    }
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
}
