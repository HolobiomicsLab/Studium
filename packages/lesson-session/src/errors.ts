// packages/lesson-session/src/errors.ts
export class SessionError extends Error {}

export class SessionNotStartedError extends SessionError {
  constructor() { super("session not started — call start() first"); this.name = "SessionNotStartedError"; }
}
export class SessionAlreadyCompleteError extends SessionError {
  constructor() { super("session already complete"); this.name = "SessionAlreadyCompleteError"; }
}
export class SceneGradingError extends SessionError {
  constructor(public readonly sceneType: string, public readonly reason: string) {
    super(`grading failed for scene type "${sceneType}": ${reason}`);
    this.name = "SceneGradingError";
  }
}
