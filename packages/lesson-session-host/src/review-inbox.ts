// packages/lesson-session-host/src/review-inbox.ts
//
// INT-STUDIUM-058 § 2.9, the review inbox: one item per scene of a lesson, sorted by what a mistake
// there would cost (blocks, grading, wording, media), each marked new / changed / unchanged against
// the last review receipt written next to the lesson (`<course>/reviews/<date>-<short sha>.json`).
// review_lesson (apps/lesson-mcp) returns it; the teacher dashboard can reuse the same logic.
//
// Owner's decision (option a): a key-holding item carries NO sha256 in what a tool returns. The
// fingerprint binds the whole scene, keys included, so a learner who can read it could hash each
// candidate answer and compare: the hash would be an answer oracle. The receipt on disk keeps every
// item's fingerprint; only the response withholds it.
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { sceneRenderAssets, type Scene } from "@studium/lesson-bundle-schema";
import { REDACTED_SCENE_FIELDS, publicScene } from "./public-scene.js";

export const REVIEW_RECEIPT_SCHEMA = "studium/review-receipt/v1";
export const CONSEQUENCES = ["blocks", "grading", "wording", "media"] as const;
export type Consequence = (typeof CONSEQUENCES)[number];
export type WhatChanged = "new" | "changed" | "unchanged";

export interface ReviewItem {
  /** Scene id (`#<index>` when the scene has none). */
  id: string;
  /** Absent when holds_key: see the header (option a). */
  sha256?: string;
  consequence: Consequence;
  what_changed: WhatChanged;
  holds_key: boolean;
  checks: Array<{ check: "schema" | "todo" | "lint"; passed: boolean }>;
  /** What the teacher is asked to judge: the scene's public face, derived on each read (never stored in
   * the receipt, never part of the fingerprint) and never a key. */
  preview: ScenePreview;
}

export interface ScenePreview {
  title: string;
  /** The scene type. */
  kind: string;
  /** The first learner-facing text of the scene (whitespace collapsed, at most PREVIEW_TEXT_MAX
   * characters), "" when it has none. */
  text: string;
  /** The choice texts in authored order, without any correct flag, when the scene has choices. */
  choices?: string[];
}

export interface ReviewReceipt {
  schema: typeof REVIEW_RECEIPT_SCHEMA;
  reviewer: string; decided_at: string; bundle_ref: string; bundle_sha256: string;
  decision: "approved" | "returned";
  items: Array<{ id: string; sha256: string; consequence: Consequence; opened: boolean; verdict?: "ok" | "to_fix" }>;
  opened: number; not_opened: number; note?: string;
}

/** The last receipt as the inbox shows it: who decided what, never the items' fingerprints. */
export type ReceiptSummary = Pick<ReviewReceipt, "reviewer" | "decided_at" | "decision" | "bundle_sha256" | "opened" | "not_opened">;

export interface ReviewInbox {
  items: ReviewItem[];
  last_receipt: ReceiptSummary | null;
  counts: { consequence: Record<Consequence, number>; what_changed: Record<WhatChanged, number> };
  /** Files in reviews/ with a receipt's name that could not be read as a v1 receipt. */
  unreadable_receipts?: number;
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Code-point order, as Python's sort_keys (JS's default sort compares UTF-16 units). */
function byCodePoint(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/**
 * The canonical JSON the fingerprints are computed over, to be reproduced by the Python side
 * (task 6.2, `json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))`, encoded
 * UTF-8, no trailing newline): compact, object keys sorted recursively by code point, arrays in
 * order, non-ASCII left as is. Numbers follow ECMAScript's Number-to-String: an integral float is
 * written `1` (Python writes `1.0`) and exponents differ (`1e-7` vs `1e-07`), so the Python side must
 * normalise those to match.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort(byCodePoint);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** sha256 hex of the scene's canonical JSON: the whole raw scene, answer keys included. */
export function sceneFingerprint(rawScene: unknown): string {
  return createHash("sha256").update(canonicalJson(rawScene), "utf8").digest("hex");
}

const nonEmpty = (v: unknown): boolean =>
  typeof v === "string" ? v.trim() !== ""
    : Array.isArray(v) ? v.length > 0
      : isRecord(v) ? Object.keys(v).length > 0
        : v !== undefined && v !== null;

/** True when the scene carries an answer key or a reveal: a non-empty REDACTED_SCENE_FIELDS field, or a
 * quiz choice marked correct (the fields publicScene withholds from a learner). */
export function sceneHoldsKey(rawScene: unknown): boolean {
  if (!isRecord(rawScene)) return false;
  if (REDACTED_SCENE_FIELDS.some((field) => nonEmpty(rawScene[field]))) return true;
  const choices = rawScene["choices"];
  return Array.isArray(choices) && choices.some((c) => isRecord(c) && c["correct"] === true);
}

function hasRenderAssets(rawScene: Json): boolean {
  try { return sceneRenderAssets(rawScene as unknown as Scene).length > 0; }
  catch { return false; } // a malformed asset field: the schema check reports it
}

/** Learner-facing text fields, in the order a preview reads them (the same list review_lesson's plan
 * excerpt uses). None is an answer key: the text is read from publicScene's projection, and only from
 * these fields, so a key or reveal field (REDACTED_SCENE_FIELDS, `reveal`, `answer_key`, `expected`...)
 * can never be picked. */
export const PREVIEW_TEXT_FIELDS = ["question", "prompt", "task", "topic", "scenario", "pre_question", "flawed_content", "source_content", "markdown"] as const;
export const PREVIEW_TEXT_MAX = 280;

/** publicScene's projection, or, for a raw scene it cannot read (the inbox takes unvalidated scenes),
 * the same redaction done by hand: the key fields dropped, the choices without their flag. */
function publicFace(record: Json): Json {
  try { return publicScene(record as unknown as Scene) as Json; }
  catch {
    const out: Json = {};
    for (const [key, value] of Object.entries(record)) {
      if (!(REDACTED_SCENE_FIELDS as readonly string[]).includes(key)) out[key] = value;
    }
    return out;
  }
}

/** The scene's public face as the inbox shows it (see ReviewItem.preview). */
export function scenePreview(rawScene: unknown, fallbackTitle: string): ScenePreview {
  const record = isRecord(rawScene) ? rawScene : {};
  const view = publicFace(record);
  let text = "";
  for (const field of PREVIEW_TEXT_FIELDS) {
    const value = view[field];
    if (typeof value === "string" && value.trim() !== "") { text = value.replace(/\s+/g, " ").trim(); break; }
  }
  const chars = Array.from(text);
  if (chars.length > PREVIEW_TEXT_MAX) text = `${chars.slice(0, PREVIEW_TEXT_MAX - 1).join("")}…`;
  const preview: ScenePreview = {
    title: typeof record["title"] === "string" && record["title"].trim() !== "" ? record["title"] : fallbackTitle,
    kind: typeof record["type"] === "string" ? record["type"] : "unknown",
    text,
  };
  // Only the text of each choice is read: never `correct`, `feedback` or any other field of it.
  if (Array.isArray(view["choices"])) {
    preview.choices = view["choices"].map((c) => (typeof c === "string" ? c : isRecord(c) && typeof c["text"] === "string" ? c["text"] : ""));
  }
  return preview;
}

export interface BuildReviewInboxInput {
  /** The lesson's `scenes` as parsed, unvalidated; anything but an array gives no items. */
  rawScenes: unknown;
  /** Sanitised linter findings, or null when the linter did not run (the lint check is then left out). */
  lintFindings: ReadonlyArray<{ level: string; code?: string; message: string }> | null;
  /** Unfilled TODO placeholders per scene id (`#<index>` for a scene without an id). */
  todoPerScene: ReadonlyMap<string, number>;
  schemaValid: boolean;
  /** Schema problems by dotted path; one under `scenes.<index>` fails that scene's schema check. */
  schemaErrors?: ReadonlyArray<{ path: string }>;
  lastReceipt: ReviewReceipt | null;
  unreadableReceipts?: number;
}

const sceneIndexOf = (path: string): number | null => {
  const m = /^scenes\.(\d+)(?:[.:\s]|$)/.exec(path);
  return m ? Number(m[1]) : null;
};

/** Build the inbox. A lint ERROR targets a scene when its message starts with `<scene id>:` or with
 * the path `scenes.<index>`; the message itself is never copied into the inbox. */
export function buildReviewInbox(input: BuildReviewInboxInput): ReviewInbox {
  const scenes = Array.isArray(input.rawScenes) ? input.rawScenes : [];
  const previous = new Map<string, string>();
  for (const item of input.lastReceipt?.items ?? []) previous.set(item.id, item.sha256);
  const lintErrors = (input.lintFindings ?? []).filter((f) => f.level === "ERROR").map((f) => f.message);
  const schemaFailed = new Set<number>();
  if (!input.schemaValid) {
    for (const error of input.schemaErrors ?? []) {
      const index = sceneIndexOf(error.path);
      if (index !== null) schemaFailed.add(index);
    }
  }

  const items = scenes.map((scene, index): ReviewItem => {
    const record = isRecord(scene) ? scene : {};
    const id = typeof record["id"] === "string" ? record["id"] : `#${index}`;
    const holdsKey = sceneHoldsKey(scene);
    const sha = sceneFingerprint(scene);
    const schemaOk = !schemaFailed.has(index);
    const todoOk = (input.todoPerScene.get(id) ?? 0) === 0;
    const lintOk = !lintErrors.some((m) => m.startsWith(`${id}:`) || sceneIndexOf(m) === index);
    const checks: ReviewItem["checks"] = [{ check: "schema", passed: schemaOk }, { check: "todo", passed: todoOk }];
    if (input.lintFindings !== null) checks.push({ check: "lint", passed: lintOk });
    const consequence: Consequence = !(schemaOk && todoOk && lintOk) ? "blocks"
      : holdsKey ? "grading" : hasRenderAssets(record) ? "media" : "wording";
    const before = previous.get(id);
    const item: ReviewItem = {
      id, consequence, what_changed: before === undefined ? "new" : before === sha ? "unchanged" : "changed", holds_key: holdsKey, checks,
      preview: scenePreview(scene, id),
    };
    if (!holdsKey) item.sha256 = sha;
    return item;
  });
  // Array.prototype.sort is stable, so scene order holds inside a consequence.
  items.sort((a, b) => CONSEQUENCES.indexOf(a.consequence) - CONSEQUENCES.indexOf(b.consequence));

  const counts: ReviewInbox["counts"] = {
    consequence: { blocks: 0, grading: 0, wording: 0, media: 0 },
    what_changed: { new: 0, changed: 0, unchanged: 0 },
  };
  for (const item of items) { counts.consequence[item.consequence] += 1; counts.what_changed[item.what_changed] += 1; }
  const r = input.lastReceipt;
  const inbox: ReviewInbox = {
    items,
    last_receipt: r ? {
      reviewer: r.reviewer, decided_at: r.decided_at, decision: r.decision, bundle_sha256: r.bundle_sha256,
      opened: r.opened, not_opened: r.not_opened,
    } : null,
    counts,
  };
  if (input.unreadableReceipts) inbox.unreadable_receipts = input.unreadableReceipts;
  return inbox;
}

// --- reading the receipts ----------------------------------------------------------------------

const RECEIPT_NAME = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{4,}\.json$/;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const isSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** A v1 receipt, its strings bounded (anyone with write access to the course can edit it), or null. */
function parseReceipt(value: unknown): ReviewReceipt | null {
  if (!isRecord(value) || value["schema"] !== REVIEW_RECEIPT_SCHEMA) return null;
  const { reviewer, decided_at: decidedAt, bundle_ref: ref, bundle_sha256: bundleSha, decision, items, opened, not_opened: notOpened } = value;
  if (typeof reviewer !== "string" || typeof decidedAt !== "string" || Number.isNaN(Date.parse(decidedAt))) return null;
  if (decision !== "approved" && decision !== "returned") return null;
  if (!isSha(bundleSha) || !Array.isArray(items)) return null;
  if (!Number.isInteger(opened) || !Number.isInteger(notOpened)) return null;
  const kept: ReviewReceipt["items"] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item["id"] !== "string" || !isSha(item["sha256"])) continue;
    const consequence = CONSEQUENCES.includes(item["consequence"] as Consequence) ? item["consequence"] as Consequence : "wording";
    const entry: ReviewReceipt["items"][number] = { id: item["id"], sha256: item["sha256"], consequence, opened: item["opened"] === true };
    if (item["verdict"] === "ok" || item["verdict"] === "to_fix") entry.verdict = item["verdict"];
    kept.push(entry);
  }
  const receipt: ReviewReceipt = {
    schema: REVIEW_RECEIPT_SCHEMA, reviewer: reviewer.slice(0, 200), decided_at: decidedAt.slice(0, 64),
    bundle_ref: typeof ref === "string" ? ref.slice(0, 512) : "", bundle_sha256: bundleSha, decision, items: kept,
    opened: opened as number, not_opened: notOpened as number,
  };
  if (typeof value["note"] === "string") receipt.note = value["note"].slice(0, 2000);
  return receipt;
}

const within = (base: string, path: string): boolean => {
  const rel = relative(base, path);
  return rel !== "" && !(rel.startsWith("..") || isAbsolute(rel));
};

/**
 * The latest review receipt in `<courseDir>/reviews/`: files named `<YYYY-MM-DD>-<hex>.json` only,
 * the greatest `decided_at` wins and a tie goes to the later file name. A file with such a name that
 * is not a readable v1 receipt is skipped and counted; a path that resolves outside the course folder
 * is skipped. Never throws on the folder's content.
 */
export async function readLastReceipt(courseDir: string | null): Promise<{ receipt: ReviewReceipt | null; unreadable: number }> {
  const none = { receipt: null, unreadable: 0 };
  if (courseDir === null) return none;
  let course: string, reviews: string, names: string[];
  try {
    course = await realpath(courseDir);
    reviews = await realpath(join(course, "reviews"));
    if (!within(course, reviews)) return none;
    names = (await readdir(reviews)).filter((n) => RECEIPT_NAME.test(n)).sort();
  } catch { return none; }

  let best: { receipt: ReviewReceipt; at: number } | null = null;
  let unreadable = 0;
  for (const name of names) {
    let receipt: ReviewReceipt | null = null;
    try {
      const file = await realpath(join(reviews, name));
      if (!within(reviews, file)) continue;
      const info = await stat(file);
      if (info.isFile() && info.size <= MAX_RECEIPT_BYTES) receipt = parseReceipt(JSON.parse(await readFile(file, "utf8")));
    } catch { receipt = null; }
    if (receipt === null) { unreadable += 1; continue; }
    const at = Date.parse(receipt.decided_at);
    if (best === null || at >= best.at) best = { receipt, at }; // names are sorted: a tie goes to the later one
  }
  return { receipt: best?.receipt ?? null, unreadable };
}
