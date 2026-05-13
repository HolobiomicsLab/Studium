import { useState } from "react";
import type { Scene } from "@studium/lesson-bundle-schema";
import type { Signal } from "@studium/learner-state";
import { classifyTurn } from "@studium/reasoning-scorer";
import { useReasoningScorer } from "../../hooks/useReasoningScorer";
import type { TelemetryEmit } from "../../hooks/useTelemetry";

type Props = {
  scene: Extract<Scene, { type: "discussion" }>;
  emit?: TelemetryEmit;
  onSignal: (s: Signal) => Promise<unknown>;
  onContinue: () => void;
};

// Canned LLM v1 — replace with real @studium/llm-client wiring later.
const llmClient = {
  complete: async (_prompt: string) =>
    JSON.stringify({ signal: "justification", confidence: 0.5 }),
};

const scorer = (turn: string, topic: string) =>
  classifyTurn(llmClient, turn, topic, { timeoutMs: 2000 });

export default function DiscussionScene({ scene, emit, onSignal: _onSignal, onContinue }: Props) {
  const safeEmit = emit ?? (() => undefined);
  const { scoreTurn } = useReasoningScorer({
    emit: safeEmit,
    scorer,
    topic: scene.topic,
    sceneId: scene.id,
  });
  const [turns, setTurns] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const send = async () => {
    if (!draft.trim() || turns.length >= scene.max_turns) return;
    const turnIndex = turns.length;
    setTurns([...turns, draft]);
    setDraft("");
    void scoreTurn(draft, turnIndex);
  };

  return (
    <section className="max-w-2xl mx-auto bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-2">{scene.title}</h2>
      <p className="text-sm text-gray-700 mb-2">Topic : {scene.topic}</p>
      <blockquote className="border-l-4 border-blue-300 pl-3 italic mb-4">
        {scene.seed_claim}
      </blockquote>
      <ul className="space-y-2 mb-4">
        {turns.map((t, i) => (
          <li key={i} className="p-2 bg-gray-50 rounded text-sm">
            <span className="font-mono text-xs text-gray-500">#{i + 1}</span> {t}
          </li>
        ))}
      </ul>
      <textarea
        className="w-full border rounded p-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={turns.length >= scene.max_turns}
        placeholder="Ton tour de discussion…"
      />
      <div className="flex justify-between mt-2">
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          disabled={!draft.trim() || turns.length >= scene.max_turns}
          onClick={send}
        >
          Envoyer
        </button>
        <button
          className="px-4 py-2 bg-gray-200 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          onClick={onContinue}
        >
          Continuer
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2">{turns.length}/{scene.max_turns} tours</p>
    </section>
  );
}
