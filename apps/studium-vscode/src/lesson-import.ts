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
/** The longest title shown; a reviewer is capped at 200 by parseApproval already. */
const MAX_SHOWN_TITLE = 200;

/** A string from the archive or the library as the modals show it (reviews of 2026-11-27, item 4 then item 5): every
 * character of Unicode categories Cc (controls), Cf (invisible formatting, bidi controls, tags), Zl and Zp (line and
 * paragraph separators), plus U+034F and U+180E, is removed; whitespace is collapsed to one space; the result is capped.
 * Line breaks become spaces first, so two words on two lines stay two words. The archive's author never controls a
 * whole line, nor what a reader cannot see. */
const LINE_BREAKS = /[\r\n\p{Zl}\p{Zp}]/gu;
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{34F}\u{180E}]/gu;
export function shownText(text: string, max = MAX_SHOWN_TITLE): string {
  const cleaned = text.replace(LINE_BREAKS, " ").replace(HIDDEN, "").replace(/\s+/gu, " ").trim();
  const chars = [...cleaned];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : cleaned;
}

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
    message: hostPhrase("import_confirm_message", { title: shownText(summary.title) }, locale),
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
    ? hostPhrase("import_confirm_approved", { reviewer: shownText(approval.reviewer ?? ""), date }, locale)
    : hostPhrase("import_confirm_approved_undated", { reviewer: shownText(approval.reviewer ?? "") }, locale);
}

/** A different lesson.json under the same bundle_id (or, when `existingSha256` is "", a folder of that name with no
 * readable lesson.json): what replacing does to it, to its class contributions (community/, carried over) and to the
 * learner's progress. Learner state is keyed by bundle_id (FileStateStore, the host's per-learner scope), not by the
 * lesson's bytes: replacing keeps it, and the new version takes it up. */
export function conflictPrompt(summary: LessonArchiveSummary, locale: Locale, existingSha256: string, carriesCommunity: boolean): ConflictPrompt {
  const params = { bundle_id: shownText(summary.bundleId), title: shownText(summary.title) };
  const noLesson = existingSha256 === "";
  // The contributions are promised only when a replace carries them: a real community/ folder in a real lesson folder.
  const detail = noLesson
    ? (carriesCommunity ? "import_conflict_detail_no_lesson" : "import_conflict_detail_no_lesson_no_community")
    : (carriesCommunity ? "import_conflict_detail" : "import_conflict_detail_no_community");
  return {
    message: hostPhrase(noLesson ? "import_conflict_message_no_lesson" : "import_conflict_message", params, locale),
    detail: hostPhrase(detail, params, locale),
    replace: hostPhrase("import_conflict_replace", {}, locale),
  };
}

export function alreadyPresentMessage(summary: LessonArchiveSummary, locale: Locale): string {
  return hostPhrase("import_already_present", { title: shownText(summary.title) }, locale);
}

/** The same lesson was there; its approval record or figures were written from the archive. */
export function refreshedMessage(summary: LessonArchiveSummary, locale: Locale): string {
  return hostPhrase("import_refreshed", { title: shownText(summary.title) }, locale);
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
  changed_since_check: "import_error_changed_since_check",
  folder_taken: "import_error_folder_taken",
  write_failed: "import_error_write_failed",
  restore_failed: "import_error_restore_failed",
};

/** One line that says why the file was not imported and what to do. */
export function importErrorMessage(error: unknown, locale: Locale): string {
  if (error instanceof LessonArchiveError) {
    // write_failed carries the system code only: its message may hold an absolute path. restore_failed names the folder
    // that holds the old lesson, on purpose.
    return hostPhrase(ERROR_KEYS[error.code], {
      member: shownText(error.member ?? "?", 300), error: shownText(error.message, 300), code: shownText(error.systemCode ?? "?", 40),
      path: error.code === "restore_failed" ? shownText(error.member ?? "?", 1000) : "?",
    }, locale);
  }
  return hostPhrase("import_failed", { error: shownText(error instanceof Error ? error.message : String(error), 300) }, locale);
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
