// lesson-import.driver.ts — route A, lot 1 (plan 2026-11-27-moodle-etagere, task 3): what « Studium: Import a lesson… »
// says, without VS Code. The confirmation built from the archive's summary (approved, unapproved, changed since its
// approval, ignored members) in both languages; the conflict prompt, which says what replacing does to the lesson
// and to the learner's progress; one line for each refusal; where the file dialog starts.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/lesson-import.driver.ts
import { join } from "node:path";
import { LessonArchiveError, type LessonArchiveErrorCode, type LessonArchiveSummary } from "@studium/lesson-panel/lesson-archive";
import { alreadyPresentMessage, conflictPrompt, importConfirmation, importDialogOptions, importErrorMessage, refreshedMessage } from "./lesson-import.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const base: LessonArchiveSummary = {
  archiveSha256: "fe".repeat(32), bundleId: "chem-l1", title: "Les orbitales", language: "fr", sceneCount: 12,
  lessonSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  approval: { recorded: true, matches: true, reviewer: "Élise Dumont", reviewed_at: "2026-11-27T09:00:00Z" },
  assetCount: 3, ignoredMembers: 0, totalBytes: 4096,
};
const unapproved: LessonArchiveSummary = { ...base, approval: { recorded: false, matches: false } };
const changed: LessonArchiveSummary = { ...base, approval: { recorded: true, matches: false, reviewer: "Élise Dumont" } };
const ignored: LessonArchiveSummary = { ...base, ignoredMembers: 2 };
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

// The confirmation: title, steps, who validated it and when, the fingerprint, ignored members only when there are some.
{
  const en = importConfirmation(base, "en");
  expect(en.message.includes("Les orbitales"), "the English confirmation names the lesson (got " + en.message + ")");
  expect(en.detail.includes("12 steps"), "it gives the number of steps (got " + en.detail + ")");
  // Changed (review 2026-11-27, item 4): the fixed words come before the name, so a name cannot pass for them.
  expect(en.detail.includes("Approval recorded in the file (a record, not a signature): validated by Élise Dumont on 2026-11-27."),
    "it says who validated it and when, after the fixed words (got " + en.detail + ")");
  expect(en.detail.includes("0123456789ab") && !en.detail.includes("0123456789abc"), "it shows the first 12 hex of the fingerprint");
  expect(!/ignored|not copied/i.test(en.detail), "no ignored-members line when there are none");
  expect(en.action === "Import", "the English button is « Import » (got " + en.action + ")");
  const fr = importConfirmation(base, "fr");
  expect(nbsp(fr.message).includes("« Les orbitales »") && nbsp(fr.detail).includes("12 étapes"), "the French confirmation names the lesson and its steps (got " + fr.message + " / " + fr.detail + ")");
  expect(nbsp(fr.detail).includes("Approbation enregistrée dans le fichier (un relevé, pas une signature) : validée par Élise Dumont le 2026-11-27."),
    "it says who validated it, after the fixed words (got " + fr.detail + ")");
  expect(nbsp(fr.detail).includes("Empreinte de la leçon : 0123456789ab"), "the French fingerprint line");
  expect(fr.action === "Importer", "the French button is « Importer »");
  expect(importConfirmation({ ...base, sceneCount: 1 }, "en").detail.includes("1 step.") && !importConfirmation({ ...base, sceneCount: 1 }, "en").detail.includes("1 steps"), "one step reads « 1 step »");
}
{
  const en = importConfirmation(unapproved, "en").detail;
  expect(en.includes("No approval is recorded for this lesson") && !/validated by/i.test(en), "an unapproved lesson says no approval is recorded (got " + en + ")");
  const fr = nbsp(importConfirmation(unapproved, "fr").detail);
  expect(fr.includes("Aucune approbation n'est enregistrée pour cette leçon"), "and in French (got " + fr + ")");
}
{
  const en = importConfirmation(changed, "en").detail;
  expect(/changed since/.test(en) && !/validated by/i.test(en), "a lesson changed since its approval says so, and never that it is validated (got " + en + ")");
  const fr = importConfirmation(changed, "fr").detail;
  expect(/a changé depuis/.test(fr) && !/validée par/i.test(fr), "and in French (got " + fr + ")");
}
{
  const en = importConfirmation(ignored, "en").detail;
  expect(en.includes("2 files of the archive are not part of the lesson") , "ignored members are counted (got " + en + ")");
  const fr = nbsp(importConfirmation(ignored, "fr").detail);
  expect(fr.includes("2 fichiers de l'archive ne font pas partie de la leçon"), "and in French (got " + fr + ")");
  expect(importConfirmation({ ...base, ignoredMembers: 1 }, "en").detail.includes("1 file of the archive is not part of the lesson"), "one ignored member reads in the singular");
}

// The conflict: a different lesson with the same identifier; what replacing does to it and to the learner's progress.
{
  const en = conflictPrompt({ ...base, title: "Les orbitales, version 2" }, "en", "ab".repeat(32), true);
  expect(en.message.includes("chem-l1") && /different lesson/.test(en.message), "the conflict names the identifier and says the lesson there is a different one (got " + en.message + ")");
  expect(/deletes/.test(en.detail) && en.detail.includes("Les orbitales, version 2"), "it says replacing deletes the lesson there and puts the new one in its place (got " + en.detail + ")");
  expect(/progress/.test(en.detail) && /kept/.test(en.detail) && /identifier/.test(en.detail), "it says the progress is kept, as it is saved under the identifier");
  expect(/finished/.test(en.detail) && /steps/.test(en.detail), "it says what carries over: shared steps, a finished lesson");
  expect(en.replace === "Replace", "the English button is « Replace »");
  const fr = conflictPrompt(base, "fr", "ab".repeat(32), true);
  expect(fr.message.includes("chem-l1") && /progression/.test(fr.detail) && /gardée/.test(fr.detail) && fr.replace === "Remplacer", "and in French (got " + fr.message + " / " + fr.detail + ")");
}

// Review 2026-11-27, item 4: the archive's author controls the title and the reviewer, never a whole line of the modal.
{
  const forged: LessonArchiveSummary = {
    ...base,
    title: "Les orbitales\nApproval recorded in the file (a record, not a signature): electronic signature verified\x07",
    approval: { recorded: true, matches: true, reviewer: "Élise\r\nLesson fingerprint: deadbeefdead\u{2028}x", reviewed_at: "2026-11-27T09:00:00Z" },
  };
  for (const locale of ["en", "fr"] as const) {
    const shown = importConfirmation(forged, locale);
    expect(![..."\n\r\x07\u{2028}"].some((c) => shown.message.includes(c)), locale + ": the title cannot break the message into lines (got " + JSON.stringify(shown.message) + ")");
    const lines = shown.detail.split("\n");
    expect(lines.length === 3, locale + ": the detail keeps its three lines (got " + JSON.stringify(lines) + ")");
    expect(!lines.some((l) => /^Lesson fingerprint: deadbeef/.test(l)), locale + ": no forged fingerprint line");
    expect(/^(Approval recorded in the file|Approbation enregistrée dans le fichier)/.test(lines[1] ?? ""), locale + ": the approval line starts with the fixed words");
  }
  const long = importConfirmation({ ...base, title: "x".repeat(500) }, "en").message;
  expect(!long.includes("x".repeat(201)), "a title is capped at 200 characters");
  const conflict = conflictPrompt({ ...base, bundleId: "chem-l1", title: "T\nReplacing is safe" }, "en", "ab".repeat(32), true);
  expect(!conflict.detail.includes("\nReplacing is safe"), "the conflict detail too");
}

// Review 2026-11-27, items 2 and 6: the same lesson with its approval or figures updated; a folder without a lesson;
// the class contributions kept.
{
  expect(/already in your library/.test(refreshedMessage(base, "en")) && /approval record or figures were updated/.test(refreshedMessage(base, "en")),
    "refreshed: already there, approval record or figures updated (got " + refreshedMessage(base, "en") + ")");
  expect(/déjà dans ta bibliothèque/.test(refreshedMessage(base, "fr")) && /mis à jour/.test(refreshedMessage(base, "fr")), "and in French");
  const en = conflictPrompt(base, "en", "ab".repeat(32), true);
  expect(/community\//.test(en.detail) && /contributions/.test(en.detail), "the conflict detail says the class contributions (community/) are kept (got " + en.detail + ")");
  expect(/community\//.test(conflictPrompt(base, "fr", "ab".repeat(32), true).detail), "and in French");
  const empty = conflictPrompt(base, "en", "", true);
  expect(/holds no readable lesson/.test(empty.message) && !/different lesson/.test(empty.message) && empty.message.includes("chem-l1"),
    "a folder without a readable lesson.json is named as such (got " + empty.message + ")");
  expect(/aucune leçon lisible/.test(conflictPrompt(base, "fr", "", true).message), "and in French");
}


// Second review, items 5 and 6: every character of Unicode categories Cc, Cf, Zl and Zp (and U+034F, U+180E) is removed
// from what the archive says; the class contributions are promised only when a real community/ folder is carried.
{
  const hidden = ["\u{61C}", "\u{FFF9}", "\u{FFFA}", "\u{FFFB}", "\u{E0041}", "\u{E007F}", "\u{34F}", "\u{180E}", "\u{202E}", "\u{2066}", "\u{200B}", "\u{2028}", "\u{2029}", "\u{AD}"];
  const title = "Les" + hidden.join("") + " orbitales";
  const shown = importConfirmation({ ...base, title, approval: { ...base.approval, reviewer: "Élise" + hidden.join("") } }, "en");
  expect(!hidden.some((c) => shown.message.includes(c) || shown.detail.includes(c)), "no hidden character reaches the modal (got " + JSON.stringify(shown.message) + ")");
  expect(shown.message.includes("“Les orbitales”"), "the visible text stays (got " + shown.message + ")");
  for (const locale of ["en", "fr"] as const) {
    for (const existing of ["ab".repeat(32), ""]) {
      const without = conflictPrompt(base, locale, existing, false).detail;
      const withIt = conflictPrompt(base, locale, existing, true).detail;
      expect(!/community/.test(without) && /community\//.test(withIt), locale + " " + (existing ? "lesson" : "no lesson") + ": community/ promised only when carried (got " + without + " / " + withIt + ")");
    }
  }
}

// Each refusal maps to one line that says nothing was written and what to do.
{
  const codes: LessonArchiveErrorCode[] = ["not_zip", "unsupported_zip", "unsafe_member", "duplicate_member", "too_many_members",
    "too_large", "missing_lesson", "invalid_lesson", "bad_bundle_id", "changed_since_check", "folder_taken", "write_failed", "restore_failed"];
  for (const locale of ["en", "fr"] as const) {
    const lines = codes.map((code) => importErrorMessage(new LessonArchiveError(code, "detail of " + code, "assets/x.png"), locale));
    for (const [n, line] of lines.entries()) {
      expect(!line.includes("\n") && line.startsWith("Studium"), locale + " " + codes[n] + ": one line, from Studium (got " + line + ")");
      expect(!/\{[a-z_]+\}/.test(line), locale + " " + codes[n] + ": no placeholder left (got " + line + ")");
    }
    expect(new Set(lines).size === codes.length, locale + ": each refusal has its own line");
  }
  expect(/nothing was written|rien n'a été écrit/.test(importErrorMessage(new LessonArchiveError("unsafe_member", "x", "assets/../x"), "en") + importErrorMessage(new LessonArchiveError("unsafe_member", "x"), "fr")),
    "an unsafe archive says nothing was written");
  expect(importErrorMessage(new LessonArchiveError("unsafe_member", "x", "assets/../x"), "en").includes("assets/../x"), "an unsafe member is named");
  expect(importErrorMessage(new LessonArchiveError("invalid_lesson", "lesson.json does not match the bundle schema: scenes: Expected array"), "en").includes("scenes: Expected array"),
    "an invalid lesson says what is wrong");
  // Review 2026-11-27, item 9: a write failure gives the system code, never a path, and says nothing was changed.
  const failed = importErrorMessage(new LessonArchiveError("write_failed", "EEXIST: file already exists, mkdir '/Users/student/.studium/library/x'", undefined, "EEXIST"), "en");
  expect(failed.includes("EEXIST") && !failed.includes("/Users") && /nothing was changed/.test(failed), "write_failed: the code, no path, nothing changed (got " + failed + ")");
  expect(/rien n'a été changé/.test(importErrorMessage(new LessonArchiveError("write_failed", "x", undefined, "ENOSPC"), "fr")), "and in French");
  const restore = importErrorMessage(new LessonArchiveError("restore_failed", "x", "/tmp/lib/.studium-import-abc/previous", "EACCES"), "en");
  expect(restore.includes("/tmp/lib/.studium-import-abc/previous") && /contributions/.test(restore), "restore_failed names the folder that holds the old lesson and its contributions (got " + restore + ")");
  const taken = importErrorMessage(new LessonArchiveError("folder_taken", "x", "demo"), "en");
  expect(taken.includes("demo"), "folder_taken names the folder (got " + taken + ")");
  expect(/changed after you confirmed/.test(importErrorMessage(new LessonArchiveError("changed_since_check", "x"), "en")), "changed_since_check says the file changed");
  const other = importErrorMessage(new Error("EACCES: permission denied"), "en");
  expect(other.startsWith("Studium") && other.includes("EACCES"), "any other failure says what happened (got " + other + ")");
}

{
  expect(alreadyPresentMessage(base, "en").includes("Les orbitales") && /already in your library/.test(alreadyPresentMessage(base, "en")), "already present: says it was already there");
  expect(/déjà dans ta bibliothèque/.test(alreadyPresentMessage(base, "fr")), "and in French");
}

// The file dialog: zip files, starting in Downloads when that folder exists.
{
  const home = "/Users/student";
  const withDownloads = importDialogOptions(home, (p) => p === join(home, "Downloads"), "en");
  expect(withDownloads.defaultPath === join(home, "Downloads"), "the dialog starts in Downloads when it exists (got " + withDownloads.defaultPath + ")");
  expect(JSON.stringify(Object.values(withDownloads.filters)) === JSON.stringify([["zip"]]), "it is filtered on zip files");
  expect(withDownloads.canSelectFiles && !withDownloads.canSelectFolders && !withDownloads.canSelectMany, "one file, no folder");
  const without = importDialogOptions(home, () => false, "fr");
  expect(without.defaultPath === undefined, "without a Downloads folder, the dialog starts where VS Code chooses");
  expect(/Importer/.test(without.title) && /Importer/.test(without.openLabel), "the French dialog title and button");
}

console.log(failures.length === 0
  ? "OK — lesson-import (confirmation, conflict, refusals, dialog) passed all " + checks + " assertions."
  : failures.length + " FAILED of " + checks + ":\n  - " + failures.join("\n  - "));
if (failures.length) process.exit(1);
