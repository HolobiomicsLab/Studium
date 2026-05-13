import { useCallback, useRef } from "react";
import type { ClassifyResult } from "@studium/reasoning-scorer";

type EmitFn = (event: {
  type: "reasoning_signal";
  scene_id: string;
  signal: ClassifyResult["signal"];
  confidence: number;
  turn_index: number;
}) => void;

type Scorer = (turn: string, topic: string) => Promise<ClassifyResult | null>;

type Options = {
  emit: EmitFn;
  scorer: Scorer;
  topic: string;
  sceneId: string;
  rateLimitMs?: number;
};

export function useReasoningScorer(opts: Options) {
  const lastCallRef = useRef<number>(0);
  const rateLimitMs = opts.rateLimitMs ?? 1000;
  const scoreTurn = useCallback(async (turn: string, turnIndex: number) => {
    const now = Date.now();
    if (now - lastCallRef.current < rateLimitMs) return;
    lastCallRef.current = now;
    const result = await opts.scorer(turn, opts.topic);
    if (result === null) return;
    opts.emit({
      type: "reasoning_signal", scene_id: opts.sceneId,
      signal: result.signal, confidence: result.confidence, turn_index: turnIndex,
    });
  }, [opts.emit, opts.scorer, opts.topic, opts.sceneId, rateLimitMs]);
  return { scoreTurn };
}
