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

const { emitMock, flushMock, bundle, getConsentMock } = vi.hoisted(() => {
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
    // Hoisted with the rest: `vi.mock` factories run before module-level statements, and the
    // consent record is read by the module under test at mount.
    getConsentMock: vi.fn().mockResolvedValue({ level_a: true, level_b: true, level_c: false }),
  };
});

// Only `useTelemetry` is replaced. `resolveTelemetryEndpoint` stays REAL: it is the consent
// gate under test below, and a stub for it would make the assertions measure the stub
// (INT-STUDIUM-030). The options the player passes are captured instead.
let lastTelemetryOptions: { endpoint: string | null; context: { learner_pseudonym: string } } | null =
  null;
vi.mock("../hooks/useTelemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useTelemetry")>();
  return {
    ...actual,
    useTelemetry: (opts: typeof lastTelemetryOptions) => {
      lastTelemetryOptions = opts;
      return { emit: emitMock, flush: flushMock };
    },
  };
});

vi.mock("../lib/tauri", () => ({
  tauri: {
    loadBundle: vi.fn().mockResolvedValue(bundle),
    loadState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    getPseudonyme: vi.fn().mockResolvedValue("pseudo-1"),
    getConsent: getConsentMock,
  },
}));

// `?bundle=` is now required: the player plays what it is given rather than a module constant
// (INT-STUDIUM-034). These telemetry assertions are unchanged — only the route says which
// bundle they are about.
function renderAt(path = "/lesson/demo-001?bundle=/fixtures/demo.zip") {
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

describe("LessonPlayer — what the consent screen promised", () => {
  const w = window as unknown as { __telemetry_endpoint?: string };

  afterEach(() => {
    delete w.__telemetry_endpoint;
    getConsentMock.mockResolvedValue({ level_a: true, level_b: true, level_c: false });
  });

  it("transmits nowhere until the learner has granted it, override or not", async () => {
    // The override is what a deployment and the E2E harness set. It used to be enough on its
    // own: the player passed `getTelemetryEndpoint(null)` and never read the record.
    w.__telemetry_endpoint = "http://localhost:8003/telemetry";
    getConsentMock.mockResolvedValue({ level_a: true, level_b: false, level_c: false });
    renderAt();
    await waitFor(() => screen.getByText(/Bienvenue/));
    await waitFor(() => expect(getConsentMock).toHaveBeenCalled());
    await waitFor(() => expect(lastTelemetryOptions?.endpoint).toBeNull());
  });

  it("transmits under the learner's OWN per-lesson pseudonym once granted", async () => {
    w.__telemetry_endpoint = "http://localhost:8003/telemetry";
    renderAt();
    await waitFor(() => screen.getByText(/Bienvenue/));
    await waitFor(() =>
      expect(lastTelemetryOptions?.endpoint).toBe("http://localhost:8003/telemetry"));
    // `pseudonyme.rs` computes HMAC(secret, lesson_id) and exposes it as `get_pseudonyme`.
    // The player used to send the literal "anonymous" instead — the same value for every
    // learner, which is neither a pseudonym nor anonymity.
    expect(lastTelemetryOptions?.context.learner_pseudonym).toBe("pseudo-1");
    expect(lastTelemetryOptions?.context.learner_pseudonym).not.toBe("anonymous");
  });

  it("a consent read that fails transmits nothing rather than falling back to open", async () => {
    w.__telemetry_endpoint = "http://localhost:8003/telemetry";
    getConsentMock.mockRejectedValue(new Error("store locked"));
    renderAt();
    await waitFor(() => screen.getByText(/Bienvenue/));
    await waitFor(() => expect(getConsentMock).toHaveBeenCalled());
    await waitFor(() => expect(lastTelemetryOptions?.endpoint).toBeNull());
  });
});

// Silence unused warning on defaultLearnerState if tree-shaking complains
void defaultLearnerState;
