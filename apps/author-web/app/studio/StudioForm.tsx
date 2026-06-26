"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuizSceneSchema, type QuizScene } from "@/lib/quiz-scene";
import {
  SpotTheFlawSceneSchema,
  ExplainBackSceneSchema,
  DEFAULT_RUBRIC,
  type SpotTheFlawScene,
  type ExplainBackScene,
} from "@/lib/scenes";
import {
  validateLearnerScene,
  submitLearnerItem,
  type Scene,
  type SceneType,
  type ValidateResponse,
  type LearnerItemView,
} from "@/lib/api";
import { SelfTestPanel } from "./SelfTestPanel";
import { SpotTheFlawRevealPanel, ExplainBackRevealPanel } from "./RevealPanel";
import {
  SpotTheFlawEditor,
  initialSpotTheFlawDraft,
  type SpotTheFlawDraft,
} from "./SpotTheFlawEditor";
import {
  ExplainBackEditor,
  initialExplainBackDraft,
  type ExplainBackDraft,
} from "./ExplainBackEditor";

// Demo course context (backend hardcodes these; see plan §"Minor defaults").
const COURSE_ID = "atomistique-l1";
const CONCEPT_ID = "c-orbitales-formes";
const TARGET_BUNDLE_REF = "atomistique-l1/lesson.json";

type ChoiceDraft = { id: string; text: string; correct: boolean };

function emptyChoice(id: string): ChoiceDraft {
  return { id, text: "", correct: false };
}

// Shared scene metadata authored once and stamped onto whichever scene type is
// built. concept_refs is fixed to the single demo concept; objective_refs /
// adaptation_hooks stay empty (governance/authoring metadata lives OUTSIDE the
// scene).
function sceneBase(title: string, estimatedSeconds: number) {
  return {
    title,
    objective_refs: [] as string[],
    concept_refs: [CONCEPT_ID],
    estimated_seconds: estimatedSeconds,
    adaptation_hooks: [] as string[],
  };
}

function buildQuizScene(args: {
  title: string;
  estimatedSeconds: number;
  question: string;
  choices: ChoiceDraft[];
  feedbackCorrect: string;
  feedbackIncorrect: string;
  hints: string[];
}): QuizScene {
  return {
    id: "la-quiz-draft",
    type: "quiz",
    ...sceneBase(args.title, args.estimatedSeconds),
    question: args.question,
    choices: args.choices.map((c) => ({ id: c.id, text: c.text, correct: c.correct })),
    feedback_correct: args.feedbackCorrect,
    feedback_incorrect: args.feedbackIncorrect,
    hints: args.hints.filter((h) => h.trim().length > 0),
  };
}

function buildSpotTheFlawScene(
  title: string,
  estimatedSeconds: number,
  d: SpotTheFlawDraft
): SpotTheFlawScene {
  return {
    id: "la-spot-the-flaw-draft",
    type: "spot_the_flaw",
    ...sceneBase(title, estimatedSeconds),
    flawed_content: d.flawed_content,
    claims: d.claims.map((c) => ({
      id: c.id,
      text: c.text,
      flaws_expected: c.flaws_expected.map((f) => f.trim()).filter((f) => f.length > 0),
    })),
    model_correction: d.model_correction,
    rubric: DEFAULT_RUBRIC,
  };
}

function buildExplainBackScene(
  title: string,
  estimatedSeconds: number,
  d: ExplainBackDraft
): ExplainBackScene {
  return {
    id: "la-explain-back-draft",
    type: "explain_back",
    ...sceneBase(title, estimatedSeconds),
    prompt: d.prompt,
    key_points: d.key_points.map((k) => ({
      id: k.id,
      text: k.text,
      cues: k.cues.map((q) => q.trim()).filter((q) => q.length > 0),
    })),
    model_explanation: d.model_explanation,
    rubric: DEFAULT_RUBRIC,
  };
}

// Client-side schema gate per scene type (incl. quiz's exactly-one-correct, and
// the .min(1) flaws/cues invariants). Returns the same {success, errors} shape
// regardless of type so the badge logic is uniform.
function parseScene(scene: Scene): { success: boolean; errors: string[] } {
  const res =
    scene.type === "quiz"
      ? QuizSceneSchema.safeParse(scene)
      : scene.type === "spot_the_flaw"
        ? SpotTheFlawSceneSchema.safeParse(scene)
        : ExplainBackSceneSchema.safeParse(scene);
  if (res.success) return { success: true, errors: [] };
  return {
    success: false,
    errors: res.error.issues.map((i) => `${i.path.join(".") || "(racine)"}: ${i.message}`),
  };
}

export type StudioFormProps = {
  // Injectable for tests; defaults to the real :8002 client functions.
  validateFn?: typeof validateLearnerScene;
  submitFn?: typeof submitLearnerItem;
  debounceMs?: number;
};

export function StudioForm({
  validateFn = validateLearnerScene,
  submitFn = submitLearnerItem,
  debounceMs = 400,
}: StudioFormProps) {
  const [sceneType, setSceneType] = useState<SceneType>("quiz");

  // Shared metadata.
  const [title, setTitle] = useState("");
  const [estimatedSeconds, setEstimatedSeconds] = useState(30);

  // quiz-specific.
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState<ChoiceDraft[]>([emptyChoice("a"), emptyChoice("b")]);
  const [feedbackCorrect, setFeedbackCorrect] = useState("");
  const [feedbackIncorrect, setFeedbackIncorrect] = useState("");
  const [hints, setHints] = useState<string[]>([]);

  // spot_the_flaw + explain_back drafts.
  const [spotDraft, setSpotDraft] = useState<SpotTheFlawDraft>(initialSpotTheFlawDraft);
  const [explainDraft, setExplainDraft] = useState<ExplainBackDraft>(initialExplainBackDraft);

  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<LearnerItemView | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Server validation verdict (the green/red badge). `null` = not-yet-validated.
  const [serverValidation, setServerValidation] = useState<ValidateResponse | null>(null);
  const [validating, setValidating] = useState(false);

  // Build the active scene from whichever editor is selected.
  const scene = useMemo<Scene>(() => {
    if (sceneType === "quiz") {
      return buildQuizScene({
        title,
        estimatedSeconds,
        question,
        choices,
        feedbackCorrect,
        feedbackIncorrect,
        hints,
      });
    }
    if (sceneType === "spot_the_flaw") {
      return buildSpotTheFlawScene(title, estimatedSeconds, spotDraft);
    }
    return buildExplainBackScene(title, estimatedSeconds, explainDraft);
  }, [
    sceneType,
    title,
    estimatedSeconds,
    question,
    choices,
    feedbackCorrect,
    feedbackIncorrect,
    hints,
    spotDraft,
    explainDraft,
  ]);

  const local = useMemo(() => parseScene(scene), [scene]);
  const localOk = local.success;
  const localErrors = local.errors;

  // Debounced server validation: only fire when the draft is locally valid, so
  // the badge reflects the backend's verdict on a well-formed scene.
  const sceneKey = JSON.stringify(scene);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setServerValidation(null);
    if (!localOk) return;
    if (timer.current) clearTimeout(timer.current);
    setValidating(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await validateFn(scene, COURSE_ID);
        setServerValidation(res);
      } catch {
        setServerValidation({ ok: false, validator_version: "", errors: ["validation indisponible"] });
      } finally {
        setValidating(false);
      }
    }, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // `scene` and `validateFn` are intentionally read but excluded from deps:
    // `sceneKey` is the stable serialization of `scene`, and `validateFn` is a
    // stable injected prop. Listing them would re-fire the debounce needlessly.
  }, [sceneKey, localOk, debounceMs]);

  const badgeGreen = localOk && serverValidation?.ok === true;
  const canSubmit = badgeGreen && consent && !submitting && !submitted;

  const updateChoice = useCallback((idx: number, patch: Partial<ChoiceDraft>) => {
    setChoices((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }, []);

  // exactly-one-correct: marking a choice correct clears the others (radio-like).
  const markCorrect = useCallback((idx: number) => {
    setChoices((prev) => prev.map((c, i) => ({ ...c, correct: i === idx })));
  }, []);

  const addChoice = useCallback(() => {
    setChoices((prev) =>
      prev.length >= 6 ? prev : [...prev, emptyChoice(String.fromCharCode(97 + prev.length))]
    );
  }, []);
  const removeChoice = useCallback((idx: number) => {
    setChoices((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)));
  }, []);

  async function handleSubmit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const view = await submitFn({
        courseId: COURSE_ID,
        targetBundleRef: TARGET_BUNDLE_REF,
        authorHandle: "demo-learner",
        createdAt: new Date().toISOString(),
        scene,
      });
      setSubmitted(view);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = { display: "block", marginTop: 4, padding: "4px 8px", width: "100%" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 640 }}>
      <p style={{ color: "#555" }}>
        Rédige UNE scène d&apos;apprentissage actif pour le concept{" "}
        <strong>{CONCEPT_ID}</strong>. Ton texte reste sur ton appareil tant que tu n&apos;as
        pas cliqué « Soumettre ». Rien n&apos;est publié : un enseignant doit approuver ta
        proposition.
      </p>

      <label>
        Type de scène
        <select
          aria-label="type de scène"
          value={sceneType}
          onChange={(e) => {
            setSceneType(e.target.value as SceneType);
            // a type switch invalidates the previous badge.
            setServerValidation(null);
          }}
          style={inputStyle}
        >
          <option value="quiz">Quiz (QCM)</option>
          <option value="spot_the_flaw">Repérer l&apos;erreur (spot the flaw)</option>
          <option value="explain_back">Ré-expliquer (explain back)</option>
        </select>
      </label>

      <label>
        Titre
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
      </label>

      {/* ----- quiz editor ----- */}
      {sceneType === "quiz" && (
        <>
          <label>
            Question
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              style={inputStyle}
              rows={2}
            />
          </label>

          <fieldset style={{ border: "1px solid #ddd", borderRadius: 6 }}>
            <legend>Choix (2 à 6, exactement un correct)</legend>
            {choices.map((c, i) => (
              <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <input
                  type="radio"
                  name="correct-choice"
                  aria-label={`marquer le choix ${c.id} correct`}
                  checked={c.correct}
                  onChange={() => markCorrect(i)}
                />
                <input
                  aria-label={`texte du choix ${c.id}`}
                  value={c.text}
                  onChange={(e) => updateChoice(i, { text: e.target.value })}
                  style={{ flex: 1, padding: "4px 8px" }}
                />
                <button type="button" onClick={() => removeChoice(i)} disabled={choices.length <= 2}>
                  −
                </button>
              </div>
            ))}
            <button type="button" onClick={addChoice} disabled={choices.length >= 6}>
              + Ajouter un choix
            </button>
          </fieldset>

          <label>
            Feedback si correct
            <input value={feedbackCorrect} onChange={(e) => setFeedbackCorrect(e.target.value)} style={inputStyle} />
          </label>
          <label>
            Feedback si incorrect
            <input value={feedbackIncorrect} onChange={(e) => setFeedbackIncorrect(e.target.value)} style={inputStyle} />
          </label>
          <label>
            Indices (un par ligne)
            <textarea
              value={hints.join("\n")}
              onChange={(e) => setHints(e.target.value.split("\n"))}
              style={inputStyle}
              rows={2}
            />
          </label>
        </>
      )}

      {/* ----- spot_the_flaw editor ----- */}
      {sceneType === "spot_the_flaw" && (
        <SpotTheFlawEditor draft={spotDraft} onChange={setSpotDraft} />
      )}

      {/* ----- explain_back editor ----- */}
      {sceneType === "explain_back" && (
        <ExplainBackEditor draft={explainDraft} onChange={setExplainDraft} />
      )}

      <label>
        Durée estimée (s)
        <input
          type="number"
          min={0}
          value={estimatedSeconds}
          onChange={(e) => setEstimatedSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          style={inputStyle}
        />
      </label>

      {/* Green/red validation badge */}
      <div
        role="status"
        data-testid="validation-badge"
        data-state={badgeGreen ? "green" : "red"}
        style={{
          padding: "0.5rem 0.75rem",
          borderRadius: 4,
          fontWeight: 600,
          background: badgeGreen ? "#e6f4ea" : "#fdecea",
          color: badgeGreen ? "#1e7e34" : "#b3261e",
        }}
      >
        {badgeGreen
          ? "✓ Scène valide"
          : validating
            ? "Validation…"
            : "✗ Scène invalide"}
        {!localOk && (
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem", fontWeight: 400 }}>
            {localErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        {localOk && serverValidation && !serverValidation.ok && (
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem", fontWeight: 400 }}>
            {serverValidation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Key-free preview: only meaningful once the scene is locally valid. The
          quiz uses the answer-driven SelfTestPanel; the new types use a
          reveal-AFTER-a-mock-answer panel (no answer key shown until acted). */}
      {localOk && scene.type === "quiz" && <SelfTestPanel scene={scene} />}
      {localOk && scene.type === "spot_the_flaw" && <SpotTheFlawRevealPanel scene={scene} />}
      {localOk && scene.type === "explain_back" && <ExplainBackRevealPanel scene={scene} />}

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          aria-label="consentement"
        />
        <span>
          Je consens à soumettre cette scène à la modération de l&apos;enseignant. Mon identité
          n&apos;est jamais montrée aux autres apprenants.
        </span>
      </label>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          padding: "8px 16px",
          background: canSubmit ? "#0070f3" : "#bbb",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        {submitting ? "Envoi…" : "Soumettre à la modération"}
      </button>

      {submitted && (
        <p role="status" style={{ color: "#1e7e34" }}>
          Proposition soumise (état : {submitted.review_state}). Un enseignant la relira.
        </p>
      )}
      {submitError && <p style={{ color: "red" }}>{submitError}</p>}
    </div>
  );
}
