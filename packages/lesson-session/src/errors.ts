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
/** C4 / L-9: a self-rating for a scene whose last answer DID ask for one, in a state saved by a server
 * that kept the request in memory only — it expired with that process. Distinct from "not requested". */
export class SelfRatingExpiredError extends SessionError {
  constructor(public readonly sceneId: string) {
    super(`the self-rating requested for scene "${sceneId}" expired with the previous server process (it was not saved); answer the scene again to be asked anew`);
    this.name = "SelfRatingExpiredError";
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
