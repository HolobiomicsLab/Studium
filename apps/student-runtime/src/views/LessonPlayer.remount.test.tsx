/**
 * @vitest-environment jsdom
 *
 * INT-STUDIUM-017 — two consecutive scenes of the same type must be two scenes to React.
 *
 * `SceneRouter` dispatches on `scene.type` and returns the scene component directly, so
 * without a `key` React reconciles instead of remounting when the lesson advances between
 * two scenes of the same type. The child then keeps `submitted`, `selected` and `enteredAt`
 * from the previous scene and its mount effect does not run again — which puts a
 * `response_time_ms` accumulated across both scenes into telemetry, and therefore into the
 * evaluation runs that read it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LessonPlayer from "./LessonPlayer";
import type { LessonBundle } from "@studium/lesson-bundle-schema";

afterEach(cleanup);

const { emitMock, flushMock, appendEventMock, bundle } = vi.hoisted(() => {
  const quiz = (n: number) => ({
    id: `s_quiz_${n}`,
    type: "quiz" as const,
    title: `Quiz ${n}`,
    question: `Question ${n} ?`,
    choices: [
      { id: `q${n}_a`, text: `Réponse ${n}A`, correct: true },
      { id: `q${n}_b`, text: `Réponse ${n}B`, correct: false },
    ],
    feedback_correct: `Correct ${n}`,
    feedback_incorrect: `Incorrect ${n}`,
    hints: [],
    objective_refs: [],
    concept_refs: ["c1"],
    estimated_seconds: 60,
    adaptation_hooks: [],
  });
  const b: LessonBundle = {
    schema_version: "1.4",
    bundle_id: "remount-001",
    source_plan_id: "plan-001",
    metadata: {
      title: "Deux quiz de suite",
      target: "L3",
      duration_minutes: 10,
      language: "fr",
      discipline: "science",
    },
    concepts: [
      { id: "c1", title: "C1", description: "...", bloom_level_target: "understand" },
    ],
    // The shipped demo bundle has the same shape: its scenes 5 and 6 are both `quiz`.
    scenes: [quiz(1), quiz(2)],
    rules: [],
    validated_by: "tester",
    validated_at: "2026-05-12T00:00:00Z",
  } as unknown as LessonBundle;
  return {
    emitMock: vi.fn(),
    flushMock: vi.fn().mockResolvedValue(undefined),
    appendEventMock: vi.fn().mockResolvedValue(undefined),
    bundle: b,
  };
});

vi.mock("../hooks/useTelemetry", () => ({
  useTelemetry: () => ({ emit: emitMock, flush: flushMock }),
  getTelemetryEndpoint: (x: string | null) => x,
  resolveTelemetryEndpoint: (_c: unknown, x: string | null) => x,
  getTelemetryCourseToken: (x: string) => x,
}));

vi.mock("../lib/tauri", () => ({
  tauri: {
    loadBundle: vi.fn().mockResolvedValue(bundle),
    loadState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn().mockResolvedValue(undefined),
    appendEvent: appendEventMock,
    getPseudonyme: vi.fn().mockResolvedValue("pseudo-1"),
    // The player reads the consent record before it transmits (INT-STUDIUM-030);
    // this suite is about a different behaviour, so the grant is simply present.
    getConsent: vi.fn().mockResolvedValue({ level_a: true, level_b: true, level_c: false }),
  },
}));

// `?bundle=` is now required (INT-STUDIUM-034); the remount behaviour under test is unchanged.
function renderAt(path = "/lesson/remount-001?bundle=/fixtures/remount.zip") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/lesson/:lessonId" element={<LessonPlayer />} />
        <Route path="/lesson/:lessonId/summary" element={<div>SUMMARY</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The signals the scene components send to the learner-state engine, as the engine records them. */
function signalsOfKind(kind: string): string[] {
  return appendEventMock.mock.calls
    .map((c) => c[0] as { event_type: string; payload: { scene_id?: string } })
    .filter((e) => e.event_type === kind)
    .map((e) => e.payload.scene_id ?? "");
}

describe("LessonPlayer — two consecutive scenes of the same type", () => {
  let now = 0;

  beforeEach(() => {
    emitMock.mockReset();
    flushMock.mockClear();
    appendEventMock.mockClear();
    now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enters the second quiz, renders it unanswered and times it from its own arrival", async () => {
    renderAt();
    await waitFor(() => screen.getByText("Question 1 ?"));

    // The first quiz is answered 500 ms after the learner arrives on it.
    fireEvent.click(screen.getByLabelText("Réponse 1A"));
    now = 1_500;
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await waitFor(() => screen.getByText(/Correct 1/));

    // Advancing lands on the second quiz, which is a quiz as well.
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    await waitFor(() => screen.getByText("Question 2 ?"));

    // 1. The scene component's mount effect ran again: the engine registered the second entry.
    expect(signalsOfKind("scene_entered")).toEqual(["s_quiz_1", "s_quiz_2"]);

    // 2. The second quiz is unanswered: no feedback from the first, no pre-selected choice.
    expect(screen.queryByText(/Correct 1/)).toBeNull();
    const submit2 = screen.getByRole("button", { name: /soumettre/i }) as HTMLButtonElement;
    expect(submit2.disabled).toBe(true);
    expect((screen.getByLabelText("Réponse 2A") as HTMLInputElement).checked).toBe(false);

    // 3. Its response time is measured from its own arrival, not from the first quiz's.
    fireEvent.click(screen.getByLabelText("Réponse 2A"));
    now = 1_800;
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await waitFor(() => screen.getByText(/Correct 2/));
    const answered = emitMock.mock.calls
      .map((c) => c[0] as { type: string; scene_id?: string; response_time_ms?: number })
      .filter((e) => e.type === "quiz_answered");
    expect(answered.map((e) => e.scene_id)).toEqual(["s_quiz_1", "s_quiz_2"]);
    expect(answered[0].response_time_ms).toBe(500);
    expect(answered[1].response_time_ms).toBe(300);
  });
});
