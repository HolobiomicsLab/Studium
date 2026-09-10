/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LessonPlayer from "./LessonPlayer";

vi.mock("../lib/tauri", () => ({ tauri: { loadBundle: vi.fn().mockRejectedValue("lesson.json absent") } }));
afterEach(cleanup);

it("reports a native string error instead of leaving the learner waiting forever", async () => {
  render(<MemoryRouter initialEntries={["/lesson/test?bundle=/tmp/unreadable.zip"]}>
    <Routes><Route path="/lesson/:lessonId" element={<LessonPlayer />} /></Routes>
  </MemoryRouter>);
  expect((await screen.findByRole("alert")).textContent).toContain("lesson.json absent");
  expect(screen.getByRole("button", { name: "Retour à la bibliothèque" })).toBeTruthy();
  expect(screen.queryByText("Chargement de la leçon…")).toBeNull();
});
