import type { PanelActionName } from "./view.js";

/** Every type of panel action (PanelActionSchema) an adapter between a surface and the server must
 * transport: to `panel_action`, or to the host's own picker or confirmation for `pickCourse` and `end`.
 * `satisfies` names each type once and no other, so a type added to the schema fails to compile here
 * until it is listed; the list holds no runtime import, so a browser bundle takes no schema with it. */
const TRANSPORTED = {
  respond: true, turn: true, hint: true, rateRecall: true, reviewNow: true, restartLesson: true, end: true, pickCourse: true,
  ask: true, setAttention: true, setLanguage: true, replan: true, openMap: true, closeMap: true, contest: true, prompt: true,
} as const satisfies Record<PanelActionName, true>;

export const PANEL_ACTION_TYPES: readonly PanelActionName[] = Object.freeze(Object.keys(TRANSPORTED) as PanelActionName[]);
