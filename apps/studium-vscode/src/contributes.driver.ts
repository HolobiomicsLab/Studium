// contributes.driver.ts — validates package.json's contribution points so a JSON typo (a missing view,
// a command with no activation, a walkthrough step pointing at a missing file) fails CI, not the tester.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/contributes.driver.ts
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
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

// 4) the getting-started walkthrough exists; every step's media (markdown or light/dark image) is on disk,
// a markdown step has its French companion, and every step can complete.
{
  const wt = (c.walkthroughs ?? []).find((w: any) => w.id === "studium.gettingStarted");
  expect(!!wt, "the studium.gettingStarted walkthrough is contributed");
  const steps = wt?.steps ?? [];
  expect(steps.length >= 5, `the walkthrough has ≥5 steps (got ${steps.length})`);
  const ids: string[] = steps.map((s: any) => s.id);
  for (const id of ["open", "selfStudy", "judge", "run", "review"]) expect(ids.includes(id), `walkthrough step '${id}' exists`);
  for (const s of steps) {
    const md = s.media?.markdown;
    const img = s.media?.image;
    if (md) {
      expect(existsSync(resolve(root, md)), `walkthrough step '${s.id}' markdown exists on disk (${md})`);
      expect(existsSync(resolve(root, md.replace(/\.md$/, ".nls.fr.md"))), `walkthrough step '${s.id}' has a French markdown companion`);
    } else {
      expect(!!img && existsSync(resolve(root, img.light)) && existsSync(resolve(root, img.dark)),
        `walkthrough step '${s.id}' has light and dark images on disk`);
      expect(/^%.+%$/.test(img?.altText ?? ""), `walkthrough step '${s.id}' image alt text is a localized %key%`);
    }
    expect((s.completionEvents ?? []).length > 0, `walkthrough step '${s.id}' declares a completion event`);
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

// 6) VSC-5 / VSC-11: every %key% in package.json resolves in BOTH nls files, the two files carry the same
// keys, and no walkthrough title or description is a hard-coded slash-bilingual literal.
{
  const nlsEn = JSON.parse(readFileSync(resolve(root, "package.nls.json"), "utf8"));
  const nlsFr = JSON.parse(readFileSync(resolve(root, "package.nls.fr.json"), "utf8"));
  const raw = readFileSync(resolve(root, "package.json"), "utf8");
  const used = [...new Set([...raw.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]!))];
  for (const key of used) {
    expect(key in nlsEn, `nls (en) defines ${key}`);
    expect(key in nlsFr, `nls (fr) defines ${key}`);
  }
  expect(Object.keys(nlsEn).sort().join() === Object.keys(nlsFr).sort().join(), "the English and French nls files carry exactly the same keys");
  const SAME = new Set(["configuration.title", "view.lessons.name.same"]);
  for (const key of Object.keys(nlsEn)) {
    expect(SAME.has(key) || nlsEn[key] !== nlsFr[key], `nls ${key}: French differs from English`);
  }
  const wt = (c.walkthroughs ?? []).find((w: any) => w.id === "studium.gettingStarted");
  for (const text of [wt?.title, wt?.description, ...(wt?.steps ?? []).flatMap((s: any) => [s.title, s.description])]) {
    expect(typeof text === "string" && /^%.+%$/.test(text), `walkthrough text is a localized %key% (${String(text).slice(0, 40)})`);
  }
  expect(!/ \/ /.test(Object.values(nlsFr).join("\n")), "no slash-bilingual label in the French nls");
  // W5 review: an empty bundlesRoot means a checkout's fixtures/, else the personal library (D4, data-paths.ts);
  // an installed VSIX has no checkout, so the description must name the library.
  const rootEn: string = nlsEn["configuration.bundlesRoot.description"] ?? "";
  const rootFr: string = nlsFr["configuration.bundlesRoot.description"] ?? "";
  expect(rootEn.includes("fixtures/") && rootEn.includes("library") && rootEn.includes("STUDIUM_HOME"),
    `the bundlesRoot description (en) names both defaults (got ${rootEn})`);
  expect(rootFr.includes("fixtures/") && rootFr.includes("bibliothèque") && rootFr.includes("STUDIUM_HOME"),
    `the bundlesRoot description (fr) names both defaults (got ${rootFr})`);
}

// 7) VSC-7: link handoff, "open this lesson" on a lesson.json, and restoration of the pane on reload.
{
  const acts: string[] = pkg.activationEvents ?? [];
  expect(acts.includes("onUri"), "an onUri activation event lets a harness open a lesson (code --open-url)");
  expect(acts.includes("onWebviewPanel:studiumLesson"), "the lesson pane is restorable (onWebviewPanel:studiumLesson)");
  for (const id of ["studium.openThisLesson", "studium.forgetMyData"]) {
    expect(hasCmd(id), `command ${id} is declared`);
    expect(acts.includes(`onCommand:${id}`) || acts.includes("*"), `command ${id} has an activation event`);
  }
  const explorer = c.menus?.["explorer/context"] ?? [];
  expect(explorer.some((m: any) => m.command === "studium.openThisLesson" && /resourceFilename == lesson\.json/.test(m.when ?? "")),
    "explorer context menu offers 'Open this lesson' on lesson.json");
}

// 8) VSC-6 / VSC-11: the status bar needs startup activation; an empty sidebar shows welcome content with actions.
{
  const acts: string[] = pkg.activationEvents ?? [];
  expect(acts.includes("onStartupFinished"), "the extension activates after startup so the review count can show");
  const welcome = (c.viewsWelcome ?? []).find((w: any) => w.view === "studiumLessons");
  expect(!!welcome && /^%.+%$/.test(welcome.contents ?? ""), "the lessons view has localized welcome content");
  const nlsEn = JSON.parse(readFileSync(resolve(root, "package.nls.json"), "utf8"));
  const body: string = nlsEn[(welcome?.contents ?? "").replace(/%/g, "")] ?? "";
  for (const id of ["studium.pickLesson", "studium.openWalkthrough"]) expect(body.includes(`command:${id}`), `the welcome content links to ${id}`);
}

// 9) storefront: a real PNG icon (>=128 px), a gallery banner, and no false "nothing to install" claim.
{
  expect(typeof pkg.icon === "string" && pkg.icon.endsWith(".png") && existsSync(resolve(root, pkg.icon)), "package.json declares a PNG icon that exists");
  if (typeof pkg.icon === "string" && existsSync(resolve(root, pkg.icon))) {
    const head = readFileSync(resolve(root, pkg.icon)).subarray(0, 24);
    expect(head.readUInt32BE(16) >= 128 && head.readUInt32BE(20) >= 128, "the icon is at least 128 x 128 px");
    expect(statSync(resolve(root, pkg.icon)).size < 1_000_000, "the icon stays small");
  }
  expect(!!pkg.galleryBanner?.color, "a gallery banner colour is declared");
  // Changed: this read media/walkthrough/01-open.md, a dead file once the open step became an image step (W5);
  // the dead step files are deleted, so the claim is now checked in EVERY walkthrough markdown that ships, and
  // a markdown no step references is itself a failure (it would ship in the VSIX, unread and unmaintained).
  const dir = resolve(root, "media/walkthrough");
  const shipped = readdirSync(dir).filter((f) => f.endsWith(".md"));
  for (const f of shipped) {
    expect(!/Rien à installer|nothing to install/i.test(readFileSync(resolve(dir, f), "utf8")), `${f} does not claim 'nothing to install' (false for a VSIX)`);
  }
  const wtSteps = (c.walkthroughs ?? []).flatMap((w: any) => w.steps ?? []);
  const referenced = new Set<string>(wtSteps.map((s: any) => s.media?.markdown).filter(Boolean)
    .flatMap((m: string) => { const base = m.split("/").pop()!; return [base, base.replace(/\.md$/, ".nls.fr.md")]; }));
  const orphans = shipped.filter((f) => !referenced.has(f));
  expect(orphans.length === 0, `every walkthrough markdown is used by a step (orphans: ${orphans.join(", ")})`);
}

// 10) the listing page: what the Marketplace and Open VSX show is MARKETPLACE.md, written for the person
//     who installs the extension. The developers' README stays out of the VSIX. A registry page cannot
//     follow a relative link or show a relative image (vsce would rewrite them to the repository), so the
//     listing has none.
{
  const listingPath = resolve(root, "MARKETPLACE.md");
  expect(existsSync(listingPath), "MARKETPLACE.md, the page shown by the registries, exists");
  const listing = existsSync(listingPath) ? readFileSync(listingPath, "utf8") : "";
  expect(/--readme-path MARKETPLACE\.md/.test(pkg.scripts?.package ?? ""), "the package script hands MARKETPLACE.md to vsce (--readme-path)");
  const ignore = readFileSync(resolve(root, ".vscodeignore"), "utf8").split(/\r?\n/).map((l) => l.trim());
  for (const f of ["README.md", "README.fr.md"]) expect(ignore.includes(f), `.vscodeignore keeps the developers' ${f} out of the VSIX`);
  const targets = [...listing.matchAll(/\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]!);
  const relative = targets.filter((t) => !/^(https:\/\/|#)/.test(t));
  expect(relative.length === 0, `MARKETPLACE.md has no relative link (found: ${relative.join(", ")})`);
  expect(!/<img|<picture|!\[/.test(listing), "MARKETPLACE.md shows no image until one has a public https address");
  expect(!/pnpm |F5\b/.test(listing), "MARKETPLACE.md has no developer command (pnpm, F5)");
  expect(/^# Studium$/m.test(listing) && /^## En français$/m.test(listing), "MARKETPLACE.md has its English page and its French section");
  for (const id of ["studium.pickLesson", "studium.openWalkthrough"]) {
    const title = JSON.parse(readFileSync(resolve(root, "package.nls.json"), "utf8"))[`command.${id.split(".")[1]}.title`];
    expect(typeof title === "string" && listing.includes(title), `MARKETPLACE.md names the command « ${title} » as the palette shows it`);
  }
  const m = listing.match(/VS Code (\d+\.\d+) or later/);
  expect(!!m && pkg.engines.vscode === `^${m[1]}.0`, `MARKETPLACE.md states the VS Code version of engines.vscode (${pkg.engines.vscode})`);
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} contributes assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — contributes (package.json manifest) passed all ${checks} assertions.`);
