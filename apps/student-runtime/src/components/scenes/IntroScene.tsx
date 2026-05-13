import ReactMarkdown from "react-markdown";
import type { Scene } from "@studium/lesson-bundle-schema";

type Props = { scene: Extract<Scene, { type: "intro" }>; onContinue: () => void };

export default function IntroScene({ scene, onContinue }: Props) {
  return (
    <article className="prose max-w-2xl mx-auto">
      <ReactMarkdown>{scene.markdown}</ReactMarkdown>
      <button
        className="mt-6 px-4 py-2 bg-blue-600 text-white rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        onClick={onContinue}
      >
        Continuer
      </button>
    </article>
  );
}
