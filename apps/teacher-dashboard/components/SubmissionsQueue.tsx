"use client";

import { useState } from "react";
import {
  decideLearnerItem,
  teacherIriForToken,
  type LearnerItemView,
  type LADecision,
  type LAReviewNoteCode,
} from "@/lib/api";

/**
 * Server action shape: the page wires this to decideLearnerItem() in lib/api.ts
 * (which POSTs to scene-synth). Kept as an injected prop so the queue stays a
 * pure presentational/interaction unit and is trivially testable.
 */
export type DecideAction = (
  itemId: string,
  decision: LADecision,
  noteCode?: LAReviewNoteCode,
) => Promise<void> | void;

type Props = {
  items: LearnerItemView[];
  onDecide: DecideAction;
};

export function formatSubmissionError(_error: unknown): string {
  return (
    "scene-synth n’a pas pu enregistrer la décision. " +
    "Vérifiez que le service scene-synth est démarré et accessible, puis réessayez."
  );
}

/** De-identify the author for the teacher view: items carry NO author identity
 * (the client-safe LearnerItemView omits author_pseudonym entirely). We surface
 * a stable, non-identifying tag derived from the item_id so the teacher can
 * refer to a submission without ever seeing who wrote it. */
function authorTag(item: LearnerItemView): string {
  const suffix = item.item_id.slice(-6).toUpperCase();
  return `Auteur·rice anonyme · #${suffix}`;
}

function ValidationBadge({ ok, errors }: { ok: boolean; errors: string[] }) {
  if (ok) {
    return (
      <span
        data-testid="validation-badge"
        data-ok="true"
        className="status-badge status-badge--valid"
      >
        ✓ Validation OK
      </span>
    );
  }
  return (
    <span
      data-testid="validation-badge"
      data-ok="false"
      className="status-badge status-badge--error"
      title={errors.join("\n")}
    >
      ✗ {errors.length} erreur{errors.length > 1 ? "s" : ""}
    </span>
  );
}

/** Render the scene body. For a quiz the choices ALWAYS show the answer key
 * (`correct`) — the teacher SHOULD see correct answers, and the body is forced
 * visible so a teacher cannot bulk-approve blind. */
function SceneBody({ scene }: { scene: LearnerItemView["scene"] }) {
  return (
    <div data-testid="scene-body" className="scene-review">
      <p className="scene-review__title">
        {scene.title}{" "}
        <code className="scene-review__type">[{scene.type}]</code>
      </p>
      {scene.question && <p className="scene-review__question">{scene.question}</p>}
      {Array.isArray(scene.choices) && (
        <ul data-testid="answer-key" className="answer-key">
          {scene.choices.map((c) => (
            <li
              key={c.id}
              data-correct={c.correct ? "true" : "false"}
            >
              <span aria-hidden>{c.correct ? "●" : "○"}</span>
              <span>{c.text}</span>
              {c.correct && (
                <span className="answer-key__badge">
                  bonne réponse
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {scene.feedback_correct && (
        <p className="scene-review__feedback">
          <strong>Feedback (correct) :</strong>{" "}
          {scene.feedback_correct}
        </p>
      )}
      {scene.feedback_incorrect && (
        <p className="scene-review__feedback">
          <strong>Feedback (incorrect) :</strong>{" "}
          {scene.feedback_incorrect}
        </p>
      )}
    </div>
  );
}

function SubmissionCard({
  item,
  onDecide,
}: {
  item: LearnerItemView;
  onDecide: DecideAction;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide(decision: LADecision, noteCode?: LAReviewNoteCode) {
    setBusy(true);
    setErr(null);
    try {
      await onDecide(item.item_id, decision, noteCode);
    } catch (e) {
      setErr(formatSubmissionError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      data-testid="submission-card"
      data-item-id={item.item_id}
      className="submission-card"
    >
      <div className="submission-card__meta">
        <span className="submission-card__author">{authorTag(item)}</span>
        <ValidationBadge ok={item.validation.ok} errors={item.validation.errors} />
      </div>

      <SceneBody scene={item.scene} />

      <div className="submission-card__actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("approve")}
          className="primary-button"
        >
          Approuver
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("request_revision", "ambiguous_distractor")}
          className="secondary-button"
        >
          Demander révision
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("reject", "off_topic")}
          className="danger-button"
        >
          Rejeter
        </button>
      </div>
      {err && (
        <p className="inline-error" role="alert">Erreur : {err}</p>
      )}
    </li>
  );
}

/**
 * Build the DecideAction used by the /submissions page. It derives the teacher
 * IRI from the course token (course-token-derived reviewer) and stamps an
 * EXPLICIT ISO timestamp at click time, then POSTs via decideLearnerItem().
 * This is the dashboard's first write path; extracted here so it is unit
 * testable with a mocked fetch (proves approve sends reviewer + reviewed_at).
 */
export function makeDecideAction(
  courseToken: string,
  now: () => string = () => new Date().toISOString(),
): DecideAction {
  const reviewer = teacherIriForToken(courseToken);
  return async (itemId, decision, noteCode) => {
    await decideLearnerItem(courseToken, itemId, {
      decision,
      reviewer,
      reviewed_at: now(),
      note_code: noteCode,
    });
  };
}

export default function SubmissionsQueue({ items, onDecide }: Props) {
  if (items.length === 0) {
    return (
      <p data-testid="empty-queue" className="empty-state empty-state--panel">
        Aucune soumission en attente de modération.
      </p>
    );
  }
  return (
    <ul data-testid="submissions-queue" className="submission-list">
      {items.map((item) => (
        <SubmissionCard key={item.item_id} item={item} onDecide={onDecide} />
      ))}
    </ul>
  );
}
