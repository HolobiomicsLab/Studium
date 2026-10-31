import { makeLLMClient, type LLMClientOptions } from "@studium/llm-client";
import type { SocraticTutor } from "../ports.js";
import type { TutorInput, TutorMove } from "../socratic-tutor/types.js";
import { moveKindForSignal, fadedFallback } from "../socratic-tutor/contingency.js";
import { buildTutorPrompt, parseTutorMove } from "../socratic-tutor/prompt.js";
import { phrase } from "../phrases.js";

const RUNTIME_ALIAS = "studium/runtime-tutor" as const;

/** Deterministic, LLM-free tutor: returns the contingency-table move for the signal
 * (scaffold_hint under low confidence), using the canned faded text in the lesson's language
 * (French when the input names none). Never reveals. Used by all default tests and as the offline
 * driver. */
export class StubSocraticTutor implements SocraticTutor {
  async respond(input: TutorInput): Promise<TutorMove | null> {
    const locale = input.locale ?? "fr";
    const kind = moveKindForSignal(input.signal, input.confidence);
    if (kind === "scaffold_hint") {
      return { move_kind: "scaffold_hint", revealed: false, text: phrase("tutor_scaffold_hint", {}, locale) };
    }
    return { move_kind: kind, revealed: false, text: fadedFallback(locale)[input.signal].text };
  }
}

export class LiteLLMSocraticTutor implements SocraticTutor {
  private readonly llm: { complete: (prompt: string) => Promise<string> };
  constructor(opts: LLMClientOptions, private readonly timeoutMs = 2000) {
    const client = makeLLMClient(opts);
    this.llm = { complete: (prompt: string) => client.complete(prompt, RUNTIME_ALIAS) };
  }
  async respond(input: TutorInput): Promise<TutorMove | null> {
    try {
      const raw = await Promise.race([
        this.llm.complete(buildTutorPrompt(input)),
        new Promise<null>((r) => setTimeout(() => r(null), this.timeoutMs)),
      ]);
      return raw === null ? null : parseTutorMove(raw as string);
    } catch { return null; } // graceful degradation
  }
}
