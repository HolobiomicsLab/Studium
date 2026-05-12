import ReactMarkdown from "react-markdown";
import type { Scene } from "@studium/lesson-bundle-schema";

type Props = {
  scene: Extract<Scene, { type: "concept" }>;
  bundlePath: string;
  onContinue: () => void;
};

export default function ConceptScene({ scene, bundlePath: _bundlePath, onContinue }: Props) {
  return (
    <article className="prose max-w-2xl mx-auto">
      <ReactMarkdown>{scene.markdown}</ReactMarkdown>
      {scene.image_path && (
        <img src={`bundle://${scene.image_path}`} alt="" className="my-4" />
      )}
      <button className="mt-6 px-4 py-2 bg-blue-600 text-white rounded" onClick={onContinue}>
        Continuer
      </button>
    </article>
  );
}
