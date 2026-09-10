import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LessonBundleSchema, type LessonBundle } from "@studium/lesson-bundle-schema";
import { defaultLearnerState, type LearnerState } from "@studium/learner-state";
import type { Scene } from "@studium/lesson-bundle-schema";
import { tauri } from "../lib/tauri";
import { useAdaptation } from "../hooks/useAdaptation";
import { useTelemetry, resolveTelemetryEndpoint, getTelemetryCourseToken } from "../hooks/useTelemetry";
import SceneRouter from "../components/scenes/SceneRouter";
import CalibrationPanel from "../components/CalibrationPanel";
import CalibrationFeedback from "../components/CalibrationFeedback";
import ReviewDueIndicator from "../components/ReviewDueIndicator";
import AdaptationButton from "../components/AdaptationButton";
import type { Signal } from "@studium/learner-state";
import StudyShell from "../components/StudyShell";
import LessonExit from "../components/LessonExit";

// INT-STUDIUM-034: there is no BUNDLE_PATH constant any more. The player plays what it is
// given — `?bundle=<path>`, set by the library when a row is clicked. A default here is what
// made the runtime a single-lesson demo: it could open exactly one file, chosen when the
// binary was compiled, whatever the library offered and whatever the URL said.

export default function LessonPlayer() {
  const { lessonId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const bundlePath = searchParams.get("bundle");
  const navigate = useNavigate();
  const [bundle, setBundle] = useState<LessonBundle | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [initialState, setInitialState] = useState<LearnerState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bundlePath) return;
    (async () => {
      try {
        const raw = await tauri.loadBundle(bundlePath);
        const parsed = LessonBundleSchema.parse(raw);
        setBundle(parsed);
        const persisted = (await tauri.loadState(lessonId)) as LearnerState | null;
        setInitialState(persisted ?? defaultLearnerState(lessonId));
      } catch (e) {
        // Named, not swallowed: an unreadable bundle otherwise leaves "Chargement de la
        // leçon…" on screen for ever, which reads as a slow load rather than a broken file.
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [lessonId, bundlePath]);

  if (!bundlePath) {
    return (
      <StudyShell><main className="settings-page empty-state">
        <p className="text-gray-700 mb-3">
          Aucun bundle n&apos;a été choisi pour cette leçon.
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          Retour à la bibliothèque
        </button>
      </main></StudyShell>
    );
  }

  if (error) {
    return (
      <StudyShell><main className="settings-page empty-state">
        <p role="alert" className="text-red-600 mb-3">Leçon illisible : {error}</p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          Retour à la bibliothèque
        </button>
      </main></StudyShell>
    );
  }

  if (!bundle || !initialState) {
    return <StudyShell><main className="settings-page empty-state"><p role="status">Chargement de la leçon…</p></main></StudyShell>;
  }

  return (
    <Player
      bundle={bundle}
      initialState={initialState}
      sceneIdx={sceneIdx}
      setSceneIdx={setSceneIdx}
      navigate={navigate}
    />
  );
}

function Player({
  bundle,
  initialState,
  sceneIdx,
  setSceneIdx,
  navigate,
}: {
  bundle: LessonBundle;
  initialState: LearnerState;
  sceneIdx: number;
  setSceneIdx: (i: number) => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  // Le consentement et le pseudonyme sont LUS, pas supposés. Les deux valeurs qui étaient
  // écrites en dur ici — un endpoint qui ignorait l'accord de l'apprenant, et le littéral
  // "anonymous" à la place du pseudonyme par leçon que `pseudonyme.rs` calcule déjà — sont
  // les deux moitiés de ce que l'écran de consentement promet.
  const [consent, setConsent] = useState<{ level_b?: boolean } | null>(null);
  const [pseudonym, setPseudonym] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Chaque lecture échoue FERMÉE : sans consentement lisible on ne transmet pas, et sans
      // pseudonyme lisible on n'invente pas d'identifiant de remplacement.
      try {
        const record = await tauri.getConsent();
        if (!cancelled) setConsent(record ?? null);
      } catch {
        if (!cancelled) setConsent(null);
      }
      try {
        const value = await tauri.getPseudonyme(bundle.bundle_id);
        if (!cancelled) setPseudonym(typeof value === "string" && value ? value : null);
      } catch {
        if (!cancelled) setPseudonym(null);
      }
    })();
    return () => { cancelled = true; };
  }, [bundle.bundle_id]);

  const { emit, flush } = useTelemetry({
    endpoint: pseudonym ? resolveTelemetryEndpoint(consent, null) : null,
    courseToken: getTelemetryCourseToken(""),
    context: {
      learner_pseudonym: pseudonym ?? "anonymous",
      lesson_id: bundle.bundle_id,
      bundle_version: bundle.schema_version,
    },
  });
  const { state, decision, onSignal } = useAdaptation(
    bundle.rules,
    bundle.bundle_id,
    initialState,
    emit,
  );
  const scene = bundle.scenes[sceneIdx] as Scene;
  const [calibTarget, setCalibTarget] = useState<string | null>(null);
  // Learner-facing, NUMBER-FREE calibration feedback, shown specifically after a meta_checkpoint
  // (a confidence self-assessment). Distinct from the numeric CalibrationPanel: it surfaces the
  // qualitative "ta confiance était bien/sur/sous-calibrée" verdict without leaking mastery.
  const [calibFeedbackTarget, setCalibFeedbackTarget] = useState<string | null>(null);
  const startedAtRef = useRef<number>(performance.now());
  const lessonStartedEmittedRef = useRef(false);
  const sceneEnteredRef = useRef<string | null>(null);

  // Emit lesson_started exactly once per Player mount
  useEffect(() => {
    if (lessonStartedEmittedRef.current) return;
    lessonStartedEmittedRef.current = true;
    startedAtRef.current = performance.now();
    emit({ type: "lesson_started", bundle_uri: bundle.bundle_id });
    // Deps deliberately empty: this must fire exactly once per Player mount.
    // `emit` and `bundle` are intentionally omitted; the ref above is the guard.
  }, []);

  // Emit scene_entered when scene changes (and on first render)
  useEffect(() => {
    if (sceneEnteredRef.current === scene.id) return;
    sceneEnteredRef.current = scene.id;
    emit({ type: "scene_entered", scene_id: scene.id, scene_type: scene.type });
    // Deps deliberately narrowed to the scene identity: `emit` is omitted so that a new
    // callback identity does not re-emit scene_entered for a scene already entered.
  }, [scene.id, scene.type]);

  useEffect(() => {
    if (decision?.next_action.kind === "show_calibration_panel") {
      const target = (decision.next_action as { kind: string; target_concept: string }).target_concept;
      // After a meta_checkpoint (a confidence self-assessment), give the learner the qualitative,
      // number-free calibration verdict. The numeric CalibrationPanel stays for the non-meta path
      // (e.g. an answer-driven calibration nudge) so we don't change that behavior.
      if (scene.type === "meta_checkpoint") setCalibFeedbackTarget(target);
      else setCalibTarget(target);
    }
  }, [decision, scene.type]);

  const completeLesson = () => {
    const totalMs = Math.max(0, Math.round(performance.now() - startedAtRef.current));
    const completed = state.scenes_completed.length;
    const replayed = Object.values(state.scenes_replayed ?? {}).reduce(
      (n, v) => n + (typeof v === "number" ? v : 0),
      0,
    );
    const denom = completed + replayed;
    const autonomyRatio = denom === 0 ? 1 : completed / denom;
    emit({
      type: "lesson_completed",
      total_duration_ms: totalMs,
      autonomy_ratio: Math.max(0, Math.min(1, autonomyRatio)),
    });
  };

  const onContinue = async () => {
    await onSignal({ kind: "scene_completed", scene_id: scene.id, duration_ms: 0 });
    if (decision?.next_action.kind === "replay_current_scene") return;
    if (decision?.next_action.kind === "skip_to_next_concept") {
      const currentConcept = "concept_refs" in scene ? (scene.concept_refs[0] ?? "") : "";
      const next = bundle.scenes.findIndex(
        (s, i) => i > sceneIdx && ("concept_refs" in s ? (s.concept_refs[0] ?? "") : "") !== currentConcept
      );
      if (next >= 0) { setSceneIdx(next); return; }
    }
    if (sceneIdx + 1 >= bundle.scenes.length) {
      completeLesson();
      navigate(`/lesson/${bundle.bundle_id}/summary`, { replace: true });
    } else {
      setSceneIdx(sceneIdx + 1);
    }
  };

  return (
    <StudyShell lesson>
    <main data-testid="lesson-player" className="player-page">
      <LessonExit onExit={async () => { await flush(); navigate("/library"); }} />
      <header className="player-heading">
        <div><p className="eyebrow">Leçon en cours</p><h1>{bundle.metadata.title}</h1></div>
        <span className="player-position">
          Scène {sceneIdx + 1} / {bundle.scenes.length}
        </span>
        <ReviewDueIndicator state={state} />
      </header>
      <progress className="scene-progress" aria-label="Position dans la leçon" value={sceneIdx + 1} max={bundle.scenes.length} />
      <div className="scene-paper">
      {/* `key` is the scene identity: SceneRouter dispatches on `scene.type` and returns the
          scene component directly, so without it two consecutive scenes of the same type are
          one component instance to React — the mount effects do not run again and `submitted`,
          `selected` and the response-time origin carry over (INT-STUDIUM-017). */}
      <SceneRouter
        key={scene.id}
        scene={scene}
        bundlePath={bundle.bundle_id}
        onSignal={onSignal as (s: Signal) => Promise<unknown>}
        onContinue={onContinue}
        emit={emit}
      />
      </div>
      {calibTarget && (
        <CalibrationPanel
          conceptId={calibTarget}
          state={state}
          onClose={() => setCalibTarget(null)}
        />
      )}
      {calibFeedbackTarget && (
        <CalibrationFeedback
          conceptId={calibFeedbackTarget}
          state={state}
          onClose={() => setCalibFeedbackTarget(null)}
        />
      )}
      <AdaptationButton decision={decision} />
    </main>
    </StudyShell>
  );
}
