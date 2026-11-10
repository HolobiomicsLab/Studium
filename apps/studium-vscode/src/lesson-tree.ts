// lesson-tree.ts — pure shaping of the Studium sidebar tree. No vscode import, so it is unit-testable in
// jsdom/tsx; src/tree.ts wraps these nodes in a vscode.TreeDataProvider.

import { approvalLabel, courseDescription, type LessonCourse } from "./lesson-picker.js";
import { phrase, type Locale } from "./phrases.js";
import { reviewsNode, type StudyStatus } from "./study-status.js";

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
  currentRef?: string;
  community: CommunityItem[];
  onReproductionScene: boolean;
  locale?: Locale;
  /** What is due for review (get_next_reinforcement); adds the Reviews node for a learner with history. */
  reviews?: StudyStatus | null;
  /** Return an empty tree when there is nothing to list, so the view's welcome content (buttons) shows
   * instead of a list of actions beside an empty "no course found" placeholder. */
  emptyAsWelcome?: boolean;
}): TreeNode[] {
  const locale = opts.locale ?? "fr";
  const reviews = reviewsNode(opts.reviews ?? null, locale);
  if (opts.emptyAsWelcome && !(opts.courses?.length) && !opts.community.length && !opts.onReproductionScene && !reviews) {
    return [];
  }
  const nodes: TreeNode[] = primary(locale);
  if (reviews) nodes.push(reviews);
  if (opts.onReproductionScene) {
    nodes.push({ id: "run", label: phrase("tree_run", {}, locale), icon: "beaker", command: "studium.runReproduction" });
  }
  nodes.push(coursesNode(opts.courses ?? [], opts.currentRef ?? "", locale));
  nodes.push(communityNode(opts.community, locale));
  return nodes;
}

/** The available-courses subtree, including an explicit placeholder for an empty root. */
function coursesNode(courses: readonly LessonCourse[], currentRef: string, locale: Locale): TreeNode {
  const children = courses.map((course) => courseNode(course, course.ref === currentRef, locale));
  return {
    id: "courses",
    label: phrase("tree_courses", {}, locale),
    icon: "library",
    children: children.length ? children : [{ id: "courses:empty", label: phrase("tree_no_courses", {}, locale), icon: "info" }],
  };
}

function courseNode(course: LessonCourse, isCurrent: boolean, locale: Locale): TreeNode {
  const current = isCurrent ? phrase("tree_current", {}, locale) : "";
  return {
    id: `course:${course.ref}`,
    label: course.title,
    description: courseDescription(course),
    icon: isCurrent ? "check" : "book",
    tooltip: `${course.ref}\n${approvalLabel(course.approval, locale)}${current}`,
    command: "studium.openLesson",
    args: [course.ref],
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
