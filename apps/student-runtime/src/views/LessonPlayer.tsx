import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LessonBundleSchema, type LessonBundle } from "@studium/lesson-bundle-schema";
import { defaultLearnerState, type LearnerState } from "@studium/learner-state";
import type { Scene } from "@studium/lesson-bundle-schema";
import { tauri } from "../lib/tauri";
import { useAdaptation } from "../hooks/useAdaptation";
import { useTelemetry, getTelemetryEndpoint, getTelemetryCourseToken } from "../hooks/useTelemetry";
import SceneRouter from "../components/scenes/SceneRouter";
import CalibrationPanel from "../components/CalibrationPanel";
import CalibrationFeedback from "../components/CalibrationFeedback";
import ReviewDueIndicator from "../components/ReviewDueIndicator";
import AdaptationButton from "../components/AdaptationButton";
import type { Signal } from "@studium/learner-state";

const BUNDLE_PATH = "fixtures/m3/demo-metabolomics-bundle.zip";

export default function LessonPlayer() {
  const { lessonId = "" } = useParams();
  const navigate = useNavigate();
  const [bundle, setBundle] = useState<LessonBundle | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [initialState, setInitialState] = useState<LearnerState | null>(null);

  useEffect(() => {
    (async () => {
      const raw = await tauri.loadBundle(BUNDLE_PATH);
      const parsed = LessonBundleSchema.parse(raw);
      setBundle(parsed);
      const persisted = (await tauri.loadState(lessonId)) as LearnerState | null;
      setInitialState(persisted ?? defaultLearnerState(lessonId));
    })();
  }, [lessonId]);

  if (!bundle || !initialState) {
    return <p className="p-8 text-gray-500">Chargement de la leçon…</p>;
  }

  return (
    <Player
      bundle={bundle}
      initialState={initialState}
      sceneIdx={sceneIdx}
      setSceneIdx={setSceneIdx}
      navigate={navigate}
    />
  );
}

function Player({
  bundle,
  initialState,
  sceneIdx,
  setSceneIdx,
  navigate,
}: {
  bundle: LessonBundle;
  initialState: LearnerState;
  sceneIdx: number;
  setSceneIdx: (i: number) => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { emit } = useTelemetry({
    endpoint: getTelemetryEndpoint(null),
    courseToken: getTelemetryCourseToken(""),
    context: {
      learner_pseudonym: "anonymous",
      lesson_id: bundle.bundle_id,
      bundle_version: bundle.schema_version,
    },
  });
  const { state, decision, onSignal } = useAdaptation(
    bundle.rules,
    bundle.bundle_id,
    initialState,
    emit,
  );
  const scene = bundle.scenes[sceneIdx] as Scene;
  const [calibTarget, setCalibTarget] = useState<string | null>(null);
  // Learner-facing, NUMBER-FREE calibration feedback, shown specifically after a meta_checkpoint
  // (a confidence self-assessment). Distinct from the numeric CalibrationPanel: it surfaces the
  // qualitative "ta confiance était bien/sur/sous-calibrée" verdict without leaking mastery.
  const [calibFeedbackTarget, setCalibFeedbackTarget] = useState<string | null>(null);
  const startedAtRef = useRef<number>(performance.now());
  const lessonStartedEmittedRef = useRef(false);
  const sceneEnteredRef = useRef<string | null>(null);

  // Emit lesson_started exactly once per Player mount
  useEffect(() => {
    if (lessonStartedEmittedRef.current) return;
    lessonStartedEmittedRef.current = true;
    startedAtRef.current = performance.now();
    emit({ type: "lesson_started", bundle_uri: bundle.bundle_id });
    // Deps deliberately empty: this must fire exactly once per Player mount.
    // `emit` and `bundle` are intentionally omitted; the ref above is the guard.
  }, []);

  // Emit scene_entered when scene changes (and on first render)
  useEffect(() => {
    if (sceneEnteredRef.current === scene.id) return;
    sceneEnteredRef.current = scene.id;
    emit({ type: "scene_entered", scene_id: scene.id, scene_type: scene.type });
    // Deps deliberately narrowed to the scene identity: `emit` is omitted so that a new
    // callback identity does not re-emit scene_entered for a scene already entered.
  }, [scene.id, scene.type]);

  useEffect(() => {
    if (decision?.next_action.kind === "show_calibration_panel") {
      const target = (decision.next_action as { kind: string; target_concept: string }).target_concept;
      // After a meta_checkpoint (a confidence self-assessment), give the learner the qualitative,
      // number-free calibration verdict. The numeric CalibrationPanel stays for the non-meta path
      // (e.g. an answer-driven calibration nudge) so we don't change that behavior.
      if (scene.type === "meta_checkpoint") setCalibFeedbackTarget(target);
      else setCalibTarget(target);
    }
  }, [decision, scene.type]);

  const completeLesson = () => {
    const totalMs = Math.max(0, Math.round(performance.now() - startedAtRef.current));
    const completed = state.scenes_completed.length;
    const replayed = Object.values(state.scenes_replayed ?? {}).reduce(
      (n, v) => n + (typeof v === "number" ? v : 0),
      0,
    );
    const denom = completed + replayed;
    const autonomyRatio = denom === 0 ? 1 : completed / denom;
    emit({
      type: "lesson_completed",
      total_duration_ms: totalMs,
      autonomy_ratio: Math.max(0, Math.min(1, autonomyRatio)),
    });
  };

  const onContinue = async () => {
    await onSignal({ kind: "scene_completed", scene_id: scene.id, duration_ms: 0 });
    if (decision?.next_action.kind === "replay_current_scene") return;
    if (decision?.next_action.kind === "skip_to_next_concept") {
      const currentConcept = "concept_refs" in scene ? (scene.concept_refs[0] ?? "") : "";
      const next = bundle.scenes.findIndex(
        (s, i) => i > sceneIdx && ("concept_refs" in s ? (s.concept_refs[0] ?? "") : "") !== currentConcept
      );
      if (next >= 0) { setSceneIdx(next); return; }
    }
    if (sceneIdx + 1 >= bundle.scenes.length) {
      completeLesson();
      navigate(`/lesson/${bundle.bundle_id}/summary`, { replace: true });
    } else {
      setSceneIdx(sceneIdx + 1);
    }
  };

  return (
    <main className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-3xl mx-auto mb-4 flex items-center justify-between gap-3">
        <span className="text-sm text-gray-500">
          Scène {sceneIdx + 1} / {bundle.scenes.length}
        </span>
        <ReviewDueIndicator state={state} />
      </div>
      <SceneRouter
        scene={scene}
        bundlePath={bundle.bundle_id}
        onSignal={onSignal as (s: Signal) => Promise<unknown>}
        onContinue={onContinue}
        emit={emit}
      />
      {calibTarget && (
        <CalibrationPanel
          conceptId={calibTarget}
          state={state}
          onClose={() => setCalibTarget(null)}
        />
      )}
      {calibFeedbackTarget && (
        <CalibrationFeedback
          conceptId={calibFeedbackTarget}
          state={state}
          onClose={() => setCalibFeedbackTarget(null)}
        />
      )}
      <AdaptationButton decision={decision} />
    </main>
  );
}
