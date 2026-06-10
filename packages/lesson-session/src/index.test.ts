import { describe, it, expect } from "vitest";
import type { Presentation, Transition, SessionDeps, StateStore, EventLog } from "./index.js";
import { PACKAGE_NAME, LessonSession, grade, SceneGradingError } from "./index.js";

describe("lesson-session package", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@studium/lesson-session");
  });

  it("exports LessonSession as a constructor function", () => {
    expect(typeof LessonSession).toBe("function");
  });

  it("exports grade as a function", () => {
    expect(typeof grade).toBe("function");
  });

  it("exports SceneGradingError as an Error subclass", () => {
    const err = new SceneGradingError("quiz", "x");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SceneGradingError);
    expect(err.sceneType).toBe("quiz");
    expect(err.reason).toBe("x");
  });
});

// Compile-time type checks — these imports will fail tsc if the types are not exported.
// They are unused at runtime; the test suite above covers the values.
type _Presentation = Presentation;
type _Transition = Transition;
type _SessionDeps = SessionDeps;
type _StateStore = StateStore;
type _EventLog = EventLog;
