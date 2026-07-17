// lesson-tree.ts — pure shaping of the Studium sidebar tree. No vscode import, so it is unit-testable in
// jsdom/tsx; src/tree.ts wraps these nodes in a vscode.TreeDataProvider.

/** One node of the Studium activity-bar tree. `command`(+`args`) runs on click; `children` nest. */
export interface TreeNode {
  id: string;
  label: string;
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
  { id: "notebook", label: "Ouvrir comme notebook / Open as notebook", icon: "notebook", command: "studium.openLessonNotebook" },
  { id: "walkthrough", label: "Prise en main / Getting started", icon: "mortar-board", command: "studium.openWalkthrough" },
];

/** Build the sidebar tree: the primary actions, a run action only while a reproduction scene is live, and
 *  a community subtree listing discovered classmate contributions (each opens directly). Pure. */
export function buildLessonTree(opts: { community: CommunityItem[]; onReproductionScene: boolean }): TreeNode[] {
  const nodes: TreeNode[] = [...PRIMARY];
  if (opts.onReproductionScene) {
    nodes.push({ id: "run", label: "Lancer la reproduction / Run reproduction", icon: "beaker", command: "studium.runReproduction" });
  }
  nodes.push(communityNode(opts.community));
  return nodes;
}

/** The community subtree — one openable leaf per discovered bundle, or a single placeholder when none. */
function communityNode(community: CommunityItem[]): TreeNode {
  const children: TreeNode[] = community.map((c) => ({
    id: "community:" + c.ref,
    label: c.label,
    icon: "file-code",
    command: "studium.openLesson",
    args: [c.ref],
    tooltip: c.ref,
  }));
  return {
    id: "community",
    label: "Contributions de la classe / Community",
    icon: "organization",
    children: children.length ? children : [{ id: "community:empty", label: "— aucune pour l'instant / none yet —", icon: "info" }],
  };
}
