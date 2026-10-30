import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, "../../../design/tokens.json"), "utf8"));

const FONT_DISPLAY = tokens.typography.font.display;
const FONT_TEXT = tokens.typography.font.text;
let activeTheme;

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function theme(name) {
  const c = tokens.color[name];
  return {
    ...c,
    name,
    canvas: c.canvas,
    surface: c.surface,
    raised: c["surface-raised"],
    mutedSurface: c["surface-muted"],
    text: c.text,
    muted: c.muted,
    accent: c.accent,
    accentSoft: c["accent-soft"],
    accent2: c["accent-2"],
    accent2Soft: c["accent-2-soft"],
    success: c.success,
    successSoft: c["success-soft"],
    warning: c.warning,
    warningSoft: c["warning-soft"],
    danger: c.danger,
    dangerSoft: c["danger-soft"],
    info: c.info,
    infoSoft: c["info-soft"],
    border: c.border,
    borderStrong: c["border-strong"],
    ungraded: c["scene-ungraded"],
    ungradedSoft: c["scene-ungraded-soft"],
    author: c["scene-author-keyed"],
    authorSoft: c["scene-author-keyed-soft"],
    production: c["scene-production"],
    productionSoft: c["scene-production-soft"],
    external: c["scene-externally-grounded"],
    externalSoft: c["scene-externally-grounded-soft"],
    concept: c["node-concept"],
    conceptSoft: c["node-concept-soft"],
    task: c["node-task"],
    taskSoft: c["node-task-soft"],
    mastered: c["node-mastered"],
    masteredSoft: c["node-mastered-soft"],
    due: c["node-due"],
    dueSoft: c["node-due-soft"],
  };
}

function svgOpen({ width, height, title, desc, t, id }) {
  activeTheme = t;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="${id}-title ${id}-desc">
  <title id="${id}-title">${esc(title)}</title>
  <desc id="${id}-desc">${esc(desc)}</desc>
  <rect width="${width}" height="${height}" fill="${t.canvas}"/>
`;
}

function text(x, y, value, cls = "body", extra = "") {
  const defaults = {
    display: { family: FONT_DISPLAY, fill: activeTheme.text, size: "46", weight: "600", spacing: "-0.035em" },
    label: { family: FONT_TEXT, fill: activeTheme.text, size: "20", weight: "600", spacing: "0" },
    body: { family: FONT_TEXT, fill: activeTheme.text, size: "20", weight: "400", spacing: "0" },
    small: { family: FONT_TEXT, fill: activeTheme.muted, size: "20", weight: "400", spacing: "0" },
    "small-ink": { family: FONT_TEXT, fill: activeTheme.text, size: "20", weight: "400", spacing: "0" },
    eyebrow: { family: FONT_TEXT, fill: activeTheme.text, size: "20", weight: "700", spacing: "0.08em" },
  };
  const base = defaults[cls] ?? defaults.body;
  const overrides = {};
  const remaining = {};
  for (const match of extra.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    if (match[1] === "style") {
      for (const declaration of match[2].split(";")) {
        const split = declaration.indexOf(":");
        if (split > 0) overrides[declaration.slice(0, split).trim()] = declaration.slice(split + 1).trim();
      }
    } else {
      overrides[match[1]] = match[2];
    }
  }
  const known = new Set(["font-family", "font-size", "font-weight", "fill", "letter-spacing"]);
  for (const [name, attributeValue] of Object.entries(overrides)) {
    if (!known.has(name)) remaining[name] = attributeValue;
  }
  const attributes = [
    `x="${x}"`,
    `y="${y}"`,
    `class="${cls}"`,
    `font-family="${esc(overrides["font-family"] ?? base.family)}"`,
    `font-size="${esc(overrides["font-size"] ?? base.size)}"`,
    `font-weight="${esc(overrides["font-weight"] ?? base.weight)}"`,
    `fill="${esc(overrides.fill ?? base.fill)}"`,
  ];
  const spacing = overrides["letter-spacing"] ?? base.spacing;
  if (spacing) attributes.push(`letter-spacing="${esc(spacing)}"`);
  for (const [name, attributeValue] of Object.entries(remaining)) attributes.push(`${name}="${esc(attributeValue)}"`);
  return `<text ${attributes.join(" ")}>${esc(value)}</text>`;
}

function lines(x, y, values, cls = "body", step = 29, anchor = "start") {
  return values.map((value, i) => text(x, y + i * step, value, cls, `text-anchor="${anchor}"`)).join("\n");
}

function rect(x, y, w, h, fill, stroke, r = 16, extra = "") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${extra}/>`;
}

function card(t, { x, y, w, h, title, body = [], fill = t.surface, stroke = t.border, titleColor = t.text, eyebrow = null, bodyClass = "body" }) {
  const titleY = y + (eyebrow ? 63 : 45);
  return [
    rect(x, y, w, h, fill, stroke, 18),
    eyebrow ? text(x + 24, y + 30, eyebrow, "eyebrow") : "",
    text(x + 24, titleY, title, "label", `font-size="24" style="fill:${titleColor}"`),
    lines(x + 24, titleY + 39, body, bodyClass, 29),
  ].join("\n");
}

function pill(t, x, y, w, label, fill = t.accentSoft, stroke = t.accent, color = t.accent) {
  return `${rect(x, y, w, 42, fill, stroke, 21)}\n${text(x + w / 2, y + 28, label, "label", `font-size="20" style="fill:${color}" text-anchor="middle"`)}`;
}

function stepBadge(t, x, y, number) {
  return `${rect(x, y, 46, 46, t.accent, t.accent, 23)}\n${text(x + 23, y + 31, number, "label", `font-size="20" style="fill:${t["on-accent"]}" text-anchor="middle"`)}`;
}

function arrow(x1, y1, x2, y2, cls = "line") {
  return path(`M ${x1} ${y1} L ${x2} ${y2}`, cls);
}

function samplePath(d, spacing = 2) {
  const tokens = d.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const points = [];
  let i = 0;
  let current = { x: 0, y: 0 };
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === "M") {
      current = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      points.push(current);
      continue;
    }
    if (command === "L") {
      const end = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      const length = Math.hypot(end.x - current.x, end.y - current.y);
      const divisions = Math.max(1, Math.ceil(length / spacing));
      for (let n = 1; n <= divisions; n += 1) {
        const t = n / divisions;
        points.push({ x: current.x + (end.x - current.x) * t, y: current.y + (end.y - current.y) * t });
      }
      current = end;
      continue;
    }
    if (command === "C") {
      const c1 = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      const c2 = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      const end = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      const estimate = Math.hypot(c1.x - current.x, c1.y - current.y)
        + Math.hypot(c2.x - c1.x, c2.y - c1.y)
        + Math.hypot(end.x - c2.x, end.y - c2.y);
      const divisions = Math.max(1, Math.ceil(estimate / spacing));
      const start = current;
      for (let n = 1; n <= divisions; n += 1) {
        const t = n / divisions;
        const u = 1 - t;
        points.push({
          x: u ** 3 * start.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * end.x,
          y: u ** 3 * start.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * end.y,
        });
      }
      current = end;
      continue;
    }
    throw new Error(`Unsupported path command: ${command}`);
  }
  return points;
}

function dashedPathData(d, dashLength = 10, gapLength = 8) {
  const points = samplePath(d);
  if (points.length < 2) return d;
  const period = dashLength + gapLength;
  let distance = 0;
  let drawing = false;
  let output = "";
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const shouldDraw = (distance % period) < dashLength;
    if (shouldDraw && !drawing) output += ` M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;
    if (shouldDraw) output += ` L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    drawing = shouldDraw;
    distance += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return output.trim();
}

function path(d, cls = "line") {
  const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  const [x1, y1, x2, y2] = numbers.slice(-4);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const muted = cls.includes("muted");
  const color = muted ? activeTheme.borderStrong : activeTheme.accent;
  const strokeWidth = muted ? 2.2 : 2.5;
  const renderedPath = cls.includes("dash") ? dashedPathData(d) : d;
  if (!Number.isFinite(length) || length < 0.001) {
    return `<path d="${renderedPath}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const ux = dx / length;
  const uy = dy / length;
  const baseX = x2 - 10 * ux;
  const baseY = y2 - 10 * uy;
  const wingX = 5 * -uy;
  const wingY = 5 * ux;
  const head = `M ${x2} ${y2} L ${baseX + wingX} ${baseY + wingY} L ${baseX - wingX} ${baseY - wingY} Z`;
  return `<path d="${renderedPath}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="${head}" fill="${color}" stroke="none"/>`;
}

function architecture(t) {
  const title = "Studium architecture";
  const desc = "Author-time Python services produce a LessonBundle and typed Learning Workflow Graph. Runtime packages expose sessions through MCP, HTTP, and a file channel to learner clients, while teacher and Observatory surfaces remain review paths.";
  let s = svgOpen({ width: 1200, height: 1150, title, desc, t, id: "architecture" });
  s += text(40, 58, title, "display", 'font-size="46"');
  s += text(40, 94, "One course contract, several learner and review paths", "small");

  s += card(t, { x: 40, y: 145, w: 160, h: 235, title: "Sources", body: ["Documents", "ASB capsule"], fill: t.raised, eyebrow: "INPUT" });

  s += rect(250, 115, 290, 295, t.surface, t.border, 18);
  s += text(274, 146, "AUTHOR TIME", "eyebrow");
  s += text(274, 181, "Python services", "label", 'font-size="26"');
  s += pill(t, 280, 205, 230, "ingest", t.infoSoft, t.info, t.info);
  s += arrow(395, 249, 395, 266, "line-muted");
  s += pill(t, 280, 274, 230, "planner", t.accentSoft, t.accent, t.accent);
  s += arrow(395, 318, 395, 335, "line-muted");
  s += pill(t, 280, 343, 230, "scene-synth", t.authorSoft, t.author, t.author);

  s += rect(590, 115, 280, 295, t.surface, t.border, 18);
  s += text(614, 146, "COURSE CONTRACTS", "eyebrow");
  s += text(614, 181, "Typed artifacts", "label", 'font-size="26"');
  s += pill(t, 615, 205, 230, "LessonBundle JSON", t.accent2Soft, t.accent2, t.accent2);
  s += rect(615, 270, 230, 118, t.mutedSurface, t.border, 14);
  s += text(635, 296, "Learning Workflow", "label", 'font-size="20"');
  s += text(635, 320, "Graph", "label", 'font-size="20"');
  s += `<circle cx="654" cy="352" r="17" fill="${t.conceptSoft}" stroke="${t.concept}" stroke-width="2"/>`;
  s += text(680, 375, "typed edge", "small-ink");
  s += `<rect x="782" y="335" width="34" height="34" rx="8" fill="${t.taskSoft}" stroke="${t.task}" stroke-width="2"/>`;
  s += arrow(673, 352, 778, 352, "line-muted");

  s += card(t, { x: 920, y: 115, w: 240, h: 295, title: "Adaptive runtime", body: ["lesson-session", "adaptation-engine", "learner-state", "", "navigation • mastery", "FSRS • calibration"], fill: t.surface, eyebrow: "RUNTIME" });

  s += arrow(200, 260, 242, 260);
  s += arrow(540, 260, 582, 260);
  s += arrow(870, 260, 912, 260);

  s += card(t, { x: 410, y: 485, w: 380, h: 160, title: "Session host", body: ["lesson-session-host", "multi-session, learner-scoped"], fill: t.accentSoft, stroke: t.accent, eyebrow: "HOST" });
  s += path("M 1040 410 C 1040 470, 800 470, 790 535", "line");
  s += pill(t, 425, 662, 110, "MCP", t.raised, t.borderStrong, t.text);
  s += pill(t, 545, 662, 110, "HTTP", t.raised, t.borderStrong, t.text);
  s += pill(t, 665, 662, 125, "file channel", t.raised, t.borderStrong, t.text);

  s += card(t, { x: 40, y: 750, w: 530, h: 175, title: "VS Code surfaces", body: ["Lesson pane + live graph", "Notebook + chat companion"], fill: t.infoSoft, stroke: t.info, eyebrow: "LEARNER CLIENT" });
  s += card(t, { x: 630, y: 750, w: 530, h: 175, title: "AI harnesses", body: ["Codex • Claude Code • Copilot", "drive the same public session contract"], fill: t.accentSoft, stroke: t.accent, eyebrow: "LEARNER CLIENT" });
  s += path("M 545 704 C 500 720, 360 720, 305 742", "line");
  s += path("M 655 704 C 700 720, 840 720, 895 742", "line");

  s += path("M 845 226 L 885 226 L 885 90 L 1180 90 L 1180 920 L 1080 950", "line-muted dash");
  s += pill(t, 970, 520, 184, "review artifacts", t.mutedSurface, t.borderStrong, t.muted);

  s += rect(120, 960, 960, 155, t.surface, t.border, 18);
  s += text(146, 994, "REVIEW SURFACES — SEPARATE FROM LEARNER CLIENTS", "eyebrow");
  s += rect(150, 1012, 420, 78, t.warningSoft, t.warning, 14);
  s += text(174, 1044, "Teacher dashboard", "label", `font-size="23" style="fill:${t.warning}"`);
  s += text(174, 1073, "class + learner-contribution review", "small-ink");
  s += rect(630, 1012, 420, 78, t.externalSoft, t.external, 14);
  s += text(654, 1044, "Observatory / MySTRA", "label", `font-size="23" style="fill:${t.external}"`);
  s += text(654, 1073, "provenance + audit review", "small-ink");
  s += "</svg>\n";
  return s;
}

function learningLoop(t) {
  const title = "The adaptive learning loop";
  const desc = "A scene receives a learner answer, is handled by one of four key classes, and only certified correctness updates Beta mastery and FSRS memory. Keyword-only feedback and ungraded scenes bypass those updates before routing to the next scene or a due review queue.";
  let s = svgOpen({ width: 1200, height: 1400, title, desc, t, id: "learning-loop" });
  s += text(40, 58, title, "display", 'font-size="46"');
  s += text(40, 94, "Correctness provenance controls what the engine is allowed to learn", "small");

  s += card(t, { x: 40, y: 155, w: 190, h: 130, title: "Scene", body: ["public prompt", "+ artifacts"], fill: t.raised });
  s += card(t, { x: 270, y: 155, w: 190, h: 130, title: "Answer", body: ["typed learner", "response"], fill: t.raised });
  s += arrow(230, 220, 262, 220);
  s += arrow(460, 220, 502, 220);

  s += rect(510, 115, 650, 610, t.surface, t.border, 18);
  s += text(538, 151, "GRADE BY KEY CLASS", "eyebrow");
  s += text(538, 184, "Who supplies the key?", "label", 'font-size="27"');

  s += rect(538, 205, 594, 78, t.ungradedSoft, t.ungraded, 14);
  s += text(560, 235, "Ungraded", "label", `font-size="23" style="fill:${t.ungraded}"`);
  s += text(560, 264, "intro • concept • meta_checkpoint  →  no correctness", "small-ink");

  s += rect(538, 295, 594, 108, t.authorSoft, t.author, 14);
  s += text(560, 326, "Author keyed", "label", `font-size="23" style="fill:${t.author}"`);
  s += text(560, 355, "quiz • spot_the_flaw  →  marked key", "small-ink");
  s += text(560, 383, "self-study: open book", "small-ink");

  s += rect(538, 415, 594, 180, t.productionSoft, t.production, 14);
  s += text(560, 446, "Production", "label", `font-size="23" style="fill:${t.production}"`);
  s += text(560, 475, "explain_back • comparison • summary_audit", "small-ink");
  s += text(560, 503, "prompt_practice • communication_sim", "small-ink");
  s += text(560, 531, "discussion • ai_critique", "small-ink");
  s += pill(t, 560, 542, 245, "model judge → certified", t.successSoft, t.success, t.success);
  s += pill(t, 820, 542, 288, "keywords → feedback only", t.warningSoft, t.warning, t.warning);

  s += rect(538, 607, 594, 88, t.externalSoft, t.external, 14);
  s += text(560, 638, "Externally grounded", "label", `font-size="23" style="fill:${t.external}"`);
  s += text(560, 667, "reproduction  →  attested execution result", "small-ink");

  s += card(t, { x: 100, y: 790, w: 430, h: 180, title: "Mastery + memory", body: ["Beta posterior", "IRT-weighted item difficulty", "FSRS review memory"], fill: t.successSoft, stroke: t.success, eyebrow: "CERTIFIED PATH" });
  s += card(t, { x: 100, y: 1010, w: 430, h: 150, title: "Feedback / ungraded bypass", body: ["coverage hint or acknowledgement", "no Beta or FSRS update"], fill: t.warningSoft, stroke: t.warning, eyebrow: "BYPASS" });
  s += card(t, { x: 700, y: 860, w: 410, h: 230, title: "Adaptation + routing", body: ["rules + LWG prerequisites", "remediation or next scene", "mastery pacing", "review target when due"], fill: t.accentSoft, stroke: t.accent, eyebrow: "DECISION" });

  s += path("M 735 725 C 660 760, 470 755, 420 782", "line");
  s += text(650, 780, "certified result", "small", 'text-anchor="middle"');
  s += path("M 575 725 C 420 735, 220 735, 80 760 L 80 1085 L 100 1085", "line-muted dash");
  s += text(300, 765, "no certified correctness", "small", 'text-anchor="middle"');
  s += arrow(530, 885, 692, 928);
  s += path("M 530 1085 C 615 1085, 635 1045, 692 1020", "line-muted dash");

  s += card(t, { x: 120, y: 1210, w: 300, h: 105, title: "Next scene", body: ["or remediation"], fill: t.infoSoft, stroke: t.info });
  s += card(t, { x: 760, y: 1210, w: 300, h: 105, title: "Review queue", body: ["scheduled / due state"], fill: t.dueSoft, stroke: t.due });
  s += path("M 820 1090 C 790 1140, 700 1180, 540 1180 C 440 1180, 370 1190, 330 1202", "line");
  s += path("M 950 1090 C 970 1140, 950 1165, 920 1202", "line");
  s += path("M 120 1263 C 20 1263, 20 340, 95 293", "line");
  s += path("M 910 1315 L 910 1360 L 270 1360 L 270 1323", "line-muted dash");
  s += text(590, 1352, "when selected", "small", 'text-anchor="middle"');

  s += rect(440, 1203, 300, 118, t.surface, t.border, 14);
  s += text(465, 1235, "LWG legend", "label", 'font-size="22"');
  s += `<circle cx="472" cy="1267" r="14" fill="${t.conceptSoft}" stroke="${t.concept}" stroke-width="2"/>`;
  s += text(495, 1274, "concept", "small");
  s += `<rect x="572" y="1253" width="28" height="28" rx="7" fill="${t.taskSoft}" stroke="${t.task}" stroke-width="2"/>`;
  s += text(610, 1274, "task", "small");
  s += text(465, 1307, "mastered + due = states", "small");
  s += "</svg>\n";
  return s;
}

function selfLearnerJourney(t) {
  const title = "Self-learner journey";
  const desc = "A learner requests a lesson in an AI harness, checks reference licences, extracts passages, lets the agent draft a self-study lesson, reviews the outline, enters play with the authoring notice already visible, and later returns through the FSRS review queue when concepts become due.";
  let s = svgOpen({ width: 1200, height: 970, title, desc, t, id: "self-learner" });
  s += text(40, 58, title, "display", 'font-size="46"');
  s += text(40, 94, "From chosen references to a transparent, playable self-study lesson", "small");

  const top = [
    { x: 30, n: "1", title: "Harness request", body: ["goal + audience", "preferred activity"] },
    { x: 320, n: "2", title: "References", body: ["choose source", "check licence + reuse"] },
    { x: 610, n: "3", title: "Passages", body: ["extract exact text", "retain provenance"] },
    { x: 900, n: "4", title: "Agent draft", body: ["sourced plan + scenes", "status stays draft"] },
  ];
  for (const item of top) {
    s += card(t, { x: item.x, y: 155, w: 270, h: 215, title: item.title, body: item.body, fill: t.surface, eyebrow: `STEP ${item.n}` });
    s += stepBadge(t, item.x + 218, 171, item.n);
  }
  s += arrow(300, 262, 312, 262);
  s += arrow(590, 262, 602, 262);
  s += arrow(880, 262, 892, 262);

  s += rect(150, 430, 900, 76, t.warningSoft, t.warning, 16);
  s += text(600, 462, "SELF-STUDY • learner-authored • not teacher-validated • not published", "label", `font-size="22" style="fill:${t.warning}" text-anchor="middle"`);
  s += text(600, 490, "The learner reviews the outline; no teacher approval is implied.", "small-ink", 'text-anchor="middle"');

  s += card(t, { x: 70, y: 585, w: 310, h: 240, title: "Outline review", body: ["objectives • concepts", "scene titles + types", "sources, without answer keys"], fill: t.accentSoft, stroke: t.accent, eyebrow: "STEP 5" });
  s += stepBadge(t, 302, 601, "5");
  s += card(t, { x: 445, y: 585, w: 310, h: 240, title: "Play + notice", body: ["notice appears before scene", "author-keyed = open book", "judge / keyword limit shown"], fill: t.infoSoft, stroke: t.info, eyebrow: "STEP 6" });
  s += stepBadge(t, 677, 601, "6");
  s += card(t, { x: 820, y: 585, w: 310, h: 240, title: "Return when due", body: ["FSRS queue", "due state days later", "learner starts review"], fill: t.dueSoft, stroke: t.due, eyebrow: "STEP 7" });
  s += stepBadge(t, 1052, 601, "7");

  s += path("M 1035 370 L 1080 370 L 1080 545 L 225 545 L 225 577", "line");
  s += arrow(380, 705, 437, 705);
  s += arrow(755, 705, 812, 705);
  s += path("M 975 825 C 975 930, 600 930, 600 825", "line-muted dash");
  s += text(620, 858, "Learner selects due review", "small");
  s += "</svg>\n";
  return s;
}

function teacherJourney(t) {
  const title = "Teacher journey";
  const desc = "A teacher moves from sources to an evidence packet, a sourced draft, checks and lint, MySTRA inspection, explicit rule-003 human approval, and class delivery. A separate loop reviews learner contributions in the teacher dashboard before approved community bundles can return to class.";
  let s = svgOpen({ width: 1200, height: 1280, title, desc, t, id: "teacher-journey" });
  s += text(40, 58, title, "display", 'font-size="46"');
  s += text(40, 94, "Evidence, review, and an explicit human decision before class", "small");

  const top = [
    { x: 30, n: "1", title: "Sources", body: ["authorised material", "licence + provenance"] },
    { x: 320, n: "2", title: "Evidence packet", body: ["captured passages", "task + schema"] },
    { x: 610, n: "3", title: "Sourced draft", body: ["objectives + concepts", "scenes + citations"] },
    { x: 900, n: "4", title: "Check + lint", body: ["exact quotes", "schema + key classes"] },
  ];
  for (const item of top) {
    s += card(t, { x: item.x, y: 150, w: 270, h: 220, title: item.title, body: item.body, fill: t.surface, eyebrow: `STEP ${item.n}` });
    s += stepBadge(t, item.x + 218, 166, item.n);
  }
  s += arrow(300, 260, 312, 260);
  s += arrow(590, 260, 602, 260);
  s += arrow(880, 260, 892, 260);
  s += text(605, 395, "file-based authoring path", "small", 'text-anchor="middle"');

  s += card(t, { x: 70, y: 495, w: 310, h: 225, title: "MySTRA review", body: ["decisions + evidence", "inspect; does not approve"], fill: t.externalSoft, stroke: t.external, eyebrow: "STEP 5" });
  s += stepBadge(t, 302, 511, "5");
  s += card(t, { x: 445, y: 495, w: 310, h: 225, title: "Human approval", body: ["teacher identity + time", "explicit rule 003 decision"], fill: t.successSoft, stroke: t.success, eyebrow: "STEP 6" });
  s += stepBadge(t, 677, 511, "6");
  s += card(t, { x: 820, y: 495, w: 310, h: 225, title: "Class", body: ["validated bundle", "learner sessions"], fill: t.infoSoft, stroke: t.info, eyebrow: "STEP 7" });
  s += stepBadge(t, 1052, 511, "7");

  s += path("M 1035 370 L 1035 448 L 225 448 L 225 487", "line");
  s += arrow(380, 610, 437, 610);
  s += arrow(755, 610, 812, 610);
  s += pill(t, 770, 728, 360, "manual packaging + distribution", t.warningSoft, t.warning, t.warning);

  s += rect(100, 790, 1000, 88, t.warningSoft, t.warning, 16);
  s += text(600, 828, "CURRENT TRANSFER BOUNDARY", "eyebrow", `style="fill:${t.warning}" text-anchor="middle"`);
  s += text(600, 859, "Packet / draft → browser approval → synthesis is not one continuous integrated handoff.", "body", 'text-anchor="middle"');

  s += rect(40, 905, 1120, 315, t.surface, t.border, 18);
  s += text(66, 942, "LEARNER-CONTRIBUTION REVIEW LOOP", "eyebrow");
  s += card(t, { x: 70, y: 970, w: 230, h: 165, title: "Submission", body: ["learner proposes", "state: submitted"], fill: t.accent2Soft, stroke: t.accent2 });
  s += card(t, { x: 340, y: 970, w: 230, h: 165, title: "Dashboard", body: ["review scene + key", "de-identified author"], fill: t.warningSoft, stroke: t.warning });
  s += card(t, { x: 610, y: 970, w: 230, h: 165, title: "Decision", body: ["approve • reject", "request revision"], fill: t.successSoft, stroke: t.success });
  s += card(t, { x: 880, y: 970, w: 230, h: 165, title: "Community", body: ["bundle on approve", "canonical course", "unchanged"], fill: t.infoSoft, stroke: t.info });
  s += arrow(300, 1053, 332, 1053);
  s += arrow(570, 1053, 602, 1053);
  s += arrow(840, 1053, 872, 1053);
  s += path("M 1110 1053 L 1180 1053 L 1180 610 L 1138 610", "line-muted dash");
  s += path("M 975 720 L 1150 720 L 1150 955 L 180 955 L 180 962", "line-muted dash");
  s += text(600, 1183, "Reject or request revision → no publication", "label", `font-size="21" style="fill:${t.warning}" text-anchor="middle"`);
  s += "</svg>\n";
  return s;
}

const diagrams = {
  architecture,
  "learning-loop": learningLoop,
  "self-learner-journey": selfLearnerJourney,
  "teacher-journey": teacherJourney,
};

for (const [name, render] of Object.entries(diagrams)) {
  for (const mode of ["light", "dark"]) {
    writeFileSync(join(here, `${name}-${mode}.svg`), render(theme(mode)), "utf8");
  }
}
