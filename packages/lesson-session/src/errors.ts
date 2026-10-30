// packages/lesson-session/src/errors.ts
export class SessionError extends Error {}

export class SessionNotStartedError extends SessionError {
  constructor() { super("session not started — call start() first"); this.name = "SessionNotStartedError"; }
}
export class SessionAlreadyCompleteError extends SessionError {
  constructor() { super("session already complete"); this.name = "SessionAlreadyCompleteError"; }
}
/** C4: a self-rating for a scene whose last answer did not ask for one (certified, or already rated). */
export class SelfRatingNotRequestedError extends SessionError {
  constructor(public readonly sceneId: string) {
    super(`no self-rating was requested for scene "${sceneId}" (only an uncertified production answer asks for one, once)`);
    this.name = "SelfRatingNotRequestedError";
  }
}
export class InvalidSelfRatingError extends SessionError {
  constructor(public readonly grade: string) {
    super(`invalid self-rating "${grade}": expected one of again|hard|good|easy`);
    this.name = "InvalidSelfRatingError";
  }
}
export class SceneGradingError extends SessionError {
  constructor(public readonly sceneType: string, public readonly reason: string) {
    super(`grading failed for scene type "${sceneType}": ${reason}`);
    this.name = "SceneGradingError";
  }
}
