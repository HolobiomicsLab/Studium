/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LessonExit from "./LessonExit";

afterEach(cleanup);
it("keeps the lesson mounted until the learner confirms leaving", () => {
  const onExit = vi.fn();
  render(<LessonExit onExit={onExit} />);
  fireEvent.click(screen.getByRole("button", { name: "Quitter la leçon" }));
  expect(onExit).not.toHaveBeenCalled();
  expect(screen.getByText(/réponse non envoyée sera perdue/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Rester dans la leçon" }));
  expect(onExit).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Quitter la leçon" })).toBe(document.activeElement);
  fireEvent.click(screen.getByRole("button", { name: "Quitter la leçon" }));
  fireEvent.click(screen.getByRole("button", { name: "Quitter et revenir à la bibliothèque" }));
  expect(onExit).toHaveBeenCalledTimes(1);
});
