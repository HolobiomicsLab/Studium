import ReactMarkdown from "react-markdown";
import type { Scene } from "@studium/lesson-bundle-schema";

type Props = { scene: Extract<Scene, { type: "intro" }>; onContinue: () => void };

export default function IntroScene({ scene, onContinue }: Props) {
  return (
    <article className="prose max-w-2xl mx-auto">
      <ReactMarkdown>{scene.content.markdown}</ReactMarkdown>
      <button className="mt-6 px-4 py-2 bg-blue-600 text-white rounded" onClick={onContinue}>
        Continuer
      </button>
    </article>
  );
}
