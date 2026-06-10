// packages/lesson-session/src/errors.test.ts
import { describe, it, expect } from "vitest";
import { SceneGradingError, SessionNotStartedError, SessionAlreadyCompleteError } from "./errors.js";

describe("domain errors", () => {
  it("SceneGradingError carries scene type + reason", () => {
    const e = new SceneGradingError("quiz", "expected quiz_choice");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("SceneGradingError");
    expect(e.sceneType).toBe("quiz");
    expect(e.message).toContain("quiz");
    expect(e.message).toContain("expected quiz_choice");
  });
  it("lifecycle errors have stable names", () => {
    expect(new SessionNotStartedError().name).toBe("SessionNotStartedError");
    expect(new SessionAlreadyCompleteError().name).toBe("SessionAlreadyCompleteError");
  });
});
