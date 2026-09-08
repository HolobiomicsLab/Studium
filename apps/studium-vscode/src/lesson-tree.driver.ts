// lesson-tree.driver.ts — unit test for the pure sidebar-tree shaping (buildLessonTree). No vscode APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/lesson-tree.driver.ts
import { buildLessonTree, type TreeNode } from "./lesson-tree.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }
const byId = (nodes: TreeNode[], id: string) => nodes.find((n) => n.id === id);

// 1) primary actions are always present and carry their command.
{
  const t = buildLessonTree({ community: [], onReproductionScene: false });
  expect(byId(t, "open")?.command === "studium.openLesson", "tree has an Open Lesson action");
  expect(byId(t, "notebook")?.command === "studium.openLessonNotebook", "tree has an Open-as-notebook action");
  expect(byId(t, "walkthrough")?.command === "studium.openWalkthrough", "tree has a Getting-started action");
  expect(!byId(t, "run"), "no run action when no reproduction scene is live");
}

// 2) the run action appears only while a reproduction scene is live.
{
  const t = buildLessonTree({ community: [], onReproductionScene: true });
  expect(byId(t, "run")?.command === "studium.runReproduction", "run action appears on a reproduction scene");
}

// 3) community subtree: discovered bundles each open directly; empty → a single placeholder leaf.
{
  const t = buildLessonTree({ community: [{ ref: "c/a.json", label: "Item A" }, { ref: "c/b.json", label: "Item B" }], onReproductionScene: false });
  const community = byId(t, "community");
  expect(community?.children?.length === 2, "community lists one leaf per discovered bundle");
  const first = community?.children?.[0];
  expect(first?.command === "studium.openLesson" && (first?.args?.[0]) === "c/a.json", "a community leaf opens its own ref via openLesson");

  const empty = byId(buildLessonTree({ community: [], onReproductionScene: false }), "community");
  expect(empty?.children?.length === 1 && empty?.children?.[0]?.id === "community:empty", "empty community shows a placeholder leaf, not nothing");
  expect(!empty?.children?.[0]?.command, "the placeholder leaf is not clickable");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} lesson-tree assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — lesson-tree (sidebar shaping) passed all ${checks} assertions.`);
