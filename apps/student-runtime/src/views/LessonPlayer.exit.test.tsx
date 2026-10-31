/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LessonPlayer from "./LessonPlayer";

const { flush } = vi.hoisted(() => ({ flush: vi.fn() }));
vi.mock("../hooks/useTelemetry", async (original) => ({
  ...await original<typeof import("../hooks/useTelemetry")>(),
  useTelemetry: () => ({ emit: vi.fn(), flush }),
}));
vi.mock("../lib/tauri", async () => {
  const { default: bundle } = await import("../../../../fixtures/m3/demo-metabolomics/lesson.json");
  return { tauri: {
    loadBundle: vi.fn().mockResolvedValue(bundle), loadState: vi.fn().mockResolvedValue(null),
    getPseudonyme: vi.fn().mockResolvedValue("synthetic-exit-test"),
    getConsent: vi.fn().mockResolvedValue({ level_a: true, level_b: true, level_c: false }),
    saveState: vi.fn(), appendEvent: vi.fn(),
  } };
});
afterEach(cleanup);

it("flushes pending telemetry before unmounting on a confirmed exit", async () => {
  let release!: () => void;
  flush.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
  render(<MemoryRouter initialEntries={["/lesson/demo?bundle=/tmp/demo.zip"]}>
    <Routes>
      <Route path="/lesson/:lessonId" element={<LessonPlayer />} />
      <Route path="/library" element={<div>RETURNED</div>} />
    </Routes>
  </MemoryRouter>);
  await screen.findByTestId("lesson-player");
  fireEvent.click(screen.getByRole("button", { name: "Quitter la leçon" }));
  fireEvent.click(screen.getByRole("button", { name: "Quitter et revenir à la bibliothèque" }));
  expect(flush).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("RETURNED")).toBeNull();
  await act(async () => { release(); });
  expect(await screen.findByText("RETURNED")).toBeTruthy();
});
