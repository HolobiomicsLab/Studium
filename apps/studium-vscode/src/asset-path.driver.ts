// asset-path.driver.ts — unit checks for the shared notebook + lesson-pane figure helpers.
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetPathFor, equationAssetMarkdown, imageMime, inlineImageAsset } from "./asset-path.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

// image MIME by extension (the inline executed_result / image render)
expect(imageMime("decay.png") === "image/png", "png mime");
expect(imageMime("a.PNG") === "image/png", "uppercase PNG -> png");
expect(imageMime("fig.svg") === "image/svg+xml", "svg mime");
expect(imageMime("p.jpg") === "image/jpeg" && imageMime("p.jpeg") === "image/jpeg", "jpg/jpeg mime");
expect(imageMime("x.unknown") === "image/png", "unknown ext defaults to png");

const equation = equationAssetMarkdown({
  kind: "equation_latex", title: "Mass balance", payload: "A = Z + N",
  legend: [{ symbol: "A", meaning: "mass number" }, { symbol: "Z", meaning: "proton number" }],
});
expect(equation.startsWith("**Mass balance**\n\n$$\nA = Z + N\n$$"), "notebook equation includes title and formula");
expect(equation.endsWith("- A : mass number\n- Z : proton number"), "notebook equation includes its legend below the formula");
expect(equationAssetMarkdown({kind:"image",payload:"x"}) === "", "non-equations do not produce equation markdown");

// The pane resolves relative figures from the selected bundle, independent of process.cwd().
const tempRoot = mkdtempSync(join(tmpdir(), "studium-asset-path-"));
const bundleDir = join(tempRoot, "course");
const nestedBundleDir = join(bundleDir, "modules", "unit");
const elsewhere = join(tempRoot, "elsewhere");
const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
mkdirSync(nestedBundleDir, { recursive: true }); mkdirSync(elsewhere);
writeFileSync(join(bundleDir, "figure.png"), Buffer.from(tinyPngBase64, "base64"));
writeFileSync(join(bundleDir, "..figure.png"), Buffer.from(tinyPngBase64, "base64"));
writeFileSync(join(nestedBundleDir, "nested.png"), Buffer.from(tinyPngBase64, "base64"));
writeFileSync(join(tempRoot, "outside.png"), "outside");
symlinkSync(join(tempRoot, "outside.png"), join(bundleDir, "escape.png"));

const previousCwd = process.cwd();
try {
  process.chdir(elsewhere);
  const canonicalFigure = realpathSync(join(bundleDir, "figure.png"));
  expect(
    assetPathFor(tempRoot, "course/lesson.json", "figure.png") === canonicalFigure,
    "relative figure path resolves under the bundle directory",
  );
  expect(
    assetPathFor(tempRoot, "course/lesson.json", join(bundleDir, "figure.png")) === canonicalFigure,
    "absolute figure inside the selected bundle is preserved",
  );
  expect(
    assetPathFor(tempRoot, "course/modules/unit/lesson.json", "nested.png") === realpathSync(join(nestedBundleDir, "nested.png")),
    "nested bundle directory is honored",
  );
  const image = inlineImageAsset(tempRoot, "course/lesson.json", { kind: "image", path: "figure.png" });
  expect(image.dataUri === `data:image/png;base64,${tinyPngBase64}`, "relative pane image is inlined as a decodable PNG");

  const dotDotName = inlineImageAsset(tempRoot, "course/lesson.json", { kind: "image", path: "..figure.png" });
  expect(dotDotName.dataUri === image.dataUri, "valid in-bundle filename beginning with two dots is accepted");

  const executed = inlineImageAsset(tempRoot, "course/lesson.json", { kind: "executed_result", path: "figure.png" });
  expect(executed.dataUri === image.dataUri, "executed_result uses the same confined image path");

  const absoluteInside = inlineImageAsset(tempRoot, "course/lesson.json", { kind: "image", path: join(bundleDir, "figure.png") });
  expect(absoluteInside.dataUri === image.dataUri, "absolute figure inside the selected bundle remains supported");

  for (const [path, label] of [
    ["missing.png", "missing figure stays a graceful fallback"],
    ["../outside.png", "relative traversal is not read"],
    [join(tempRoot, "outside.png"), "absolute path outside the selected bundle is not read"],
    ["escape.png", "symlink escape is not read"],
  ] as const) {
    const result = inlineImageAsset(tempRoot, "course/lesson.json", { kind: "image", path });
    expect(result.dataUri === undefined && result.path === path, label);
  }
} finally {
  process.chdir(previousCwd);
  rmSync(tempRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} asset-path assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — asset-path (notebook figure-render helpers) passed all ${checks} assertions.`);
