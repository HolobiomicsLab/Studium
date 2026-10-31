import { useRef, useState } from "react";

/** Confirms leaving because unsent scene inputs cannot yet be restored. */
export default function LessonExit({ onExit }: { onExit: () => void | Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const leave = async () => {
    setLeaving(true);
    setError(false);
    try { await onExit(); }
    catch { setError(true); }
    finally { setLeaving(false); }
  };
  return (
    <div className="lesson-exit">
      <button ref={trigger} className="button-secondary" disabled={leaving} onClick={() => setConfirming(true)} aria-expanded={confirming}>
        Quitter la leçon
      </button>
      {confirming && (
        <div className="exit-confirmation" role="group" aria-label="Confirmer la sortie de la leçon">
          <p>Une réponse non envoyée sera perdue. Si tu reviens, la leçon redémarrera à la première scène.</p>
          <div className="exit-actions">
            <button className="button-primary" disabled={leaving} autoFocus onClick={() => { setConfirming(false); trigger.current?.focus(); }}>Rester dans la leçon</button>
            <button className="button-secondary" disabled={leaving} onClick={leave}>{leaving ? "Enregistrement…" : "Quitter et revenir à la bibliothèque"}</button>
          </div>
          {error && <p role="alert">L’enregistrement n’a pas abouti. Tu peux rester dans la leçon ou réessayer.</p>}
        </div>
      )}
    </div>
  );
}
