/** Deterministic calculations for the linked synthetic spectrum viewer. */

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`Invalid network: ${label} must be finite`);
}

function validateSpectrum(node) {
  if (!node?.id || !Array.isArray(node.peaks) || node.peaks.length === 0)
    throw new Error("Invalid network: each node needs an ID and peaks");
  requireFinite(node.precursor_mz, `${node.id} precursor_mz`);
  if (node.precursor_mz <= 0) throw new Error(`Invalid network: ${node.id} precursor must be positive`);
  for (const peak of node.peaks) {
    if (!Array.isArray(peak) || peak.length !== 2) throw new Error(`Invalid network: malformed peak in ${node.id}`);
    peak.forEach((value) => requireFinite(value, `${node.id} peak`));
    if (peak[0] <= 0 || peak[1] < 0) throw new Error(`Invalid network: impossible peak in ${node.id}`);
  }
  if (!node.peaks.some((peak) => peak[1] > 0)) throw new Error(`Invalid network: ${node.id} has zero signal`);
}

/** Validate the complete linked-viewer input before any rendering. */
export function validateNetwork(network) {
  if (network?.schema !== "studium/linked-spectrum-network/v1" || !/synthetic/i.test(network.note || ""))
    throw new Error("Invalid network: expected explicitly synthetic linked-spectrum data");
  if (!Array.isArray(network.nodes) || network.nodes.length < 3) throw new Error("Invalid network: at least three nodes required");
  network.nodes.forEach(validateSpectrum);
  const nodeIds = network.nodes.map((node) => node.id);
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error("Invalid network: node IDs must be unique");
  if (!nodeIds.includes(network.focal_id)) throw new Error("Invalid network: focal ID is absent");
  if (!Array.isArray(network.candidates) || network.candidates.some((row) => !nodeIds.includes(row.node_id)))
    throw new Error("Invalid network: candidate IDs must reference nodes");
  requireFinite(network.fragment_tol_da, "fragment_tol_da");
  requireFinite(network.baseline_threshold, "baseline_threshold");
  if (network.fragment_tol_da <= 0 || network.baseline_threshold < 0 || network.baseline_threshold > 1)
    throw new Error("Invalid network: tolerance or threshold outside its range");
  return network;
}

function normalizedPeaks(node) {
  const norm = Math.hypot(...node.peaks.map((peak) => peak[1]));
  return node.peaks.map(([mz, intensity]) => [mz, intensity / norm]);
}

function candidatePairs(first, second, tolerance, allowShift) {
  const firstPeaks = normalizedPeaks(first), secondPeaks = normalizedPeaks(second);
  const shift = first.precursor_mz - second.precursor_mz, candidates = [];
  firstPeaks.forEach(([firstMz, firstIntensity], firstIndex) => secondPeaks.forEach(([secondMz, secondIntensity], secondIndex) => {
    const isDirect = Math.abs(firstMz - secondMz) <= tolerance;
    const isShifted = Math.abs((firstMz - secondMz) - shift) <= tolerance;
    if (isDirect || (allowShift && isShifted)) candidates.push({ first_index: firstIndex, second_index: secondIndex,
      kind: isDirect ? "direct" : "shift", contribution: firstIntensity * secondIntensity });
  }));
  return candidates.sort((left, right) => right.contribution - left.contribution
    || left.first_index - right.first_index || left.second_index - right.second_index);
}

/** Compute greedy precursor-aware modified cosine and its selected peak pairs. */
export function modifiedCosine(first, second, tolerance, allowShift = true) {
  validateSpectrum(first); validateSpectrum(second); requireFinite(tolerance, "tolerance");
  if (tolerance <= 0) throw new Error("Invalid network: tolerance must be positive");
  const usedFirst = new Set(), usedSecond = new Set(), pairs = [];
  for (const pair of candidatePairs(first, second, tolerance, allowShift)) {
    if (usedFirst.has(pair.first_index) || usedSecond.has(pair.second_index)) continue;
    usedFirst.add(pair.first_index); usedSecond.add(pair.second_index); pairs.push(pair);
  }
  return { score: Math.min(1, pairs.reduce((sum, pair) => sum + pair.contribution, 0)), pairs };
}

function calculateEdges(network) {
  const edges = [];
  network.nodes.forEach((source, sourceIndex) => network.nodes.slice(sourceIndex + 1).forEach((target) => {
    const result = modifiedCosine(source, target, network.fragment_tol_da);
    edges.push({ id: `${source.id}--${target.id}`, source: source.id, target: target.id, score: result.score,
      matched_peaks: result.pairs.length });
  }));
  return edges.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

/** Compute all pair scores and the thresholded edge set without touching the DOM. */
export function calculateNetwork(network, threshold = network.baseline_threshold) {
  validateNetwork(network); requireFinite(threshold, "threshold");
  if (threshold < 0 || threshold > 1) throw new Error("Invalid network: threshold outside 0–1");
  const allEdges = calculateEdges(network);
  return { node_ids: network.nodes.map((node) => node.id), all_edges: allEdges,
    visible_edges: allEdges.filter((edge) => edge.score >= threshold), threshold };
}

/** Compare a current edge set with the immutable baseline edge set. */
export function compareWithBaseline(network, threshold) {
  const baseline = calculateNetwork(network), current = calculateNetwork(network, threshold);
  const baselineIds = new Set(baseline.visible_edges.map((edge) => edge.id));
  const currentIds = new Set(current.visible_edges.map((edge) => edge.id));
  const added = current.visible_edges.filter((edge) => !baselineIds.has(edge.id)).map((edge) => edge.id);
  const removed = baseline.visible_edges.filter((edge) => !currentIds.has(edge.id)).map((edge) => edge.id);
  const stable = current.visible_edges.filter((edge) => baselineIds.has(edge.id)).map((edge) => edge.id);
  return { baseline, current, added, removed, stable, has_change: added.length + removed.length > 0 };
}
