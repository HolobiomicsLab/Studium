// asset-path.driver.ts — unit checks for the notebook figure-render helpers (asset-path.ts). The
// notebook render itself uses vscode.* (Extension-Host only, tsc-checked); these PURE helpers are tested.
import { assetPathFor, imageMime } from "./asset-path.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

// a relative asset path resolves against the bundle dir (<bundlesRoot>/<dirname(bundleRef)>)
expect(
  assetPathFor("/root/fixtures", "capsule-judgment-demo/lesson.json", "decay.png") === "/root/fixtures/capsule-judgment-demo/decay.png",
  "relative figure path resolves under the bundle dir",
);
// an absolute asset path is used as-is
expect(assetPathFor("/root/fixtures", "x/lesson.json", "/abs/decay.png") === "/abs/decay.png", "absolute figure path used as-is");
// a nested bundleRef dir is honored
expect(assetPathFor("/r", "a/b/lesson.json", "fig.svg") === "/r/a/b/fig.svg", "nested bundle dir honored");

// image MIME by extension (the inline executed_result / image render)
expect(imageMime("decay.png") === "image/png", "png mime");
expect(imageMime("a.PNG") === "image/png", "uppercase PNG -> png");
expect(imageMime("fig.svg") === "image/svg+xml", "svg mime");
expect(imageMime("p.jpg") === "image/jpeg" && imageMime("p.jpeg") === "image/jpeg", "jpg/jpeg mime");
expect(imageMime("x.unknown") === "image/png", "unknown ext defaults to png");

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} asset-path assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — asset-path (notebook figure-render helpers) passed all ${checks} assertions.`);
