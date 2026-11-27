// lesson-import.ts — route A, lot 1 (plan 2026-11-27-moodle-etagere, task 3): what « Studium: Import a lesson… » says,
// kept apart from VS Code so the drivers test it. extension.ts wires it: the file dialog, the confirmation built from
// the archive's summary, the conflict prompt, the outcome. The archive is checked and installed by
// packages/lesson-session-host/src/lesson-archive.ts (inspectLessonArchive, installLessonArchive).
import { join } from "node:path";
import { LessonArchiveError, type LessonArchiveErrorCode, type LessonArchiveSummary } from "@studium/lesson-panel/lesson-archive";
import { hostPhrase, type HostPhraseKey } from "./host-phrases.js";
import type { Locale } from "./phrases.js";

/** The first characters of the lesson's sha256 shown to the student, as the teacher's instruction prints them. */
const FINGERPRINT_LENGTH = 12;

export interface ImportConfirmation { message: string; detail: string; action: string }
export interface ConflictPrompt { message: string; detail: string; replace: string }

/** The modal confirmation: the lesson's title, its steps, its approval as the file records it, its fingerprint, and
 * the members that will not be copied when there are some. */
export function importConfirmation(summary: LessonArchiveSummary, locale: Locale): ImportConfirmation {
  const lines = [
    summary.sceneCount === 1 ? hostPhrase("import_confirm_steps_one", {}, locale) : hostPhrase("import_confirm_steps", { steps: summary.sceneCount }, locale),
    approvalLine(summary, locale),
    hostPhrase("import_confirm_fingerprint", { fingerprint: summary.lessonSha256.slice(0, FINGERPRINT_LENGTH) }, locale),
  ];
  if (summary.ignoredMembers === 1) lines.push(hostPhrase("import_confirm_ignored_one", {}, locale));
  else if (summary.ignoredMembers > 1) lines.push(hostPhrase("import_confirm_ignored", { count: summary.ignoredMembers }, locale));
  return {
    message: hostPhrase("import_confirm_message", { title: summary.title }, locale),
    detail: lines.join("\n"),
    action: hostPhrase("import_confirm_action", {}, locale),
  };
}

function approvalLine(summary: LessonArchiveSummary, locale: Locale): string {
  const { approval } = summary;
  if (!approval.recorded) return hostPhrase("import_confirm_none", {}, locale);
  if (!approval.matches) return hostPhrase("import_confirm_changed", {}, locale);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(approval.reviewed_at ?? "")?.[0];
  return date
    ? hostPhrase("import_confirm_approved", { reviewer: approval.reviewer ?? "", date }, locale)
    : hostPhrase("import_confirm_approved_undated", { reviewer: approval.reviewer ?? "" }, locale);
}

/** A different lesson.json under the same bundle_id: what replacing does to the lesson there and to the learner's
 * progress. Learner state is keyed by bundle_id (FileStateStore, the host's per-learner scope), not by the lesson's
 * bytes: replacing keeps it, and the new version takes it up. */
export function conflictPrompt(summary: LessonArchiveSummary, locale: Locale): ConflictPrompt {
  return {
    message: hostPhrase("import_conflict_message", { bundle_id: summary.bundleId }, locale),
    detail: hostPhrase("import_conflict_detail", { bundle_id: summary.bundleId, title: summary.title }, locale),
    replace: hostPhrase("import_conflict_replace", {}, locale),
  };
}

export function alreadyPresentMessage(summary: LessonArchiveSummary, locale: Locale): string {
  return hostPhrase("import_already_present", { title: summary.title }, locale);
}

const ERROR_KEYS: Record<LessonArchiveErrorCode, HostPhraseKey> = {
  not_zip: "import_error_not_zip",
  unsupported_zip: "import_error_unsupported_zip",
  unsafe_member: "import_error_unsafe_member",
  duplicate_member: "import_error_duplicate_member",
  too_many_members: "import_error_too_many_members",
  too_large: "import_error_too_large",
  missing_lesson: "import_error_missing_lesson",
  invalid_lesson: "import_error_invalid_lesson",
  bad_bundle_id: "import_error_bad_bundle_id",
};

/** One line that says why the file was not imported and what to do. */
export function importErrorMessage(error: unknown, locale: Locale): string {
  const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
  if (error instanceof LessonArchiveError) {
    return hostPhrase(ERROR_KEYS[error.code], { member: oneLine(error.member ?? "?"), error: oneLine(error.message) }, locale);
  }
  return hostPhrase("import_failed", { error: oneLine(error instanceof Error ? error.message : String(error)) }, locale);
}

export interface ImportDialogOptions {
  title: string;
  openLabel: string;
  canSelectFiles: true;
  canSelectFolders: false;
  canSelectMany: false;
  filters: Record<string, string[]>;
  /** The user's Downloads folder, when it exists. */
  defaultPath?: string;
}

/** The file dialog: one zip file, starting in the Downloads folder when there is one. */
export function importDialogOptions(home: string, exists: (path: string) => boolean, locale: Locale): ImportDialogOptions {
  const downloads = join(home, "Downloads");
  return {
    title: hostPhrase("import_dialog_title", {}, locale),
    openLabel: hostPhrase("import_dialog_open", {}, locale),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { [hostPhrase("import_dialog_filter", {}, locale)]: ["zip"] },
    ...(exists(downloads) ? { defaultPath: downloads } : {}),
  };
}
