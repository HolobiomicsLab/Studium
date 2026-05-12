import { useCallback, useRef, useState } from "react";
import { AdaptationEngine } from "@studium/adaptation-engine";
import { defaultLearnerState, type LearnerState, type Signal, type Decision } from "@studium/learner-state";
import type { AdaptationRule } from "@studium/lesson-bundle-schema";
import { tauri } from "../lib/tauri";
import type { TelemetryEmit } from "./useTelemetry";

export function useAdaptation(
  rules: AdaptationRule[],
  lessonId: string,
  initialState?: LearnerState,
  onTelemetryEmit?: TelemetryEmit,
) {
  const [state, setState] = useState<LearnerState>(initialState ?? defaultLearnerState(lessonId));
  const [decision, setDecision] = useState<Decision | null>(null);
  const engineRef = useRef(new AdaptationEngine(rules, state));
  const sessionId = useRef(crypto.randomUUID()).current;
  const pseudoRef = useRef<string | null>(null);
  // Keep latest emit in a ref so onSignal stays stable across re-renders.
  const emitRef = useRef<TelemetryEmit | undefined>(onTelemetryEmit);
  emitRef.current = onTelemetryEmit;

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
    // Emit adaptation_applied telemetry only when a rule actually fired
    // (rule_id non-null). Fallback decisions are not "applications" of a rule.
    if (d.rule_id && d.modulator && emitRef.current) {
      emitRef.current({
        type: "adaptation_applied",
        rule_id: d.rule_id,
        signal: signal.kind,
        modulator: d.modulator,
        value: decisionValue(d, signal),
      });
    }
    return d;
  }, [lessonId, sessionId]);

  return { state, decision, onSignal, lastExplanation: engineRef.current.explain() };
}

/**
 * Computes the numeric `value` for an `adaptation_applied` event. The schema
 * requires a number but the semantics are modulator-specific. We use the
 * signal's difficulty when available (M1/M2) as a coarse proxy, otherwise 0.
 */
function decisionValue(_d: Decision, signal: Signal): number {
  if (signal.kind === "answer_submitted") return signal.difficulty;
  if (signal.kind === "confidence_declared") return signal.value;
  return 0;
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
