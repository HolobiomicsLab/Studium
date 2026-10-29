// lesson-tree.ts — pure shaping of the Studium sidebar tree. No vscode import, so it is unit-testable in
// jsdom/tsx; src/tree.ts wraps these nodes in a vscode.TreeDataProvider.

import { courseDescription, type LessonCourse } from "./lesson-picker.js";

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

const PRIMARY: TreeNode[] = [
  { id: "open", label: "Commencer la leçon / Start the lesson", icon: "play", command: "studium.openLesson", tooltip: "Ouvrir la leçon dans le panneau Studium" },
  { id: "pick", label: "Choisir un cours / Pick a course", icon: "library", command: "studium.pickLesson", tooltip: "Choisir parmi les cours disponibles ou changer de dossier" },
  { id: "notebook", label: "Ouvrir comme notebook / Open as notebook", icon: "notebook", command: "studium.openLessonNotebook" },
  { id: "walkthrough", label: "Prise en main / Getting started", icon: "mortar-board", command: "studium.openWalkthrough" },
];

/** Build the sidebar tree from discovered courses and community contributions. Pure. */
export function buildLessonTree(opts: {
  courses?: readonly LessonCourse[];
  currentRef?: string;
  community: CommunityItem[];
  onReproductionScene: boolean;
}): TreeNode[] {
  const nodes: TreeNode[] = [...PRIMARY];
  if (opts.onReproductionScene) {
    nodes.push({ id: "run", label: "Lancer la reproduction / Run reproduction", icon: "beaker", command: "studium.runReproduction" });
  }
  nodes.push(coursesNode(opts.courses ?? [], opts.currentRef ?? ""));
  nodes.push(communityNode(opts.community));
  return nodes;
}

/** The available-courses subtree, including an explicit placeholder for an empty root. */
function coursesNode(courses: readonly LessonCourse[], currentRef: string): TreeNode {
  const children = courses.map((course) => courseNode(course, course.ref === currentRef));
  return {
    id: "courses",
    label: "Cours disponibles / Courses",
    icon: "library",
    children: children.length ? children : [{ id: "courses:empty", label: "— aucun cours trouvé / no courses found —", icon: "info" }],
  };
}

function courseNode(course: LessonCourse, isCurrent: boolean): TreeNode {
  const current = isCurrent ? "\n✓ cours actuel / current course" : "";
  return {
    id: `course:${course.ref}`,
    label: course.title,
    description: courseDescription(course),
    icon: isCurrent ? "check" : "book",
    tooltip: `${course.ref}\nvalidated_by: ${course.validatedBy}${current}`,
    command: "studium.openLesson",
    args: [course.ref],
  };
}

/** The community subtree — one openable leaf per discovered bundle, or a single placeholder when none. */
function communityNode(community: CommunityItem[]): TreeNode {
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
    label: "Contributions de la classe / Community",
    icon: "organization",
    children: children.length ? children : [{ id: "community:empty", label: "— aucune pour l'instant / none yet —", icon: "info" }],
  };
}
