/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import StudyShell from "./StudyShell";

afterEach(cleanup);
it("opens the next screen at its top after a long previous screen", () => {
  document.documentElement.scrollTop = 600;
  document.body.scrollTop = 600;
  render(<MemoryRouter><StudyShell><main>Next screen</main></StudyShell></MemoryRouter>);
  expect(document.documentElement.scrollTop).toBe(0);
  expect(document.body.scrollTop).toBe(0);
});
