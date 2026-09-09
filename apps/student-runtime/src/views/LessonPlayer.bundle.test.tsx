/**
 * @vitest-environment jsdom
 */
// INT-STUDIUM-034 — the player plays the bundle it is given.
//
// `LessonPlayer` loaded `BUNDLE_PATH = "fixtures/m3/demo-metabolomics-bundle.zip"`, a module
// constant, and used the `lessonId` route parameter only as a key for saved state. So the
// runtime could open exactly one bundle, chosen when the binary was compiled, whatever the
// library offered and whatever the URL said.
//
// The intent is explicit that adding the missing `data-testid` attributes alone is NOT
// acceptable — it would make the selectors resolve, move the failure one line down onto the
// scene assertions, and read as progress. So the two are tested together here: the marker the
// harnesses wait for, and the bundle underneath it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LessonPlayer from "./LessonPlayer";
import type { LessonBundle } from "@studium/lesson-bundle-schema";

afterEach(cleanup);

const { loadBundleMock, bundleFor } = vi.hoisted(() => {
  const make = (id: string, title: string): LessonBundle => ({
    schema_version: "1.4",
    bundle_id: id,
    source_plan_id: "plan-001",
    metadata: {
      title,
      target: "L1",
      duration_minutes: 10,
      language: "fr",
      discipline: "science",
    },
    concepts: [
      { id: "c1", title: "C1", description: "...", bloom_level_target: "understand" },
    ],
    scenes: [
      {
        id: "s_intro",
        type: "intro",
        title: "Intro",
        markdown: `MARKDOWN-${id}`,
        objective_refs: [],
        concept_refs: ["c1"],
        estimated_seconds: 30,
        adaptation_hooks: [],
      },
    ],
    rules: [],
    validated_by: "tester",
    validated_at: "2026-05-12T00:00:00Z",
  });
  return {
    loadBundleMock: vi.fn(),
    bundleFor: make,
  };
});

vi.mock("../hooks/useTelemetry", () => ({
  useTelemetry: () => ({ emit: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }),
  getTelemetryEndpoint: (x: string | null) => x,
  resolveTelemetryEndpoint: (_c: unknown, x: string | null) => x,
  getTelemetryCourseToken: (x: string) => x,
}));

vi.mock("../lib/tauri", () => ({
  tauri: {
    loadBundle: loadBundleMock,
    loadState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    getPseudonyme: vi.fn().mockResolvedValue("pseudo-1"),
    // The player reads the consent record before it transmits (INT-STUDIUM-030);
    // this suite is about a different behaviour, so the grant is simply present.
    getConsent: vi.fn().mockResolvedValue({ level_a: true, level_b: true, level_c: false }),
  },
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>LIBRARY</div>} />
        <Route path="/lesson/:lessonId" element={<LessonPlayer />} />
        <Route path="/lesson/:lessonId/summary" element={<div>SUMMARY</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  loadBundleMock.mockReset().mockImplementation(async (p: string) =>
    p.includes("atomistique")
      ? bundleFor("atomistique-l1", "Atomistique L1")
      : bundleFor("demo-metabolomics-001", "Métabolomique"),
  );
});

describe("LessonPlayer bundle selection", () => {
  it("loads the bundle named in the URL, not a module constant", async () => {
    renderAt(
      "/lesson/atomistique-l1?bundle=" +
        encodeURIComponent("/tmp/studium-e2e/demo-atomistique.zip"),
    );
    await waitFor(() =>
      expect(loadBundleMock).toHaveBeenCalledWith("/tmp/studium-e2e/demo-atomistique.zip"),
    );
    expect(await screen.findByText(/MARKDOWN-atomistique-l1/)).toBeTruthy();
  });

  it("carries the lesson-player marker the four E2E harnesses wait for", async () => {
    const { container } = renderAt(
      "/lesson/atomistique-l1?bundle=" + encodeURIComponent("/x/demo-atomistique.zip"),
    );
    await waitFor(() =>
      expect(container.querySelector("[data-testid='lesson-player']")).toBeTruthy(),
    );
  });

  it("plays a DIFFERENT bundle when a different one is named", async () => {
    // The regression this guards: a marker added to markup that still loads one fixed file
    // would satisfy the selector and play the wrong lesson.
    renderAt("/lesson/demo-metabolomics-001?bundle=" + encodeURIComponent("/x/metabo.zip"));
    expect(await screen.findByText(/MARKDOWN-demo-metabolomics-001/)).toBeTruthy();
    expect(loadBundleMock).toHaveBeenCalledWith("/x/metabo.zip");
  });

  it("sends the learner back to the library when no bundle is named", async () => {
    // Not a silent fallback to a built-in fixture: that is the defect, and it would play a
    // lesson nobody asked for.
    const { container } = renderAt("/lesson/atomistique-l1");
    await waitFor(() => expect(container.textContent).toMatch(/bibliothèque/i));
    expect(loadBundleMock).not.toHaveBeenCalled();
  });

  it("names an unreadable bundle instead of hanging on 'Chargement'", async () => {
    loadBundleMock.mockRejectedValue(new Error("lesson.json missing in bundle"));
    renderAt("/lesson/x?bundle=" + encodeURIComponent("/x/broken.zip"));
    await waitFor(() => expect(screen.queryByText(/lesson.json missing/)).toBeTruthy());
  });
});
