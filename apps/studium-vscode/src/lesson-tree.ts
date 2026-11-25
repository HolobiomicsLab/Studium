// lesson-tree.ts — pure shaping of the Studium sidebar tree. No vscode import, so it is unit-testable in
// jsdom/tsx; src/tree.ts wraps these nodes in a vscode.TreeDataProvider.

import { approvalLabel, courseDescription, type LessonCourse } from "./lesson-picker.js";
import { phrase, type Locale } from "./phrases.js";
import { hostPhrase } from "./host-phrases.js";
import {
  continueArgs, continueTooltip, progressKey, reviewsNode, type ContinueLesson, type LessonProgress, type StudyStatus,
} from "./study-status.js";

/** One node of the Studium activity-bar tree. `command`(+`args`) runs on click; `children` nest. */
export interface TreeNode {
  id: string;
  label: string;
  description?: string;
  icon?: string; // a vscode codicon id (e.g. "play"); the provider maps it to a ThemeIcon
  tooltip?: string;
  command?: string;
  args?: unknown[];
  children?: TreeNode[];
}

/** A discovered community bundle the tree can open directly. */
export interface CommunityItem {
  ref: string;
  label: string;
}

function primary(locale: Locale): TreeNode[] {
  return [
    { id: "open", label: phrase("tree_open", {}, locale), icon: "play", command: "studium.openLesson", tooltip: phrase("tree_open_tooltip", {}, locale) },
    { id: "pick", label: phrase("tree_pick", {}, locale), icon: "library", command: "studium.pickLesson", tooltip: phrase("tree_pick_tooltip", {}, locale) },
    { id: "notebook", label: phrase("tree_notebook", {}, locale), icon: "notebook", command: "studium.openLessonNotebook" },
    { id: "walkthrough", label: phrase("tree_walkthrough", {}, locale), icon: "mortar-board", command: "studium.openWalkthrough" },
  ];
}

/** Build the sidebar tree from discovered courses and community contributions. Pure. */
export function buildLessonTree(opts: {
  courses?: readonly LessonCourse[];
  /** BN-1: the lessons of the library an assistant writes to, when the lessons folder is another one. */
  library?: readonly LessonCourse[];
  currentRef?: string;
  community: CommunityItem[];
  onReproductionScene: boolean;
  locale?: Locale;
  /** What is due for review (get_next_reinforcement); adds the Reviews node for a learner with history. */
  reviews?: StudyStatus | null;
  /** Return an empty tree when there is nothing to list, so the view's welcome content (buttons) shows
   * instead of a list of actions beside an empty "no course found" placeholder. */
  emptyAsWelcome?: boolean;
  /** BN-7: the lesson to continue (get_study_plan in_progress[0]); shown first, and it keeps the tree. */
  continueWith?: ContinueLesson | null;
  /** BN-7: each listed lesson's progress, keyed by progressKey(source, ref). */
  progress?: Readonly<Record<string, LessonProgress>>;
  /** BN-7: which source `courses` come from: the lessons folder, or the library when the two are the same folder. */
  coursesSource?: "bundles" | "library";
}): TreeNode[] {
  const locale = opts.locale ?? "fr";
  const reviews = reviewsNode(opts.reviews ?? null, locale);
  if (opts.emptyAsWelcome && !(opts.courses?.length) && !(opts.library?.length) && !opts.community.length && !opts.onReproductionScene && !reviews
    && !opts.continueWith) {
    return [];
  }
  const progress = opts.progress ?? {};
  const coursesSource = opts.coursesSource ?? "bundles";
  const nodes: TreeNode[] = opts.continueWith ? [continueNode(opts.continueWith, locale)] : [];
  nodes.push(...primary(locale));
  if (reviews) nodes.push(reviews);
  if (opts.onReproductionScene) {
    nodes.push({ id: "run", label: phrase("tree_run", {}, locale), icon: "beaker", command: "studium.runReproduction" });
  }
  nodes.push(coursesNode(opts.courses ?? [], opts.currentRef ?? "", locale, (ref) => progress[progressKey(coursesSource, ref)]));
  if (opts.library?.length) nodes.push(libraryNode(opts.library, locale, (ref) => progress[progressKey("library", ref)]));
  nodes.push(communityNode(opts.community, locale));
  return nodes;
}

/** BN-7: « Continue: <lesson> », the next step and the minutes left; it resumes the lesson from its own root. */
function continueNode(c: ContinueLesson, locale: Locale): TreeNode {
  const step = hostPhrase("tree_continue_step", { step: c.done + 1, total: c.total }, locale);
  const minutes = c.minutesLeft === null ? "" : hostPhrase("tree_continue_minutes", { minutes: c.minutesLeft }, locale);
  return {
    id: "continue",
    label: hostPhrase("tree_continue", { title: c.title }, locale),
    description: [step, minutes].filter(Boolean).join(" · "),
    icon: "debug-continue",
    tooltip: continueTooltip(c, locale),
    command: "studium.openLesson",
    args: continueArgs(c),
  };
}

type ProgressOf = (ref: string) => LessonProgress | undefined;

/** The available-courses subtree, including an explicit placeholder for an empty root. */
function coursesNode(courses: readonly LessonCourse[], currentRef: string, locale: Locale, progressOf: ProgressOf): TreeNode {
  const children = courses.map((course) => courseNode(course, course.ref === currentRef, locale, progressOf(course.ref)));
  return {
    id: "courses",
    label: phrase("tree_courses", {}, locale),
    icon: "library",
    children: children.length ? children : [{ id: "courses:empty", label: phrase("tree_no_courses", {}, locale), icon: "info" }],
  };
}

/** BN-7: a lesson's progress after its description in the tree only (the picker keeps courseDescription): « n/N » while
 * in progress, « done » once completed (no review date: no payload gives one per lesson). */
function progressSuffix(progress: LessonProgress | undefined, locale: Locale): string {
  if (!progress) return "";
  if (progress.state === "completed") return ` · ${hostPhrase("tree_done", {}, locale)}`;
  return ` · ${progress.done}/${progress.total}`;
}

function courseNode(course: LessonCourse, isCurrent: boolean, locale: Locale, progress?: LessonProgress): TreeNode {
  const current = isCurrent ? phrase("tree_current", {}, locale) : "";
  return {
    id: `course:${course.ref}`,
    label: course.title,
    description: `${courseDescription(course)}${progressSuffix(progress, locale)}`,
    icon: isCurrent ? "check" : "book",
    tooltip: `${course.ref}\n${approvalLabel(course.approval, locale)}${current}`,
    command: "studium.openLesson",
    args: [course.ref],
  };
}

/** BN-1: « Your library », the lessons an assistant wrote for the learner; each leaf opens from the library. */
function libraryNode(courses: readonly LessonCourse[], locale: Locale, progressOf: ProgressOf): TreeNode {
  return {
    id: "library",
    label: phrase("tree_library", {}, locale),
    icon: "book",
    children: courses.map((course) => ({ ...courseNode(course, false, locale, progressOf(course.ref)), id: `library:${course.ref}`, args: [course.ref, "library"] })),
  };
}

/** The community subtree — one openable leaf per discovered bundle, or a single placeholder when none. */
function communityNode(community: CommunityItem[], locale: Locale): TreeNode {
  const children: TreeNode[] = community.map((c) => ({
    id: "community:" + c.ref,
    label: c.label,
    icon: "file-code",
    command: "studium.openLesson",
    args: [c.ref, "community"],
    tooltip: c.ref,
  }));
  return {
    id: "community",
    label: phrase("tree_community", {}, locale),
    icon: "organization",
    children: children.length ? children : [{ id: "community:empty", label: phrase("tree_no_community", {}, locale), icon: "info" }],
  };
}
