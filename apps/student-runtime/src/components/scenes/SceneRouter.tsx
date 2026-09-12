import catalogue from "../../../../../ui/context-help.json";
import { ContextHelp } from "@studium/activity-presentation/react";
import type { Scene } from "@studium/lesson-bundle-schema";
import type { Signal } from "@studium/learner-state";
import type { TelemetryEmit } from "../../hooks/useTelemetry";
import IntroScene from "./IntroScene";
import ConceptScene from "./ConceptScene";
import QuizScene from "./QuizScene";
import MetaCheckpointScene from "./MetaCheckpointScene";
import ReproductionScene from "./ReproductionScene";
import AICritiqueScene from "./AICritiqueScene";
import DiscussionScene from "./DiscussionScene";

/** The scene types the web surface has no component for yet (INT-STUDIUM-001).
 *
 * They are not skipped and not blank: each gets a card that says what it is and hands the
 * learner the Continue control, which is the thing `return null` took away — the scene
 * component owns that button, so a `null` render stranded the learner on an empty frame
 * with no way forward. Every one of these six is also implemented on the VS Code surface,
 * which is where the card points. */
export const UNSUPPORTED_ON_WEB: readonly Scene["type"][] = [
  "spot_the_flaw", "explain_back", "comparison", "summary_audit",
  "prompt_practice", "communication_sim",
] as const;

/** The card for a scene this surface cannot run.
 *
 * It shows the scene's TITLE and TYPE and nothing else from the scene. All six of these
 * types carry their answer key in the scene body — `claims`, `key_points`,
 * `model_answer`, `model_correction`, `model_prompt`, `model_response` — which the schema
 * marks "NEVER rendered pre-answer". Rendering the body to explain that it cannot be
 * rendered would hand the learner the answers.
 *
 * It emits no signal. `scene_entered` would claim the learner met and worked the scene,
 * which would put it in the completion and scaffolding denominators as if it had been
 * played; a truthful event for "this surface cannot run this scene" would be a new event
 * type, and that is a wire-contract decision, not a rendering one. */
function UnsupportedScene({ scene, onContinue }: { scene: Scene; onContinue: () => void }) {
  return (
    <section
      className="prose max-w-2xl mx-auto rounded border border-amber-300 bg-amber-50 p-4"
      data-testid="unsupported-scene"
      aria-labelledby={`scene-${scene.id}-title`}
    >
      <h2 id={`scene-${scene.id}-title`} className="text-lg font-semibold mb-2">
        {scene.title}
      </h2>
      <p className="text-sm text-gray-700">
        Cette scène (<code>{scene.type}</code>) n’est pas encore jouable sur la surface web.
        Elle est disponible dans l’extension VS Code, sur la même leçon.
      </p>
      <p className="text-xs text-gray-500 mt-1">
        Rien n’est évalué ici : la scène n’a pas été jouée, et aucune réponse n’est
        enregistrée pour elle.
      </p>
      <button
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        onClick={onContinue}
      >
        Continuer
      </button>
    </section>
  );
}

type Props = {
  scene: Scene;
  bundlePath: string;
  onSignal: (s: Signal) => Promise<unknown>;
  onContinue: () => void;
  critiqueEvalEndpoint?: string;
  emit?: TelemetryEmit;
};

/** Explain the current method using only its public scene type. */
export default function SceneRouter(props: Props) {
  return <><ContextHelp topic={catalogue.scene_topics[props.scene.type] as keyof typeof catalogue.topics} /><RenderedScene {...props} /></>;
}

function RenderedScene({
  scene,
  bundlePath,
  onSignal,
  onContinue,
  critiqueEvalEndpoint,
  emit,
}: Props) {
  switch (scene.type) {
    case "intro":
      return <IntroScene scene={scene} onContinue={onContinue} />;
    case "concept":
      return <ConceptScene scene={scene} bundlePath={bundlePath} onContinue={onContinue} />;
    case "quiz":
      return <QuizScene scene={scene} onSignal={onSignal} onContinue={onContinue} emit={emit} />;
    case "meta_checkpoint":
      return <MetaCheckpointScene scene={scene} onSignal={onSignal} onContinue={onContinue} />;
    case "reproduction":
      return <ReproductionScene scene={scene} onSignal={onSignal} onContinue={onContinue} />;
    case "ai_critique":
      return (
        <AICritiqueScene
          scene={scene}
          onSignal={onSignal}
          onContinue={onContinue}
          endpoint={critiqueEvalEndpoint}
          emit={emit}
        />
      );
    case "discussion":
      return <DiscussionScene scene={scene} emit={emit} onSignal={onSignal} onContinue={onContinue} />;
    case "spot_the_flaw":
    case "explain_back":
    case "comparison":
    case "summary_audit":
    case "prompt_practice":
    case "communication_sim":
      return <UnsupportedScene scene={scene} onContinue={onContinue} />;
    default: {
      // Exhaustiveness. A scene type added to the bundle schema and not to this switch
      // fails the TypeScript build here, instead of rendering nothing at runtime — which
      // is how six of the thirteen came to be unreachable on this surface.
      const unhandled: never = scene;
      return <UnsupportedScene scene={unhandled} onContinue={onContinue} />;
    }
  }
}
