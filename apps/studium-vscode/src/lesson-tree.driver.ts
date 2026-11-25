// lesson-tree.driver.ts — unit test for the pure sidebar-tree shaping (buildLessonTree). No vscode APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/lesson-tree.driver.ts
import { courseDescription, toLessonPickItems, type LessonCourse } from "./lesson-picker.js";
import { buildLessonTree, type TreeNode } from "./lesson-tree.js";
import { browserPhrases } from "./phrases.js";
import { hostPhrase } from "./host-phrases.js";
import { parseReinforcement, type ContinueLesson } from "./study-status.js";

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
  const courses: LessonCourse[] = [
    { ref: "alpha/lesson.json", title: "Cours Alpha", target: "L1", language: "fr", approval: { state: "approved", reviewer: "Prof. Alpha" } },
    { ref: "beta/lesson.json", title: "Course Beta", target: "M1", language: "en", approval: { state: "none" } },
  ];
  const t = buildLessonTree({ courses, currentRef: "beta/lesson.json", community: [], onReproductionScene: false });
  const available = byId(t, "courses");
  // Changed (VSC-5): the French label was slash-bilingual (« Cours disponibles / Courses »); labels are now
  // real translations, so the French tree says only « Cours disponibles ».
  expect(available?.label === "Cours disponibles", "tree has the French courses subtree (VSC-5: no slash-bilingual labels)");
  expect(available?.children?.length === 2, "courses subtree lists one leaf per discovered course");
  const alpha = available?.children?.[0];
  const beta = available?.children?.[1];
  expect(alpha?.label === "Cours Alpha", "course leaf label is metadata.title");
  expect(alpha?.description === "L1 · fr", "course leaf description is target and language");
  expect(!!alpha?.tooltip?.includes("alpha/lesson.json") && alpha.tooltip.includes("validée par Prof. Alpha"), "course tooltip includes ref and the approval state from the record");
  expect(beta?.tooltip?.includes("aucune approbation enregistrée") === true && !beta.tooltip.includes("validated_by"), "a course without a record says so, and the tooltip never prints validated_by");
  const betaEn = byId(buildLessonTree({ courses, currentRef: "", community: [], onReproductionScene: false, locale: "en" }), "courses")?.children?.[1];
  expect(betaEn?.tooltip?.includes("no approval recorded") === true, "the tooltip follows the locale");
  expect(alpha?.command === "studium.openLesson" && alpha.args?.[0] === "alpha/lesson.json", "course leaf opens its ref override");
  expect(beta?.icon === "check", "configured bundleRef is marked as current");

  const empty = byId(buildLessonTree({ courses: [], currentRef: "", community: [], onReproductionScene: false }), "courses");
  expect(empty?.children?.length === 1 && empty.children[0]?.id === "courses:empty", "empty bundles root shows a courses placeholder");
  expect(!empty?.children?.[0]?.command, "empty courses placeholder is not clickable");
}

// BN-1: when the lessons folder is not the library an assistant writes to (a checkout's fixtures/, or a folder the
// learner chose), a « Your library » group lists the library's lessons; each opens from the library (source "library").
{
  const mine: LessonCourse[] = [{ ref: "photosynthese/lesson.json", title: "La photosynthèse", target: "L1", language: "fr", approval: { state: "none" } }];
  const t = buildLessonTree({ courses: [], library: mine, currentRef: "", community: [], onReproductionScene: false, locale: "en" });
  const library = byId(t, "library");
  expect(!!library && library.label === browserPhrases("en").tree_library, `a « Your library » group is shown (got ${library?.label})`);
  const leaf = library?.children?.[0];
  expect(leaf?.label === "La photosynthèse" && leaf.command === "studium.openLesson"
    && JSON.stringify(leaf.args) === '["photosynthese/lesson.json","library"]', `a library leaf opens from the library (got ${JSON.stringify(leaf)})`);
  expect(buildLessonTree({ courses: [], library: mine, community: [], onReproductionScene: false, emptyAsWelcome: true }).length > 0,
    "a lesson in the library keeps the tree (no welcome view)");
  expect(!byId(buildLessonTree({ courses: [], library: [], community: [], onReproductionScene: false }), "library"), "an empty or absent library adds no group");
  expect(!byId(buildLessonTree({ courses: [], community: [], onReproductionScene: false }), "library"), "no library option: no group");
}

// BN-3: an empty lessons folder says where a lesson comes from, not « no courses found ».
{
  const empty = byId(buildLessonTree({ courses: [], currentRef: "", community: [], onReproductionScene: false, locale: "en" }), "courses");
  expect(/assistant/.test(empty?.children?.[0]?.label ?? "") && !/found/.test(empty?.children?.[0]?.label ?? ""),
    `the empty courses placeholder says an assistant's lesson appears here (got ${empty?.children?.[0]?.label})`);
}

// BN-7: « Continue » comes first, from get_study_plan in_progress[0]; it opens the lesson from its own root and resumes it.
{
  const cont: ContinueLesson = { ref: "discover-studium-en/lesson.json", title: "Discover Studium", done: 3, total: 12, source: "shipped", minutesLeft: 8 };
  const t = buildLessonTree({ courses: [], community: [], onReproductionScene: false, locale: "en", continueWith: cont });
  const first = t[0];
  expect(first?.id === "continue" && first.label === hostPhrase("tree_continue", { title: "Discover Studium" }, "en"),
    `the first entry is « Continue: <lesson> » (got ${JSON.stringify(first)})`);
  expect(first?.description === `${hostPhrase("tree_continue_step", { step: 4, total: 12 }, "en")} · ${hostPhrase("tree_continue_minutes", { minutes: 8 }, "en")}`,
    `it says the next step and the minutes left (got ${first?.description})`);
  expect(first?.command === "studium.openLesson" && JSON.stringify(first.args) === '["discover-studium-en/lesson.json","shipped"]',
    `it opens the lesson from the root it was played from (got ${JSON.stringify(first?.args)})`);
  expect(!!first?.tooltip?.includes(hostPhrase("continue_scope", {}, "en")), "its tooltip says whose progress this is");
  const fr = buildLessonTree({ courses: [], community: [], onReproductionScene: false, locale: "fr", continueWith: { ...cont, minutesLeft: null, source: "bundles" } })[0];
  expect(fr?.label === hostPhrase("tree_continue", { title: "Discover Studium" }, "fr") && fr.description === hostPhrase("tree_continue_step", { step: 4, total: 12 }, "fr")
    && JSON.stringify(fr.args) === '["discover-studium-en/lesson.json"]', `in French; unknown minutes are left out; the lessons folder needs no source (got ${JSON.stringify(fr)})`);
  const lib = buildLessonTree({ courses: [], community: [], onReproductionScene: false, continueWith: { ...cont, source: "library" } })[0];
  expect(JSON.stringify(lib?.args) === '["discover-studium-en/lesson.json","library"]', "a library lesson opens from the library");
  // Welcome-view gap: after one intro step the learner has no review history (no_history), no course in the folder:
  // the tree must not fold into the welcome view, or the Continue entry would be hidden.
  const fresh = buildLessonTree({ courses: [], community: [], onReproductionScene: false, emptyAsWelcome: true, locale: "en",
    reviews: parseReinforcement({ reinforcement: null, due: [], relearn: [], unmeasured: [], reason: "no_history", next_due_at: null }), continueWith: cont });
  expect(fresh[0]?.id === "continue", `a Continue entry keeps the tree instead of the welcome view (got ${fresh.map((n) => n.id).join(",")})`);
  expect(buildLessonTree({ courses: [], community: [], onReproductionScene: false, emptyAsWelcome: true, continueWith: null }).length === 0,
    "nothing to continue: an empty tree still gives way to the welcome view");
  expect(!byId(buildLessonTree({ courses: [], community: [], onReproductionScene: false }), "continue"), "no Continue entry without a lesson in progress");
}

// BN-7: each course's progress is appended to its tree description only (the picker keeps « L1 · fr »); a finished
// lesson says done, with no review date.
{
  const a: LessonCourse = { ref: "a/lesson.json", title: "A", target: "L1", language: "fr", approval: { state: "none" } };
  const b: LessonCourse = { ...a, ref: "b/lesson.json", title: "B" };
  const c: LessonCourse = { ...a, ref: "c/lesson.json", title: "C" };
  const progress = {
    "bundles:a/lesson.json": { state: "in_progress" as const, done: 6, total: 12 },
    "bundles:b/lesson.json": { state: "completed" as const, done: 12, total: 12 },
    "library:c/lesson.json": { state: "in_progress" as const, done: 1, total: 9 },
  };
  const t = buildLessonTree({ courses: [a, b, c], library: [c], community: [], onReproductionScene: false, locale: "en", progress, coursesSource: "bundles" });
  const leaves = byId(t, "courses")?.children ?? [];
  expect(leaves[0]?.description === `${courseDescription(a)} · 6/12`, `a lesson in progress shows n/N (got ${leaves[0]?.description})`);
  expect(leaves[1]?.description === `${courseDescription(b)} · ${hostPhrase("tree_done", {}, "en")}`, `a completed lesson shows done (got ${leaves[1]?.description})`);
  expect(leaves[2]?.description === courseDescription(c), `progress is read for the folder the course comes from (got ${leaves[2]?.description})`);
  const libLeaf = byId(t, "library")?.children?.[0];
  expect(libLeaf?.description === `${courseDescription(c)} · 1/9`, `a library lesson shows its own progress (got ${libLeaf?.description})`);
  const asLibrary = buildLessonTree({ courses: [c], community: [], onReproductionScene: false, progress, coursesSource: "library" });
  expect(byId(asLibrary, "courses")?.children?.[0]?.description === `${courseDescription(c)} · 1/9`, "when the lessons folder is the library, its courses read the library's progress");
  expect(toLessonPickItems([a], "en")[0]?.description === "L1 · fr", "the picker's description is unchanged");
}

// VSC-5: the sidebar and picker labels are real translations in both languages, never « français / English ».
for (const locale of ["fr", "en"] as const) {
  const catalogue = browserPhrases(locale) as Record<string, string>;
  for (const [key, value] of Object.entries(catalogue)) {
    if (!/^(?:tree|picker)_/.test(key)) continue;
    expect(!/ \/ /.test(value), `${locale} ${key} is not a slash-bilingual label (${JSON.stringify(value)})`);
  }
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} lesson-tree assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — lesson-tree (sidebar shaping) passed all ${checks} assertions.`);
