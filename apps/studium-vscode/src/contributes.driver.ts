// contributes.driver.ts — validates package.json's contribution points so a JSON typo (a missing view,
// a command with no activation, a walkthrough step pointing at a missing file) fails CI, not the tester.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/contributes.driver.ts
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url)); // apps/studium-vscode/src
const root = resolve(here, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const c = pkg.contributes ?? {};

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }
const commandIds: string[] = (c.commands ?? []).map((x: any) => x.command);
const hasCmd = (id: string) => commandIds.includes(id);

// 1) the activity-bar container + its tree view exist and agree.
{
  const container = (c.viewsContainers?.activitybar ?? []).find((x: any) => x.id === "studium");
  expect(!!container, "an activity-bar container 'studium' is contributed");
  expect(!!container && existsSync(resolve(root, container.icon)), `the container icon exists on disk (${container?.icon})`);
  const views = c.views?.studium ?? [];
  expect(views.some((v: any) => v.id === "studiumLessons"), "the 'studiumLessons' tree view is contributed under the studium container");
}

// 2) every command the tree/walkthrough invokes is declared AND has an activation event.
{
  for (const id of ["studium.openLesson", "studium.openLessonNotebook", "studium.communityContributions", "studium.runReproduction", "studium.openWalkthrough", "studium.refreshLessons"]) {
    expect(hasCmd(id), `command ${id} is declared`);
  }
  const acts: string[] = pkg.activationEvents ?? [];
  for (const id of ["studium.openLesson", "studium.openWalkthrough"]) {
    expect(acts.includes(`onCommand:${id}`) || acts.includes("*"), `command ${id} has an activation event`);
  }
  expect(acts.includes("onView:studiumLessons"), "the tree view has an onView activation event");
}

// 3) the refresh command is a view-title button and hidden from the palette (it needs a live view).
{
  const titleMenus = c.menus?.["view/title"] ?? [];
  expect(titleMenus.some((m: any) => m.command === "studium.refreshLessons" && /studiumLessons/.test(m.when ?? "")),
    "refreshLessons is a view/title button scoped to studiumLessons");
}

// 4) the getting-started walkthrough exists and every step's markdown media file is present.
{
  const wt = (c.walkthroughs ?? []).find((w: any) => w.id === "studium.gettingStarted");
  expect(!!wt, "the studium.gettingStarted walkthrough is contributed");
  const steps = wt?.steps ?? [];
  expect(steps.length >= 3, `the walkthrough has ≥3 steps (got ${steps.length})`);
  for (const s of steps) {
    const md = s.media?.markdown;
    expect(!!md && existsSync(resolve(root, md)), `walkthrough step '${s.id}' media exists on disk (${md})`);
  }
}

// 5) the @studium chat participant is contributed with its slash commands + a matching activation event.
{
  const cp = (c.chatParticipants ?? []).find((p: any) => p.id === "studium.tutor");
  expect(!!cp, "the studium.tutor chat participant is contributed");
  expect(!!cp && cp.name === "studium", "the participant is invoked as @studium");
  const cmds: string[] = (cp?.commands ?? []).map((x: any) => x.name);
  for (const name of ["start", "hint", "discuss"]) expect(cmds.includes(name), `chat participant declares the /${name} command`);
  const acts: string[] = pkg.activationEvents ?? [];
  expect(acts.includes("onChatParticipant:studium.tutor"), "the chat participant has an onChatParticipant activation event");
  // the chat API this uses (createChatParticipant) needs a modern engine
  expect(/\^1\.(9[5-9]|\d{3})/.test(pkg.engines?.vscode ?? ""), "engines.vscode is bumped for the chat API (>=1.95)");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} contributes assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — contributes (package.json manifest) passed all ${checks} assertions.`);
