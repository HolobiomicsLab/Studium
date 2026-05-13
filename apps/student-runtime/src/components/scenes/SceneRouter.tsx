import type { Scene } from "@studium/lesson-bundle-schema";
import type { Signal } from "@studium/learner-state";
import type { TelemetryEmit } from "../../hooks/useTelemetry";
import IntroScene from "./IntroScene";
import ConceptScene from "./ConceptScene";
import QuizScene from "./QuizScene";
import MetaCheckpointScene from "./MetaCheckpointScene";
import ReproductionScene from "./ReproductionScene";
import AICritiqueScene from "./AICritiqueScene";

type Props = {
  scene: Scene;
  bundlePath: string;
  onSignal: (s: Signal) => Promise<unknown>;
  onContinue: () => void;
  critiqueEvalEndpoint?: string;
  emit?: TelemetryEmit;
};

export default function SceneRouter({
  scene,
  bundlePath,
  onSignal,
  onContinue,
  critiqueEvalEndpoint,
  emit,
}: Props) {
  if (scene.type === "intro")           return <IntroScene scene={scene} onContinue={onContinue} />;
  if (scene.type === "concept")         return <ConceptScene scene={scene} bundlePath={bundlePath} onContinue={onContinue} />;
  if (scene.type === "quiz")            return <QuizScene scene={scene} onSignal={onSignal} onContinue={onContinue} emit={emit} />;
  if (scene.type === "meta_checkpoint") return <MetaCheckpointScene scene={scene} onSignal={onSignal} onContinue={onContinue} />;
  if (scene.type === "reproduction")    return <ReproductionScene scene={scene} onSignal={onSignal} onContinue={onContinue} />;
  if (scene.type === "ai_critique")     return <AICritiqueScene scene={scene} onSignal={onSignal} onContinue={onContinue} endpoint={critiqueEvalEndpoint} emit={emit} />;
  if (scene.type === "discussion") {
    return (
      <div className="p-4 bg-yellow-50 rounded">
        <p className="text-sm text-gray-700">
          Discussion scene <code>{scene.id}</code> — renderer arrives in M5.9.
        </p>
        <button
          className="mt-2 px-3 py-1 bg-blue-600 text-white rounded"
          onClick={onContinue}
        >
          Continuer (skip)
        </button>
      </div>
    );
  }
  return null;
}
