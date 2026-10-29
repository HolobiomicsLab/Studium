// Dependency-free lint for authored lesson bundles.
//
// Run from any directory with Node 20+:
//   node tools/bundle_lint.mjs
//   node tools/bundle_lint.mjs --root path/to/bundles
//   node tools/bundle_lint.mjs path/to/lesson.json
//
// Exit 0 means no ERROR findings; WARN and INFO findings do not fail the run.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BUNDLES_ROOT = join(REPO_ROOT, "fixtures");
const BUNDLE_FILENAME = "lesson.json";
const MAX_BUNDLE_DEPTH = 2;
const EXPECTED_CORRECT_CHOICES = 1;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "__pycache__"]);
const ANSWER_GRADED_TYPES = new Set(["quiz", "ai_critique"]);
const ANSWER_GRADED_TYPE_LIST = [...ANSWER_GRADED_TYPES].join(", ");
const GRAPH_RELATIONS = new Set([
  "prerequisite_for",
  "part_of",
  "decomposes_into",
  "assesses",
  "aligns_with",
]);
const RENDER_ASSET_KINDS = new Set([
  "image",
  "svg",
  "equation_latex",
  "plot_spec",
  "code",
  "data_csv",
  "protocol_md",
  "executed_result",
  "orbital",
  "mol_3d",
  "spectrum",
]);
const ABS_ASSET_KINDS = new Map([
  ["spectrum_viewer_svg", "svg"],
  ["code_snippet", "code"],
  ["script_snippet", "code"],
  ["data_csv", "data_csv"],
  ["protocol_card_md", "protocol_md"],
  ["plot_spec", "plot_spec"],
  ["equation_latex", "equation_latex"],
  ["orbital_viewer_3d", "orbital"],
  ["molecule_3d", "mol_3d"],
  ["spectrum_data", "spectrum"],
]);

// Quarantines stay explicit and self-expiring. Both maps are intentionally empty.
const KNOWN_BROKEN_BUNDLES = new Map([]);
const KNOWN_FLAW_GAPS = new Map([]);

function finding(level, code, message) {
  return { level, code, message };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Find lesson.json files no deeper than `find DIR -maxdepth 2`. */
function findBundles(root) {
  const files = [];
  function visit(directory, depth) {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const nextDepth = depth + 1;
      const fullPath = join(directory, entry.name);
      if (entry.isFile() && entry.name === BUNDLE_FILENAME && nextDepth <= MAX_BUNDLE_DEPTH) files.push(fullPath);
      const canWalk = entry.isDirectory() && nextDepth < MAX_BUNDLE_DEPTH
        && !SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith(".");
      if (canWalk) visit(fullPath, nextDepth);
    }
  }
  visit(root, 0);
  return files;
}

function parseArguments(args) {
  const parsed = { root: null, files: [], findings: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) parsed.findings.push(finding("ERROR", "argument_error", "--root requires a directory"));
      else if (parsed.root !== null) parsed.findings.push(finding("ERROR", "argument_error", "--root may be provided only once"));
      else { parsed.root = resolve(value); index += 1; }
    } else if (arg.startsWith("--root=")) {
      if (parsed.root !== null) parsed.findings.push(finding("ERROR", "argument_error", "--root may be provided only once"));
      else if (arg.length === 7) parsed.findings.push(finding("ERROR", "argument_error", "--root requires a directory"));
      else parsed.root = resolve(arg.slice(7));
    } else if (arg.startsWith("-")) {
      parsed.findings.push(finding("ERROR", "argument_error", `unknown option: ${arg}`));
    } else parsed.files.push(resolve(arg));
  }
  return parsed;
}

function displayPath(file, base) {
  const name = relative(base, file);
  return name || BUNDLE_FILENAME;
}

function scanRoot(root, base) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { targets: [], findings: [finding("ERROR", "invalid_root", `not a directory: ${root}`)] };
  }
  const files = findBundles(root);
  if (files.length === 0) {
    return { targets: [], findings: [finding("ERROR", "no_bundles", `no lesson.json found at depth <= ${MAX_BUNDLE_DEPTH}: ${root}`)] };
  }
  return { targets: files.map((file) => ({ file, name: displayPath(file, base) })), findings: [] };
}

function resolveTargets(parsed) {
  const isDefaultRun = parsed.root === null && parsed.files.length === 0;
  const root = parsed.root ?? (isDefaultRun ? DEFAULT_BUNDLES_ROOT : null);
  const scanned = root === null ? { targets: [], findings: [] } : scanRoot(root, isDefaultRun ? REPO_ROOT : root);
  const positional = parsed.files.map((file) => ({ file, name: displayPath(file, process.cwd()) }));
  const targets = new Map(scanned.targets.map((target) => [target.file, target]));
  for (const target of positional) targets.set(target.file, target);
  return { targets: [...targets.values()].sort((a, b) => a.name.localeCompare(b.name)), findings: scanned.findings, isDefaultRun };
}

function validateRenderAsset(asset, path) {
  if (!isRecord(asset)) return [`${path} must be an object`];
  const issues = [];
  if (!RENDER_ASSET_KINDS.has(asset.kind)) issues.push(`${path}.kind is invalid`);
  const hasPayload = typeof asset.payload === "string";
  const hasPath = typeof asset.path === "string";
  const isMetaBacked = asset.kind === "executed_result";
  if (!isMetaBacked && hasPayload === hasPath) issues.push(`${path} needs exactly one of payload or path`);
  if (isMetaBacked && (!isRecord(asset.meta) || (hasPayload && hasPath))) {
    issues.push(`${path} executed_result needs meta and at most one of payload or path`);
  }
  return issues;
}

function validateScene(scene, index) {
  const path = `scenes.${index}`;
  if (!isRecord(scene)) return [`${path} must be an object`];
  const issues = [];
  if (typeof scene.id !== "string" || scene.id.length === 0) issues.push(`${path}.id must be a non-empty string`);
  if (typeof scene.type !== "string") issues.push(`${path}.type must be a string`);
  if (!isStringArray(scene.concept_refs)) issues.push(`${path}.concept_refs must be an array of strings`);
  if (scene.render_assets !== undefined) {
    if (!Array.isArray(scene.render_assets)) issues.push(`${path}.render_assets must be an array`);
    else scene.render_assets.forEach((asset, assetIndex) => issues.push(...validateRenderAsset(asset, `${path}.render_assets.${assetIndex}`)));
  }
  if (scene.type === "quiz" && (!Array.isArray(scene.choices) || scene.choices.length < 2 || scene.choices.length > 6)) {
    issues.push(`${path}.choices must contain 2 to 6 choices`);
  }
  return issues;
}

function validateGraph(graph) {
  if (!isRecord(graph)) return ["learning_workflow_graph must be an object or null"];
  const issues = [];
  if (!Array.isArray(graph.nodes)) issues.push("learning_workflow_graph.nodes must be an array");
  if (!Array.isArray(graph.edges)) issues.push("learning_workflow_graph.edges must be an array");
  if (Array.isArray(graph.nodes)) {
    graph.nodes.forEach((node, index) => {
      if (!isRecord(node) || typeof node.id !== "string") issues.push(`learning_workflow_graph.nodes.${index}.id must be a string`);
      if (!isRecord(node) || !new Set(["concept", "task"]).has(node.node_kind)) issues.push(`learning_workflow_graph.nodes.${index}.node_kind is invalid`);
    });
  }
  if (Array.isArray(graph.edges)) {
    graph.edges.forEach((edge, index) => {
      if (!isRecord(edge) || typeof edge.id !== "string") issues.push(`learning_workflow_graph.edges.${index}.id must be a string`);
      if (!isRecord(edge) || !GRAPH_RELATIONS.has(edge.relation)) issues.push(`learning_workflow_graph.edges.${index}.relation is invalid`);
      if (!isRecord(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") issues.push(`learning_workflow_graph.edges.${index} needs string source and target`);
    });
  }
  return issues;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) (seen.has(value) ? duplicates : seen).add(value);
  return [...duplicates];
}

function schemaFindings(bundle) {
  if (!isRecord(bundle)) return [finding("ERROR", "schema_invalid", "bundle root must be an object")];
  const issues = [];
  if (bundle.schema_version !== "1.4") issues.push("schema_version must be 1.4");
  if (!Array.isArray(bundle.concepts) || bundle.concepts.length === 0) issues.push("concepts must be a non-empty array");
  if (!Array.isArray(bundle.scenes) || bundle.scenes.length === 0) issues.push("scenes must be a non-empty array");
  if (!Array.isArray(bundle.rules)) issues.push("rules must be an array");
  if (Array.isArray(bundle.concepts)) {
    bundle.concepts.forEach((concept, index) => {
      if (!isRecord(concept) || typeof concept.id !== "string") issues.push(`concepts.${index}.id must be a string`);
    });
  }
  if (Array.isArray(bundle.scenes)) bundle.scenes.forEach((scene, index) => issues.push(...validateScene(scene, index)));
  if (bundle.learning_workflow_graph !== null && bundle.learning_workflow_graph !== undefined) {
    issues.push(...validateGraph(bundle.learning_workflow_graph));
  }
  return issues.map((message) => finding("ERROR", "schema_invalid", message));
}

function duplicateIdFindings(bundle) {
  if (!Array.isArray(bundle.scenes)) return [];
  return duplicateValues(bundle.scenes.map((scene) => scene?.id).filter((id) => typeof id === "string"))
    .map((id) => finding("ERROR", "duplicate_scene_id", `duplicate scene id: ${id}`));
}

function quizAnswerKeyFindings(bundle) {
  if (!Array.isArray(bundle.scenes)) return [];
  return bundle.scenes.filter((scene) => scene?.type === "quiz" && Array.isArray(scene.choices))
    .map((scene) => ({ id: scene.id, count: scene.choices.filter((choice) => choice?.correct === true).length }))
    .filter(({ count }) => count !== EXPECTED_CORRECT_CHOICES)
    .map(({ id, count }) => finding("ERROR", "quiz_answer_key", `${id}: ${count} correct choices (expected ${EXPECTED_CORRECT_CHOICES})`));
}

function sceneRenderAssets(scene) {
  const assets = Array.isArray(scene.render_assets) ? [...scene.render_assets] : [];
  if (typeof scene.image_path === "string") assets.push({ kind: "image", path: scene.image_path });
  const absAsset = scene.evidence?.abs_asset;
  const absKind = ABS_ASSET_KINDS.get(absAsset?.asset_type);
  if (absKind) assets.push({ kind: absKind, payload: absAsset.payload_inline, path: absAsset.payload_path });
  const referenceResult = scene.reference_result;
  if (referenceResult?.ran && typeof referenceResult.figure_path === "string") {
    assets.push({ kind: "executed_result", path: referenceResult.figure_path, meta: {} });
  }
  return assets;
}

function unresolvedAssetFindings(bundle, bundleDirectory) {
  if (!Array.isArray(bundle.scenes)) return [];
  return bundle.scenes.flatMap((scene) => sceneRenderAssets(scene)
    .filter((asset) => typeof asset.path === "string" && !existsSync(resolve(bundleDirectory, asset.path)))
    .map((asset) => finding("ERROR", "unresolved_asset", `${scene.id}: unresolved render asset (${asset.kind}) -> ${asset.path}`)));
}

function normalizeText(text) {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_\-'’]/g, " ");
}

function flawMatches(flaw, correction) {
  const normalizedCorrection = normalizeText(correction);
  const needle = normalizeText(flaw).trim();
  if (!needle) return false;
  if (normalizedCorrection.includes(needle)) return true;
  return needle.split(/\s+/).filter(Boolean).every((token) => normalizedCorrection.includes(token));
}

function flawRevealFindings(bundle, bundleName) {
  if (!Array.isArray(bundle.scenes)) return { findings: [], waiversHit: [] };
  const findings = [];
  const waiversHit = [];
  for (const scene of bundle.scenes) {
    if (!Array.isArray(scene?.claims) || typeof scene.model_correction !== "string") continue;
    const flaws = new Set(scene.claims.flatMap((claim) => Array.isArray(claim?.flaws_expected) ? claim.flaws_expected : []));
    for (const flaw of flaws) {
      if (typeof flaw !== "string" || flawMatches(flaw, scene.model_correction)) continue;
      const key = `${bundleName}::${scene.id}::${flaw}`;
      if (KNOWN_FLAW_GAPS.has(key)) {
        findings.push(finding("WARN", "flaw_reveal_gap", `${scene.id}: flaw "${flaw}" is absent from model_correction [known: ${KNOWN_FLAW_GAPS.get(key)}]`));
        waiversHit.push(key);
      } else findings.push(finding("ERROR", "flaw_reveal_gap", `${scene.id}: flaw "${flaw}" is absent from model_correction`));
    }
  }
  return { findings, waiversHit };
}

function graphParts(bundle) {
  const graph = bundle.learning_workflow_graph;
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
  const conceptIds = new Set(Array.isArray(bundle.concepts)
    ? bundle.concepts.map((concept) => concept?.id).filter((id) => typeof id === "string") : []);
  const sceneIds = new Set(Array.isArray(bundle.scenes)
    ? bundle.scenes.map((scene) => scene?.id).filter((id) => typeof id === "string") : []);
  const nodes = graph.nodes.filter(isRecord);
  const edges = graph.edges.filter(isRecord);
  const nodeById = new Map(nodes.filter((node) => typeof node.id === "string").map((node) => [node.id, node]));
  return { nodes, edges, nodeById, conceptIds, sceneIds };
}

function isDeclaredConceptNode(node, conceptIds) {
  if (node?.node_kind !== "concept" || typeof node.id !== "string" || !node.id.startsWith("concept:")) return false;
  return conceptIds.has(node.id.slice("concept:".length));
}

function unknownNodeFindings(parts) {
  const findings = [];
  for (const node of parts.nodes) {
    if (node.node_kind === "concept" && !isDeclaredConceptNode(node, parts.conceptIds)) {
      findings.push(finding("ERROR", "lwg_unknown_node", `graph node "${node.id}" must be concept:<id> for a declared bundle concept`));
    }
    // The LWG schema also permits task nodes on non-prerequisite edges.
    if (node.node_kind === "task" && (!node.id?.startsWith("task:") || !parts.sceneIds.has(node.id.slice("task:".length)))) {
      findings.push(finding("ERROR", "lwg_unknown_node", `task node "${node.id}" does not name a declared scene`));
    }
  }
  for (const edge of parts.edges) {
    for (const endpoint of ["source", "target"]) {
      if (!parts.nodeById.has(edge[endpoint])) {
        findings.push(finding("ERROR", "lwg_unknown_node", `edge "${edge.id}" ${endpoint} "${edge[endpoint]}" is not a declared graph node`));
      }
    }
    if (edge.relation !== "prerequisite_for") continue;
    for (const endpoint of ["source", "target"]) {
      const node = parts.nodeById.get(edge[endpoint]);
      if (node && !isDeclaredConceptNode(node, parts.conceptIds)) {
        findings.push(finding("ERROR", "lwg_unknown_node", `prerequisite edge "${edge.id}" ${endpoint} "${edge[endpoint]}" must name a declared concept node`));
      }
    }
  }
  return findings;
}

function validPrerequisiteEdges(parts) {
  return parts.edges.filter((edge) => edge.relation === "prerequisite_for"
    && isDeclaredConceptNode(parts.nodeById.get(edge.source), parts.conceptIds)
    && isDeclaredConceptNode(parts.nodeById.get(edge.target), parts.conceptIds));
}

function prerequisiteCycles(edges) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source).push(edge.target);
  }
  for (const targets of adjacency.values()) targets.sort();
  const state = new Map();
  const stack = [];
  const cycles = [];
  function visit(node) {
    state.set(node, 1);
    stack.push(node);
    for (const target of adjacency.get(node) ?? []) {
      if (!state.has(target)) visit(target);
      else if (state.get(target) === 1) cycles.push([...stack.slice(stack.indexOf(target)), target]);
    }
    stack.pop();
    state.set(node, 2);
  }
  const nodes = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  for (const node of [...nodes].sort()) if (!state.has(node)) visit(node);
  return cycles;
}

function cycleFindings(edges) {
  return prerequisiteCycles(edges)
    .map((cycle) => finding("ERROR", "lwg_cycle", `prerequisite cycle: ${cycle.join(" -> ")}`));
}

function sceneIndexesByConcept(scenes) {
  const indexes = new Map();
  scenes.forEach((scene, index) => {
    const refs = new Set(isStringArray(scene?.concept_refs) ? scene.concept_refs : []);
    for (const ref of refs) {
      const conceptId = `concept:${ref}`;
      if (!indexes.has(conceptId)) indexes.set(conceptId, []);
      indexes.get(conceptId).push(index);
    }
  });
  return indexes;
}

function lockedBeforePrerequisiteFindings(edges, scenes) {
  const indexes = sceneIndexesByConcept(scenes);
  const findings = [];
  const seenPairs = new Set();
  const firstSceneIndex = scenes.findIndex((scene) => isStringArray(scene?.concept_refs) && scene.concept_refs.length > 0);
  if (firstSceneIndex >= 0) {
    const firstConcept = `concept:${scenes[firstSceneIndex].concept_refs[0]}`;
    for (const edge of edges.filter((candidate) => candidate.source === firstConcept)) {
      seenPairs.add(`${edge.source}\0${edge.target}`);
      findings.push(finding("ERROR", "lwg_locked_before_prereq",
        `${edge.source} is carried by the first concept scene "${scenes[firstSceneIndex].id}" and is locked at start by ${edge.target}; engine convention: source = dependent concept, target = its prerequisite; flip the edge if you meant the opposite`));
    }
  }
  for (const edge of edges) {
    const pair = `${edge.source}\0${edge.target}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    const dependentFirst = indexes.get(edge.source)?.[0];
    const prerequisiteFirst = indexes.get(edge.target)?.[0];
    if (dependentFirst === undefined || (prerequisiteFirst !== undefined && dependentFirst >= prerequisiteFirst)) continue;
    const sceneId = scenes[dependentFirst]?.id ?? `index ${dependentFirst}`;
    const order = prerequisiteFirst === undefined ? `${edge.target} has no scene` : `${edge.target} first appears later`;
    findings.push(finding("ERROR", "lwg_locked_before_prereq",
      `${edge.source} first appears in "${sceneId}" while ${order}; engine convention: source = dependent concept, target = its prerequisite; flip the edge if you meant the opposite`));
  }
  return findings;
}

function answerGradedScenes(scenes, conceptId) {
  return scenes.filter((scene) => ANSWER_GRADED_TYPES.has(scene?.type)
    && `concept:${scene.concept_refs?.[0]}` === conceptId);
}

function prerequisiteAssessmentFindings(edges, scenes) {
  const targets = [...new Set(edges.map((edge) => edge.target))].sort();
  return targets.flatMap((target) => {
    const graded = answerGradedScenes(scenes, target);
    if (graded.length === 0) {
      return [finding("WARN", "lwg_prereq_unassessable", `${target} has no answer-graded scene; graded types: ${ANSWER_GRADED_TYPE_LIST}`)];
    }
    if (graded.length === 1) {
      return [finding("INFO", "lwg_single_graded_item", `${target} has exactly one answer-graded scene "${graded[0].id}" (${graded[0].type}); one correct answer cannot reach theta, the gate will pass it on a correct answer`)];
    }
    return [];
  });
}

function graphFindings(bundle) {
  const parts = graphParts(bundle);
  if (!parts) return [];
  const prerequisites = validPrerequisiteEdges(parts);
  return [
    ...unknownNodeFindings(parts),
    ...cycleFindings(prerequisites),
    ...lockedBeforePrerequisiteFindings(prerequisites, Array.isArray(bundle.scenes) ? bundle.scenes : []),
    ...prerequisiteAssessmentFindings(prerequisites, Array.isArray(bundle.scenes) ? bundle.scenes : []),
  ];
}

function uniqueFindings(findings) {
  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.level}\0${item.code}\0${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readBundle(target) {
  if (!existsSync(target.file) || !statSync(target.file).isFile()) {
    return { bundle: null, findings: [finding("ERROR", "file_read_error", `not a file: ${target.file}`)] };
  }
  try {
    return { bundle: JSON.parse(readFileSync(target.file, "utf8")), findings: [] };
  } catch (error) {
    return { bundle: null, findings: [finding("ERROR", "invalid_json", error.message)] };
  }
}

function lintBundle(target) {
  const loaded = readBundle(target);
  if (loaded.bundle === null) return { findings: loaded.findings, waiversHit: [] };
  const flawReport = flawRevealFindings(loaded.bundle, target.name);
  const findings = uniqueFindings([
    ...schemaFindings(loaded.bundle),
    ...duplicateIdFindings(loaded.bundle),
    ...quizAnswerKeyFindings(loaded.bundle),
    ...unresolvedAssetFindings(loaded.bundle, dirname(target.file)),
    ...flawReport.findings,
    ...graphFindings(loaded.bundle),
  ]);
  return { findings, waiversHit: flawReport.waiversHit };
}

function applyKnownBundleQuarantine(target, result) {
  const reason = KNOWN_BROKEN_BUNDLES.get(target.name);
  if (!reason || !result.findings.some((item) => item.level === "ERROR")) return result;
  return {
    ...result,
    findings: result.findings.map((item) => item.level === "ERROR"
      ? finding("WARN", item.code, `${item.message} [known broken: ${reason}]`) : item),
  };
}

function formatFinding(bundleName, item) {
  return `${item.level}  ${bundleName}  ${item.code}  ${item.message}`;
}

function main(args) {
  const parsed = parseArguments(args);
  const resolved = resolveTargets(parsed);
  const globalFindings = [...parsed.findings, ...resolved.findings];
  for (const item of globalFindings) console.log(formatFinding("<cli>", item));

  const results = resolved.targets.map((target) => [target, applyKnownBundleQuarantine(target, lintBundle(target))]);
  for (const [target, result] of results) {
    for (const item of result.findings) console.log(formatFinding(target.name, item));
  }

  const waiverHits = new Set(results.flatMap(([, result]) => result.waiversHit));
  if (resolved.isDefaultRun) {
    for (const key of KNOWN_FLAW_GAPS.keys()) {
      if (!waiverHits.has(key)) globalFindings.push(finding("ERROR", "stale_waiver", `KNOWN_FLAW_GAPS no longer reproduces: ${key}`));
    }
    for (const name of KNOWN_BROKEN_BUNDLES.keys()) {
      const result = results.find(([target]) => target.name === name)?.[1];
      if (result && !result.findings.some((item) => item.level === "WARN")) {
        globalFindings.push(finding("ERROR", "stale_waiver", `KNOWN_BROKEN_BUNDLES no longer reproduces: ${name}`));
      }
    }
  }
  const lateFindings = globalFindings.slice(parsed.findings.length + resolved.findings.length);
  for (const item of lateFindings) console.log(formatFinding("<cli>", item));

  const hasError = globalFindings.some((item) => item.level === "ERROR")
    || results.some(([, result]) => result.findings.some((item) => item.level === "ERROR"));
  return hasError ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
