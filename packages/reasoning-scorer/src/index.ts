export type ReasoningSignal =
  | "justification" | "hypothesis" | "question" | "counterexample" | "synthesis";

export type ClassifyResult = { signal: ReasoningSignal; confidence: number };
export type LLMClient = { complete: (prompt: string) => Promise<string> };

const VALID_SIGNALS: ReasoningSignal[] = [
  "justification", "hypothesis", "question", "counterexample", "synthesis",
];

const PROMPT_TEMPLATE = `Tu es un classificateur de signaux de raisonnement dialogique.

Sujet : {topic}
Tour étudiant : {turn}

Classifie ce tour parmi exactement UN signal :
- justification : argument qui explique pourquoi quelque chose est vrai
- hypothesis : proposition d'explication possible à vérifier
- question : interrogation ouverte qui demande clarification
- counterexample : exemple qui contredit une affirmation
- synthesis : regroupement de plusieurs idées en une conclusion

Réponds en JSON strict : {"signal": "<un des 5>", "confidence": <0..1>}.`;

export async function classifyTurn(
  llm: LLMClient,
  turn: string,
  topic: string,
  options: { timeoutMs?: number } = {},
): Promise<ClassifyResult | null> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const prompt = PROMPT_TEMPLATE.replace("{topic}", topic).replace("{turn}", turn);
  const llmPromise = llm.complete(prompt);
  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs));
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
}
