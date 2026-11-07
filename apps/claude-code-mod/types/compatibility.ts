import type { PanelView as CorePanelView } from "../../../packages/lesson-panel/src/view.js";
import type { StudiumPanelView } from "./index.js";

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type Assert<Condition extends true> = Condition;

/** Compile-time drift guard between P1's contract and this native plugin declaration. */
export type StudiumPanelAcceptsCore = Assert<IsAssignable<CorePanelView, StudiumPanelView>>;
/** Compile-time drift guard in the other direction, so neither side silently widens. */
export type CorePanelAcceptsStudium = Assert<IsAssignable<StudiumPanelView, CorePanelView>>;
