/** Build a host-owned spectrum explorer from public context and an actual run's files.
 * Usage: node build-viewer.mjs SPECTRA_JSON RESULT_JSON OPERATOR_CONTEXT_JSON REVIEW_DIR NEW_OUTPUT_DIR
 * No server, external dependency, model call, capsule execution or lesson mutation.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const [spectraPath, resultPath, contextPath, reviewPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error("Usage: build-viewer.mjs SPECTRA_JSON RESULT_JSON OPERATOR_CONTEXT_JSON REVIEW_DIR NEW_OUTPUT_DIR");
const paths = [spectraPath, resultPath, contextPath].map(p => resolve(p));
const bytes = await Promise.all(paths.map(p => readFile(p, "utf8")));
const [spectra, result, context] = bytes.map(s => JSON.parse(s));
for (const key of ["experimental", "reference"]) {
  if (!Number.isFinite(spectra[key]?.precursor_mz) || !Array.isArray(spectra[key]?.peaks) || !spectra[key].peaks.length)
    throw new Error(`Missing spectrum: ${key}`);
  for (const peak of spectra[key].peaks) {
    if (!Array.isArray(peak) || peak.length !== 2 || !peak.every(Number.isFinite) || peak[0] <= 0 || peak[1] < 0)
      throw new Error(`Invalid peak: ${key}`);
  }
}
if (!Number.isFinite(result.score) || result.score < 0 || result.score > 1 || !Number.isInteger(result.matched_peaks))
  throw new Error("Expected a measured score and integer matched_peaks in result.json");
if (context.schema !== "studium/operator-context/v1" || !context.scene?.id)
  throw new Error("Expected a public Studium operator context");
if (!/illustrative|synthetic/i.test(spectra.note || "")) throw new Error("This example requires explicitly illustrative or synthetic input spectra");
const reviewFiles = await Promise.all(["plan.json", "evidence.json", "source_links.json", "viewers.json"].map(name => readFile(join(resolve(reviewPath), name), "utf8")));
const [plan, evidence, links, viewers] = reviewFiles.map(s => JSON.parse(s));
const brief = viewers.find(v => v.scene_id === context.scene.id);
const link = links.source_links?.find(l => l.scene_id === context.scene.id);
const source = evidence.sources?.find(s => s.evidence_id === link?.evidence_id);
if (plan.status !== "draft" || plan.validated_by !== null || !plan.scene_outlines.some(s => s.id === context.scene.id) || !brief || !source || !brief.source_ids.includes(source.evidence_id))
  throw new Error("Public scene must match a source-linked viewer in the checked draft");
if (!source.text.includes(link.quote) || createHash("sha256").update(source.text).digest("hex") !== source.text_sha256)
  throw new Error("Source quote/hash does not match captured evidence");
if (!/^10\.\d{4,9}\//.test(source.source_doi || "")) throw new Error("This literature example requires a captured source DOI");
const hashes = bytes.map(b => createHash("sha256").update(b).digest("hex"));
const builderHash = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const payload = JSON.stringify({ spectra, result, context, hashes, source: { doi: source.source_doi, title: source.title, quote: link.quote, evidence_id: source.evidence_id }, brief }).replaceAll("<", "\\u003c");
const template = await readFile(new URL("viewer.html", import.meta.url), "utf8");
const output = resolve(outputPath);
await mkdir(output, { recursive: false });
await writeFile(join(output, "index.html"), template.replace("/* EXPERIENCE_DATA */", `const INPUT = ${payload};`));
await writeFile(join(output, "viewer-provenance.json"), JSON.stringify({
  schema: "studium/viewer-example/v1", input_sha256: hashes,
  builder_sha256: builderHash, template_sha256: createHash("sha256").update(template).digest("hex"),
  output_sha256: createHash("sha256").update(await readFile(join(output, "index.html"))).digest("hex"),
  source_doi: source.source_doi, evidence_id: source.evidence_id,
  review_sha256: reviewFiles.map(s => createHash("sha256").update(s).digest("hex")),
  data_status: "illustrative synthetic spectra",
  capsule_execution: "external; supplied result is not cryptographically attested by this viewer",
  scientific_scope: "illustrate precursor-aware matching; no claim to reproduce the paper or validate compound identity",
  learner_assessment: "none; reflection remains ungraded; no response submitted to Studium",
}, null, 2) + "\n");
console.log(output);
