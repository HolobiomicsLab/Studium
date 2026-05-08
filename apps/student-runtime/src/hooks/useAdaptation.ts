import { useCallback, useRef, useState } from "react";
import { AdaptationEngine } from "@studium/adaptation-engine";
import { defaultLearnerState, type LearnerState, type Signal, type Decision } from "@studium/learner-state";
import type { AdaptationRule } from "@studium/lesson-bundle-schema";
import { tauri } from "../lib/tauri";

export function useAdaptation(rules: AdaptationRule[], lessonId: string, initialState?: LearnerState) {
  const [state, setState] = useState<LearnerState>(initialState ?? defaultLearnerState(lessonId));
  const [decision, setDecision] = useState<Decision | null>(null);
  const engineRef = useRef(new AdaptationEngine(rules, state));
  const sessionId = useRef(crypto.randomUUID()).current;
  const pseudoRef = useRef<string | null>(null);

  const onSignal = useCallback(async (signal: Signal): Promise<Decision> => {
    const d = engineRef.current.onSignal(signal);
    const newState = engineRef.current.getState();
    setDecision(d);
    setState(newState);
    void tauri.saveState(lessonId, newState);
    if (!pseudoRef.current) pseudoRef.current = await tauri.getPseudonyme(lessonId);
    void tauri.appendEvent({
      event_id: crypto.randomUUID(),
      session_id: sessionId,
      pseudonyme: pseudoRef.current ?? "",
      lesson_id: lessonId,
      schema_version: "1.0",
      timestamp: new Date().toISOString(),
      event_type: signalToEventType(signal),
      payload: signalToPayload(signal, d),
    });
    return d;
  }, [lessonId, sessionId]);

  return { state, decision, onSignal, lastExplanation: engineRef.current.explain() };
}

function signalToEventType(s: Signal): string {
  switch (s.kind) {
    case "answer_submitted":    return "answer_submitted";
    case "confidence_declared": return "confidence_declared";
    case "scene_entered":       return "scene_entered";
    case "scene_completed":     return "scene_completed";
  }
}

function signalToPayload(s: Signal, d: Decision): object {
  return { ...s, decision: { rule_id: d.rule_id, modulator: d.modulator, action: d.next_action } };
}
