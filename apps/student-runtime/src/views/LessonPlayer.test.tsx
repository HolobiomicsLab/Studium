/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LessonPlayer from "./LessonPlayer";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { defaultLearnerState } from "@studium/learner-state";

afterEach(cleanup);

const { emitMock, flushMock, bundle } = vi.hoisted(() => {
  const b: LessonBundle = {
    schema_version: "1.4",
    bundle_id: "demo-001",
    source_plan_id: "plan-001",
    metadata: {
      title: "Demo",
      target: "L3",
      duration_minutes: 10,
      language: "fr",
      discipline: "science",
    },
    concepts: [
      {
        id: "c1",
        title: "C1",
        description: "...",
        bloom_level_target: "understand",
      },
    ],
    scenes: [
      {
        id: "s_intro",
        type: "intro",
        title: "Intro",
        markdown: "Bienvenue",
        objective_refs: [],
        concept_refs: ["c1"],
        estimated_seconds: 30,
        adaptation_hooks: [],
      },
      {
        id: "s_concept",
        type: "concept",
        title: "Concept",
        markdown: "Contenu",
        objective_refs: [],
        concept_refs: ["c1"],
        estimated_seconds: 60,
        adaptation_hooks: [],
      },
    ],
    rules: [],
    validated_by: "tester",
    validated_at: "2026-05-12T00:00:00Z",
  };
  return {
    emitMock: vi.fn(),
    flushMock: vi.fn().mockResolvedValue(undefined),
    bundle: b,
  };
});

vi.mock("../hooks/useTelemetry", () => ({
  useTelemetry: () => ({ emit: emitMock, flush: flushMock }),
  getTelemetryEndpoint: (x: string | null) => x,
  getTelemetryCourseToken: (x: string) => x,
}));

vi.mock("../lib/tauri", () => ({
  tauri: {
    loadBundle: vi.fn().mockResolvedValue(bundle),
    loadState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    getPseudonyme: vi.fn().mockResolvedValue("pseudo-1"),
  },
}));

function renderAt(path = "/lesson/demo-001") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/lesson/:lessonId" element={<LessonPlayer />} />
        <Route path="/lesson/:lessonId/summary" element={<div>SUMMARY</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LessonPlayer telemetry", () => {
  beforeEach(() => {
    emitMock.mockReset();
    flushMock.mockClear();
  });

  it("emits lesson_started once when the bundle is loaded", async () => {
    renderAt();
    await waitFor(() => {
      const call = emitMock.mock.calls.find((c) => c[0].type === "lesson_started");
      expect(call).toBeTruthy();
      expect(call![0]).toEqual(
        expect.objectContaining({
          type: "lesson_started",
          bundle_uri: expect.any(String),
        }),
      );
    });
    // ensure it does not double-emit
    await new Promise((r) => setTimeout(r, 20));
    const starts = emitMock.mock.calls.filter((c) => c[0].type === "lesson_started");
    expect(starts).toHaveLength(1);
  });

  it("emits scene_entered for the initial scene", async () => {
    renderAt();
    await waitFor(() => {
      const call = emitMock.mock.calls.find(
        (c) => c[0].type === "scene_entered" && c[0].scene_id === "s_intro",
      );
      expect(call).toBeTruthy();
      expect(call![0]).toEqual(
        expect.objectContaining({
          type: "scene_entered",
          scene_id: "s_intro",
          scene_type: "intro",
        }),
      );
    });
  });

  it("emits scene_entered for each scene visited and lesson_completed at the end", async () => {
    renderAt();
    await waitFor(() => screen.getByText(/Bienvenue/));
    // Click Continue on intro → next scene
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    await waitFor(() => screen.getByText(/Contenu/));
    // Click Continue on last scene → lesson_completed + navigation to summary
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    await waitFor(() => screen.getByText("SUMMARY"));
    const enters = emitMock.mock.calls
      .filter((c) => c[0].type === "scene_entered")
      .map((c) => c[0].scene_id);
    expect(enters).toContain("s_intro");
    expect(enters).toContain("s_concept");
    const completed = emitMock.mock.calls.find((c) => c[0].type === "lesson_completed");
    expect(completed).toBeTruthy();
    expect(completed![0]).toEqual(
      expect.objectContaining({
        type: "lesson_completed",
        total_duration_ms: expect.any(Number),
        autonomy_ratio: expect.any(Number),
      }),
    );
  });
});

// Silence unused warning on defaultLearnerState if tree-shaking complains
void defaultLearnerState;
