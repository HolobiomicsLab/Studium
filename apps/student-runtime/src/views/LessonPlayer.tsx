import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LessonBundleSchema, type LessonBundle } from "@studium/lesson-bundle-schema";
import { defaultLearnerState, type LearnerState } from "@studium/learner-state";
import type { Scene } from "@studium/lesson-bundle-schema";
import { tauri } from "../lib/tauri";
import { useAdaptation } from "../hooks/useAdaptation";
import SceneRouter from "../components/scenes/SceneRouter";
import CalibrationPanel from "../components/CalibrationPanel";
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
  const { state, decision, onSignal } = useAdaptation(bundle.rules, bundle.bundle_id, initialState);
  const scene = bundle.scenes[sceneIdx] as Scene;
  const [calibTarget, setCalibTarget] = useState<string | null>(null);

  useEffect(() => {
    if (decision?.next_action.kind === "show_calibration_panel") {
      setCalibTarget((decision.next_action as { kind: string; target_concept: string }).target_concept);
    }
  }, [decision]);

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
      navigate(`/lesson/${bundle.bundle_id}/summary`, { replace: true });
    } else {
      setSceneIdx(sceneIdx + 1);
    }
  };

  return (
    <main className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-3xl mx-auto mb-4 text-sm text-gray-500">
        Scène {sceneIdx + 1} / {bundle.scenes.length}
      </div>
      <SceneRouter
        scene={scene}
        bundlePath={bundle.bundle_id}
        onSignal={onSignal as (s: Signal) => Promise<unknown>}
        onContinue={onContinue}
      />
      {calibTarget && (
        <CalibrationPanel
          conceptId={calibTarget}
          state={state}
          onClose={() => setCalibTarget(null)}
        />
      )}
      <AdaptationButton decision={decision} />
    </main>
  );
}
