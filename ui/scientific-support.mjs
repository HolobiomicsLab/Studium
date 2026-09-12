/* Render prepared scientific RenderAssets with local, injectable libraries. */

const MAX_PAYLOAD_CHARS = 64 * 1024;
const GENERATED_NOTICE = "AI-generated image; details may be inaccurate.";
const SAFE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const SAFE_AUDIO = /^data:audio\/(?:wav|mpeg);base64,[A-Za-z0-9+/=]+$/;
const SAFE_VIDEO = /^data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/=]+$/;
const SAFE_CAPTIONS = /^data:text\/vtt;base64,[A-Za-z0-9+/=]+$/;
const UNSAFE_MERMAID = [
  /<\s*\/?\s*[a-z!]/i,
  /%%\s*\{/,
  /^\s*click\b/im,
  /(?:https?:|javascript:|data:|file:|\/\/)/i,
  /\b(?:href|src)\s*=/i,
  /@\{[^}]*\b(?:img|icon)\s*:/i,
];
const UNSAFE_LATEX = /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)\b/;
const BLOCKED_SVG_ELEMENTS = "script,foreignObject,image,a,iframe,object,embed";
let diagramSequence = 0;

/** Return whether Mermaid source is passive and cannot request external content. */
export function isSafeMermaidSource(source) {
  return typeof source === "string"
    && source.length > 0
    && source.length <= MAX_PAYLOAD_CHARS
    && !UNSAFE_MERMAID.some((pattern) => pattern.test(source));
}

/** Return an empty string for a supported asset or a readable validation error. */
export function validateSupportAsset(asset) {
  if (!asset || typeof asset !== "object") return "Support is not an object.";
  if (!asset.meta || typeof asset.meta.alt !== "string" || !asset.meta.alt.trim()) {
    return "Support has no accessible text alternative.";
  }
  if (typeof asset.provenance !== "string" || !asset.provenance.trim()) {
    return "Support has no provenance.";
  }
  if (asset.meta.placement && !["before_prediction", "after_prediction"].includes(asset.meta.placement)) {
    return "Support placement is invalid.";
  }
  if (asset.kind === "image") return validateImage(asset);
  if (asset.kind === "audio" || asset.kind === "video") return validateMedia(asset);
  if (asset.kind === "equation_latex") return validateEquation(asset);
  if (asset.kind === "code") return validateMermaid(asset);
  if (asset.kind === "mol_3d") return validateSmiles(asset);
  if (asset.kind === "protocol_md") return validateMediaPrompt(asset);
  return `Unsupported scientific support kind: ${String(asset.kind)}`;
}

/** Replace a container with scientific supports rendered from canonical assets. */
export async function renderScientificSupports(container, assets, options = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("container must be a DOM element");
  }
  const document = container.ownerDocument;
  const entries = (Array.isArray(assets) ? assets : []).map((asset) => createSupportCard(document, asset));
  const cards = entries.map((entry) => entry.card);
  container.replaceChildren(...cards);
  await Promise.all(entries.map((entry) => renderCardBody(document, entry, options)));
}

function createSupportCard(document, asset) {
  const card = element(document, "section", "scientific-support");
  const body = element(document, "div", "scientific-support__body");
  card.append(createHeading(document, asset));
  card.append(body);
  card.append(createProvenance(document, asset));
  return { asset, body, card };
}

async function renderCardBody(document, entry, options) {
  const problem = validateSupportAsset(entry.asset);
  if (problem) {
    entry.body.replaceChildren(createFallback(document, entry.asset, problem));
    return;
  }
  await renderAsset(document, entry.body, entry.asset, options);
}

function createHeading(document, asset) {
  const header = element(document, "header", "scientific-support__header");
  header.append(element(document, "span", "scientific-support__kind", supportLabel(asset)));
  header.append(element(document, "h3", "scientific-support__title", asset?.title || "Scientific support"));
  return header;
}

function supportLabel(asset) {
  if (["image", "audio", "video"].includes(asset?.kind)) {
    return `${asset.kind} · ${asset.meta?.origin || "unknown origin"}`;
  }
  if (asset?.kind === "mol_3d" && asset.format === "smiles") return "molecule · 2D structure";
  if (asset?.kind === "protocol_md") return "media generation instructions";
  return asset?.kind || "support";
}

async function renderAsset(document, mount, asset, options) {
  if (asset.kind === "mol_3d") {
    await renderSmiles(document, mount, asset, options.SmilesDrawer || globalThis.SmilesDrawer);
    return;
  }
  if (asset.kind === "audio" || asset.kind === "video") {
    mount.replaceChildren(renderMedia(document, asset));
    return;
  }
  if (asset.kind === "protocol_md") {
    mount.replaceChildren(renderMediaPrompt(document, asset));
    return;
  }
  let rendered;
  if (asset.kind === "image") rendered = renderImage(document, asset);
  if (asset.kind === "equation_latex") rendered = renderEquation(document, asset, options.katex || globalThis.katex);
  if (asset.kind === "code") rendered = await renderMermaid(document, asset, options.mermaid || globalThis.mermaid);
  mount.replaceChildren(rendered);
}

function renderImage(document, asset) {
  const figure = element(document, "figure", "scientific-support__figure");
  const image = element(document, "img", "scientific-support__image");
  image.src = asset.path;
  image.alt = asset.meta.alt;
  figure.append(image);
  if (asset.meta.origin === "generated") {
    figure.append(element(document, "figcaption", "scientific-support__notice", GENERATED_NOTICE));
  }
  return figure;
}

function renderMedia(document, asset) {
  const wrapper = element(document, "div", "scientific-support__media");
  const player = element(document, asset.kind, `scientific-support__${asset.kind}`);
  player.controls = true;
  player.autoplay = false;
  player.preload = "none";
  player.setAttribute("aria-label", asset.meta.alt);
  const source = createMediaSource(document, asset);
  player.append(source);
  const failure = element(document, "p", "scientific-support__fallback", `Media could not be played. ${asset.meta.alt}`);
  failure.hidden = true;
  const showFailure = () => { player.hidden = true; failure.hidden = false; };
  player.addEventListener("error", showFailure);
  source.addEventListener("error", showFailure);
  if (asset.kind === "video") {
    const track = createCaptionTrack(document, asset);
    track.addEventListener("error", showFailure);
    player.append(track);
  }
  wrapper.append(player, failure, createTranscript(document, asset));
  if (asset.meta.origin === "generated") wrapper.append(createGeneratedNotice(document, asset.kind));
  return wrapper;
}

function createMediaSource(document, asset) {
  const source = element(document, "source", "");
  source.src = asset.path;
  source.type = asset.path.slice(5, asset.path.indexOf(";"));
  return source;
}

function createCaptionTrack(document, asset) {
  const track = element(document, "track", "");
  track.kind = "captions";
  track.src = asset.meta.captions_data_uri;
  track.srclang = asset.meta.captions_language;
  track.label = asset.meta.captions_language;
  track.default = true;
  return track;
}

function createTranscript(document, asset) {
  const details = element(document, "details", "scientific-support__transcript");
  details.append(element(document, "summary", "", "Transcript"));
  details.append(element(document, "p", "", asset.meta.transcript));
  return details;
}

function createGeneratedNotice(document, kind) {
  return element(document, "p", "scientific-support__notice", `AI-generated ${kind}; details may be inaccurate.`);
}

function renderMediaPrompt(document, asset) {
  const wrapper = element(document, "div", "scientific-support__prompt");
  const text = element(document, "pre", "scientific-support__prompt-text", asset.payload);
  text.setAttribute("aria-label", asset.meta.alt);
  const button = element(document, "button", "scientific-support__download", "Download instructions");
  button.type = "button";
  button.addEventListener("click", () => downloadPrompt(document, asset));
  wrapper.append(text, button);
  return wrapper;
}

function downloadPrompt(document, asset) {
  const anchor = element(document, "a", "");
  anchor.href = `data:text/plain;charset=utf-8,${encodeURIComponent(asset.payload)}`;
  anchor.download = asset.meta.generation.download_filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function renderEquation(document, asset, katex) {
  const output = element(document, "div", "scientific-support__equation");
  if (!katex || typeof katex.render !== "function") return createFallback(document, asset, "KaTeX is unavailable.");
  try {
    katex.render(asset.payload, output, {
      displayMode: true, output: "htmlAndMathml", strict: "error", throwOnError: true, trust: false,
    });
    output.setAttribute("aria-label", asset.meta.alt);
    return output;
  } catch (error) {
    return createFallback(document, asset, `Equation could not be rendered: ${errorMessage(error)}`);
  }
}

async function renderMermaid(document, asset, mermaid) {
  if (!mermaid || typeof mermaid.render !== "function") return createFallback(document, asset, "Mermaid is unavailable.");
  try {
    configureMermaid(mermaid);
    const result = await mermaid.render(`studium-support-${++diagramSequence}`, asset.payload);
    const svg = parseSafeSvg(document, result.svg);
    if (!svg) return createFallback(document, asset, "Mermaid returned unsafe diagram markup.");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", asset.meta.alt);
    return withTextAlternative(document, svg, asset);
  } catch (error) {
    return createFallback(document, asset, `Diagram could not be rendered: ${errorMessage(error)}`);
  }
}

function configureMermaid(mermaid) {
  if (typeof mermaid.initialize !== "function") return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    suppressErrorRendering: true,
    maxTextSize: MAX_PAYLOAD_CHARS,
    theme: "base",
    themeVariables: {
      primaryColor: "#edf5f3",
      primaryBorderColor: "#8daba5",
      primaryTextColor: "#193039",
      lineColor: "#53666e",
      fontFamily: "Arial, sans-serif",
    },
  });
}

function parseSafeSvg(document, markup) {
  const Parser = document.defaultView?.DOMParser || globalThis.DOMParser;
  if (!Parser || typeof markup !== "string") return null;
  const parsed = new Parser().parseFromString(markup, "image/svg+xml");
  const svg = parsed.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg" || parsed.querySelector("parsererror")) return null;
  if (svg.querySelector(BLOCKED_SVG_ELEMENTS) || hasUnsafeSvgAttributes(svg)) return null;
  return document.importNode(svg, true);
}

function hasUnsafeSvgAttributes(svg) {
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || ["href", "xlink:href", "src"].includes(name)) return true;
      if (!name.startsWith("xmlns") && hasExternalReference(attribute.value)) return true;
    }
    if (node.nodeName.toLowerCase() === "style" && hasExternalReference(node.textContent || "")) return true;
  }
  return false;
}

function hasExternalReference(value) {
  return /(?:https?:|javascript:|data:|file:|\/\/|@import)/i.test(value)
    || /url\(\s*["']?(?!#)/i.test(value);
}

async function renderSmiles(document, mount, asset, library) {
  const SmilesDrawer = library?.default || library;
  if (!SmilesDrawer?.SvgDrawer || typeof SmilesDrawer.parse !== "function") {
    mount.replaceChildren(createFallback(document, asset, "The 2D molecule renderer is unavailable."));
    return;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "scientific-support__molecule");
  const moleculeId = `studium-molecule-${++diagramSequence}`;
  svg.setAttribute("id", moleculeId);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", asset.meta.alt);
  const wrapper = withTextAlternative(document, svg, asset);
  mount.replaceChildren(wrapper);
  const result = await drawSmiles(SmilesDrawer, asset.payload, svg, moleculeId);
  if (result) mount.replaceChildren(createFallback(document, asset, `SMILES could not be rendered: ${result}`));
}

function drawSmiles(SmilesDrawer, smiles, svg, moleculeId) {
  return new Promise((resolve) => {
    SmilesDrawer.parse(smiles, (tree) => {
      try {
        new SmilesDrawer.SvgDrawer({ width: 420, height: 280 }).draw(tree, svg, "light");
        namespaceSvgIds(svg, moleculeId);
        resolve(svg.childElementCount > 0 && !hasUnsafeSvgAttributes(svg) ? "" : "renderer produced unsafe or empty SVG");
      } catch (error) {
        resolve(errorMessage(error));
      }
    }, (error) => resolve(errorMessage(error)));
  });
}

function namespaceSvgIds(svg, prefix) {
  const replacements = new Map();
  for (const node of svg.querySelectorAll("[id]")) {
    if (node === svg) continue;
    const oldId = node.getAttribute("id");
    const newId = `${prefix}-${oldId}`;
    replacements.set(oldId, newId);
    node.setAttribute("id", newId);
  }
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...node.attributes]) {
      let value = attribute.value;
      for (const [oldId, newId] of replacements) value = value.split(`#${oldId}`).join(`#${newId}`);
      if (value !== attribute.value) node.setAttribute(attribute.name, value);
    }
  }
}

function withTextAlternative(document, visual, asset) {
  const wrapper = element(document, "div", "scientific-support__visual");
  wrapper.append(visual, createTextAlternative(document, asset));
  return wrapper;
}

function createTextAlternative(document, asset) {
  const details = element(document, "details", "scientific-support__alternative");
  details.append(element(document, "summary", "", "Text alternative"));
  details.append(element(document, "p", "", asset.meta.alt));
  details.append(element(document, "pre", "", asset.payload));
  return details;
}

function createFallback(document, asset, message) {
  const fallback = element(document, "div", "scientific-support__fallback");
  fallback.setAttribute("role", "note");
  fallback.append(element(document, "p", "", `${message} ${asset?.meta?.alt || "No description supplied."}`));
  if (typeof asset?.payload === "string") fallback.append(element(document, "pre", "", asset.payload));
  if (typeof asset?.meta?.transcript === "string") fallback.append(element(document, "p", "", asset.meta.transcript));
  return fallback;
}

function createProvenance(document, asset) {
  const footer = element(document, "footer", "scientific-support__provenance");
  footer.append(element(document, "span", "", `Provenance: ${asset?.provenance || "unavailable"}`));
  if (asset?.meta?.rights) footer.append(createRights(document, asset.meta.rights));
  return footer;
}

function createRights(document, rights) {
  const wrapper = element(document, "div", "scientific-support__rights-claim");
  wrapper.append(element(document, "p", "", "Rights metadata is an authored claim, not a legal determination."));
  const list = element(document, "dl", "scientific-support__rights");
  const fields = [
    ["Creator", rights.creator], ["License", rights.license],
    ["Rights evidence", rights.evidence_url], ["Intended scope", rights.scope],
  ];
  if (rights.adaptations) fields.push(["Adaptations", rights.adaptations]);
  for (const [label, value] of fields) {
    list.append(element(document, "dt", "", label), element(document, "dd", "", value));
  }
  wrapper.append(list);
  return wrapper;
}

function validateEquation(asset) {
  if (!validPayload(asset.payload)) return "Equation payload is missing or too large.";
  return UNSAFE_LATEX.test(asset.payload) ? "Equation contains unsupported active commands." : "";
}

function validateImage(asset) {
  if (!SAFE_IMAGE.test(asset.path || "")) return "Image was not prepared locally.";
  if (asset.meta.rights) {
    const rightsProblem = validateRights(asset.meta.rights);
    if (rightsProblem) return rightsProblem;
  }
  return ["source", "generated"].includes(asset.meta.origin) ? "" : "Image origin is not declared.";
}

function validateMedia(asset) {
  const safePath = asset.kind === "audio" ? SAFE_AUDIO : SAFE_VIDEO;
  if (!safePath.test(asset.path || "")) return `${asset.kind} was not prepared locally.`;
  if (!["source", "generated"].includes(asset.meta.origin)) return `${asset.kind} origin is not declared.`;
  if (!validPayload(asset.meta.transcript)) return `${asset.kind} transcript is unavailable.`;
  const rightsProblem = validateRights(asset.meta.rights);
  if (rightsProblem) return rightsProblem;
  if (asset.kind === "video" && !SAFE_CAPTIONS.test(asset.meta.captions_data_uri || "")) return "Video captions are unavailable.";
  return "";
}

function validateRights(rights) {
  if (!rights || typeof rights !== "object") return "Media rights metadata is unavailable.";
  if (![rights.creator, rights.license, rights.evidence_url].every(validPayload)) return "Media rights metadata is incomplete.";
  return ["private", "course", "public"].includes(rights.scope) ? "" : "Media rights scope is invalid.";
}

function validateMediaPrompt(asset) {
  if (asset.format !== "studium-media-prompt" || !validPayload(asset.payload)) return "Media prompt is invalid.";
  const generation = asset.meta.generation;
  if (!generation || typeof generation !== "object") return "Media generation metadata is unavailable.";
  if (!validPayload(generation.download_filename) || /[/\\]/.test(generation.download_filename)) return "Prompt filename is invalid.";
  return "";
}

function validateMermaid(asset) {
  if (asset.language !== "mermaid") return "Code support is not Mermaid.";
  return isSafeMermaidSource(asset.payload) ? "" : "Mermaid source is unsafe.";
}

function validateSmiles(asset) {
  if (asset.format !== "smiles") return "Molecule support is not SMILES.";
  return validPayload(asset.payload) && !/[\x00-\x1f]/.test(asset.payload) ? "" : "SMILES payload is invalid.";
}

function validPayload(payload) {
  return typeof payload === "string" && payload.trim().length > 0 && payload.length <= MAX_PAYLOAD_CHARS;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

if (typeof window !== "undefined") {
  window.renderScientificSupports = renderScientificSupports;
  window.StudiumSupport = { ...(window.StudiumSupport || {}), renderScientificSupports };
}
