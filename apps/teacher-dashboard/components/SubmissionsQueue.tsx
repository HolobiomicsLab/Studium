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
        className="inline-block text-xs font-semibold px-2 py-0.5 rounded bg-green-100 text-green-800"
      >
        ✓ Validation OK
      </span>
    );
  }
  return (
    <span
      data-testid="validation-badge"
      data-ok="false"
      className="inline-block text-xs font-semibold px-2 py-0.5 rounded bg-red-100 text-red-800"
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
    <div data-testid="scene-body" className="bg-gray-50 rounded p-3 text-sm space-y-2">
      <p className="font-medium">
        {scene.title}{" "}
        <code className="text-xs text-gray-500">[{scene.type}]</code>
      </p>
      {scene.question && <p className="text-gray-800">{scene.question}</p>}
      {Array.isArray(scene.choices) && (
        <ul data-testid="answer-key" className="space-y-1">
          {scene.choices.map((c) => (
            <li
              key={c.id}
              data-correct={c.correct ? "true" : "false"}
              className={
                "flex items-center gap-2 " +
                (c.correct ? "text-green-700 font-semibold" : "text-gray-700")
              }
            >
              <span aria-hidden>{c.correct ? "●" : "○"}</span>
              <span>{c.text}</span>
              {c.correct && (
                <span className="text-[10px] uppercase tracking-wide bg-green-600 text-white px-1 rounded">
                  bonne réponse
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {scene.feedback_correct && (
        <p className="text-xs text-gray-600">
          <span className="font-semibold">Feedback (correct) :</span>{" "}
          {scene.feedback_correct}
        </p>
      )}
      {scene.feedback_incorrect && (
        <p className="text-xs text-gray-600">
          <span className="font-semibold">Feedback (incorrect) :</span>{" "}
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
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      data-testid="submission-card"
      data-item-id={item.item_id}
      className="bg-white shadow rounded p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">{authorTag(item)}</span>
        <ValidationBadge ok={item.validation.ok} errors={item.validation.errors} />
      </div>

      <SceneBody scene={item.scene} />

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("approve")}
          className="text-sm px-3 py-1 rounded bg-green-600 text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          Approuver
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("request_revision", "ambiguous_distractor")}
          className="text-sm px-3 py-1 rounded bg-amber-500 text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          Demander révision
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("reject", "off_topic")}
          className="text-sm px-3 py-1 rounded bg-red-600 text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Rejeter
        </button>
      </div>
      {err && <p className="text-xs text-red-600">Erreur : {err}</p>}
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
      <p data-testid="empty-queue" className="text-sm text-gray-600">
        Aucune soumission en attente de modération.
      </p>
    );
  }
  return (
    <ul data-testid="submissions-queue" className="space-y-4">
      {items.map((item) => (
        <SubmissionCard key={item.item_id} item={item} onDecide={onDecide} />
      ))}
    </ul>
  );
}
