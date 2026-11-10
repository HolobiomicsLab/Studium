"use client";

import { useEffect, useId, useState } from "react";
import type {
  LearnerItemView,
  LADecision,
  LAReviewNoteCode,
} from "@/lib/api";
import { fill, messages, type Locale } from "@/lib/i18n";

/** Where the browser remembers the typed name (a convenience: the field works without it). */
export const REVIEWER_NAME_KEY = "studium-reviewer-name";

/**
 * Decision shape: the page wires this to makeDecideAction(), which POSTs to this
 * dashboard's own route handler (/api/learner-items/{id}/decide); that handler,
 * on the server, calls scene-synth with the review token. Kept as an injected prop
 * so the queue stays a pure presentational/interaction unit and is trivially testable.
 */
export type DecideAction = (
  itemId: string,
  decision: LADecision,
  noteCode?: LAReviewNoteCode,
  reviewerName?: string,
) => Promise<void> | void;

type Props = {
  items: LearnerItemView[];
  onDecide: DecideAction;
  locale?: Locale;
  /** Seeds the name field (tests); otherwise the browser's remembered name, if any. */
  initialName?: string;
};

export function rememberedName(): string {
  try { return window.localStorage.getItem(REVIEWER_NAME_KEY) ?? ""; }
  catch { return ""; }
}

export function rememberName(name: string): void {
  try {
    if (name.trim()) window.localStorage.setItem(REVIEWER_NAME_KEY, name);
    else window.localStorage.removeItem(REVIEWER_NAME_KEY);
  } catch { /* storage blocked: the field still works for this page */ }
}

/** The dashboard's server holds no review token: decisions are disabled until it is set. */
export class DecisionsDisabledError extends Error {}

export function formatSubmissionError(error: unknown): string {
  if (error instanceof DecisionsDisabledError) {
    return (
      "Les décisions sont désactivées : définissez STUDIUM_REVIEW_TOKEN (32 caractères au moins) " +
      "sur scene-synth et sur le serveur du tableau de bord, puis redémarrez-les."
    );
  }
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
  reviewerName,
  nameHintId,
}: {
  item: LearnerItemView;
  onDecide: DecideAction;
  reviewerName: string;
  nameHintId: string;
}) {
  const named = reviewerName.trim() !== "";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide(decision: LADecision, noteCode?: LAReviewNoteCode) {
    setBusy(true);
    setErr(null);
    try {
      await onDecide(item.item_id, decision, noteCode, reviewerName.trim() || undefined);
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
          disabled={busy || !named}
          aria-describedby={named ? undefined : nameHintId}
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
 * Build the DecideAction used by the /submissions page. The browser sends only the
 * course, the decision, the note code and the name the teacher typed to the dashboard's
 * route handler, which checks the name, stamps the time and calls scene-synth with the review
 * token (lib/decide-route.ts). Extracted here so it is unit testable with a mocked
 * fetch (proves the browser never calls scene-synth and never holds the token).
 */
export function makeDecideAction(courseToken: string): DecideAction {
  return async (itemId, decision, noteCode, reviewerName) => {
    const body: Record<string, string> = { course_id: courseToken, decision };
    if (noteCode) body.note_code = noteCode;
    if (reviewerName?.trim()) body.reviewer_name = reviewerName.trim();
    // Same-origin call to the dashboard's server, which checks the typed name and adds the
    // time and the review token; the token is never here in the browser.
    const response = await fetch(`/api/learner-items/${encodeURIComponent(itemId)}/decide`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 503) throw new DecisionsDisabledError();
    if (!response.ok) throw new Error(`decision refused (HTTP ${response.status})`);
  };
}

/** The name learners will read on an approved contribution, as on the lesson review page. */
function ReviewerNameField({ name, setName, locale, hintId }: {
  name: string; setName: (name: string) => void; locale: Locale; hintId: string;
}) {
  const t = messages(locale);
  const shown = name.trim();
  return (
    <div data-testid="reviewer-name" className="submission-reviewer">
      <label className="approval-name">{t.validatorName}
        <input type="text" name="reviewer-name" autoComplete="name" maxLength={200} value={name}
          onChange={(event) => { setName(event.currentTarget.value); rememberName(event.currentTarget.value); }} />
      </label>
      {shown
        ? <p className="approval-voice" data-testid="reviewer-voice">{fill(t.contributionVoice, { name: shown })}</p>
        : <p className="approval-note" id={hintId} role="status">{t.contributionNameNeeded}</p>}
      {shown.includes("@") && <p className="approval-note">{t.contributionEmailNote}</p>}
    </div>
  );
}

export default function SubmissionsQueue({ items, onDecide, locale = "fr", initialName }: Props) {
  const [name, setName] = useState(initialName ?? "");
  const hintId = useId();
  // The remembered name is read after mount, so the server render and the first client render agree.
  useEffect(() => {
    if (initialName === undefined) {
      const remembered = rememberedName();
      if (remembered) setName(remembered);
    }
  }, [initialName]);
  if (items.length === 0) {
    return (
      <p data-testid="empty-queue" className="empty-state empty-state--panel">
        Aucune soumission en attente de modération.
      </p>
    );
  }
  return (
    <>
      <ReviewerNameField name={name} setName={setName} locale={locale} hintId={hintId} />
      <ul data-testid="submissions-queue" className="submission-list">
        {items.map((item) => (
          <SubmissionCard key={item.item_id} item={item} onDecide={onDecide} reviewerName={name} nameHintId={hintId} />
        ))}
      </ul>
    </>
  );
}
