// data-paths.driver.ts — where the extension looks for lessons when the learner has configured nothing
// (C6 / D4): a checkout's fixtures when running from a clone, otherwise the personal library. No VS Code APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/data-paths.driver.ts
import { studiumHome, defaultBundlesRoot } from "./data-paths.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

expect(studiumHome({}, "/home/ada") === "/home/ada/.studium", "STUDIUM_HOME defaults to ~/.studium");
expect(studiumHome({ STUDIUM_HOME: "/data/st" }, "/home/ada") === "/data/st", "STUDIUM_HOME overrides the default");
expect(studiumHome({ STUDIUM_HOME: "  " }, "/home/ada") === "/home/ada/.studium", "a blank STUDIUM_HOME is ignored");

const fixtures = "/repo/fixtures";
expect(defaultBundlesRoot({ repoRoot: "/repo", exists: (p) => p === fixtures, env: {}, homedir: "/home/ada" }) === fixtures,
  "inside a checkout (fixtures/ exists) the fixtures are the default root");
expect(defaultBundlesRoot({ repoRoot: "/nowhere", exists: () => false, env: {}, homedir: "/home/ada" }) === "/home/ada/.studium/library",
  "an installed VSIX with no checkout defaults to the personal library");
expect(defaultBundlesRoot({ repoRoot: "/nowhere", exists: () => false, env: { STUDIUM_HOME: "/data/st" }, homedir: "/home/ada" }) === "/data/st/library",
  "the personal library follows STUDIUM_HOME");

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} data-paths assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — data-paths (default lesson root) passed all ${checks} assertions.`);
