import type { Scene } from "@studium/lesson-bundle-schema";
import type { Signal } from "@studium/learner-state";
import IntroScene from "./IntroScene";
import ConceptScene from "./ConceptScene";
import QuizScene from "./QuizScene";
import MetaCheckpointScene from "./MetaCheckpointScene";

type Props = {
  scene: Scene;
  bundlePath: string;
  onSignal: (s: Signal) => Promise<unknown>;
  onContinue: () => void;
};

export default function SceneRouter({ scene, bundlePath, onSignal, onContinue }: Props) {
  if (scene.type === "intro")           return <IntroScene scene={scene} onContinue={onContinue} />;
  if (scene.type === "concept")         return <ConceptScene scene={scene} bundlePath={bundlePath} onContinue={onContinue} />;
  if (scene.type === "quiz")            return <QuizScene scene={scene} onSignal={onSignal} onContinue={onContinue} />;
  if (scene.type === "meta_checkpoint") return <MetaCheckpointScene scene={scene} onSignal={onSignal} onContinue={onContinue} />;
  return null;
}
