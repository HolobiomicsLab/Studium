// lesson-tree.driver.ts — unit test for the pure sidebar-tree shaping (buildLessonTree). No vscode APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/lesson-tree.driver.ts
import { buildLessonTree, type TreeNode } from "./lesson-tree.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }
const byId = (nodes: TreeNode[], id: string) => nodes.find((n) => n.id === id);

// 1) primary actions are always present and carry their command.
{
  const t = buildLessonTree({ courses: [], currentRef: "", community: [], onReproductionScene: false });
  expect(byId(t, "open")?.command === "studium.openLesson", "tree has an Open Lesson action");
  expect(byId(t, "pick")?.command === "studium.pickLesson", "tree has a Pick a course action");
  expect(byId(t, "notebook")?.command === "studium.openLessonNotebook", "tree has an Open-as-notebook action");
  expect(byId(t, "walkthrough")?.command === "studium.openWalkthrough", "tree has a Getting-started action");
  expect(!byId(t, "run"), "no run action when no reproduction scene is live");
}

// 2) the run action appears only while a reproduction scene is live.
{
  const t = buildLessonTree({ courses: [], currentRef: "", community: [], onReproductionScene: true });
  expect(byId(t, "run")?.command === "studium.runReproduction", "run action appears on a reproduction scene");
}

// 3) community subtree: discovered bundles each open directly; empty → a single placeholder leaf.
{
  const t = buildLessonTree({ courses: [], currentRef: "", community: [{ ref: "c/a.json", label: "Item A" }, { ref: "c/b.json", label: "Item B" }], onReproductionScene: false });
  const community = byId(t, "community");
  expect(community?.children?.length === 2, "community lists one leaf per discovered bundle");
  const first = community?.children?.[0];
  expect(first?.command === "studium.openLesson" && (first?.args?.[0]) === "c/a.json", "a community leaf opens its own ref via openLesson");

  const empty = byId(buildLessonTree({ courses: [], currentRef: "", community: [], onReproductionScene: false }), "community");
  expect(empty?.children?.length === 1 && empty?.children?.[0]?.id === "community:empty", "empty community shows a placeholder leaf, not nothing");
  expect(!empty?.children?.[0]?.command, "the placeholder leaf is not clickable");
}

// 4) courses subtree: metadata shapes each leaf, the configured ref is current, and empty roots remain visible.
{
  const courses = [
    { ref: "alpha/lesson.json", title: "Cours Alpha", target: "L1", language: "fr", validatedBy: "Prof. Alpha" },
    { ref: "beta/lesson.json", title: "Course Beta", target: "M1", language: "en", validatedBy: "Teacher Beta" },
  ];
  const t = buildLessonTree({ courses, currentRef: "beta/lesson.json", community: [], onReproductionScene: false });
  const available = byId(t, "courses");
  expect(available?.label === "Cours disponibles / Courses", "tree has the bilingual courses subtree");
  expect(available?.children?.length === 2, "courses subtree lists one leaf per discovered course");
  const alpha = available?.children?.[0];
  const beta = available?.children?.[1];
  expect(alpha?.label === "Cours Alpha", "course leaf label is metadata.title");
  expect(alpha?.description === "L1 · fr", "course leaf description is target and language");
  expect(!!alpha?.tooltip?.includes("alpha/lesson.json") && alpha.tooltip.includes("Prof. Alpha"), "course tooltip includes ref and validated_by");
  expect(alpha?.command === "studium.openLesson" && alpha.args?.[0] === "alpha/lesson.json", "course leaf opens its ref override");
  expect(beta?.icon === "check", "configured bundleRef is marked as current");

  const empty = byId(buildLessonTree({ courses: [], currentRef: "", community: [], onReproductionScene: false }), "courses");
  expect(empty?.children?.length === 1 && empty.children[0]?.id === "courses:empty", "empty bundles root shows a courses placeholder");
  expect(!empty?.children?.[0]?.command, "empty courses placeholder is not clickable");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} lesson-tree assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — lesson-tree (sidebar shaping) passed all ${checks} assertions.`);
