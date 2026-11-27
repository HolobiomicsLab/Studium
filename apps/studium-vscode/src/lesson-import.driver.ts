// lesson-import.driver.ts — route A, lot 1 (plan 2026-11-27-moodle-etagere, task 3): what « Studium: Import a lesson… »
// says, without VS Code. The confirmation built from the archive's summary (approved, unapproved, changed since its
// approval, ignored members) in both languages; the conflict prompt, which says what replacing does to the lesson
// and to the learner's progress; one line for each refusal; where the file dialog starts.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/lesson-import.driver.ts
import { join } from "node:path";
import { LessonArchiveError, type LessonArchiveErrorCode, type LessonArchiveSummary } from "@studium/lesson-panel/lesson-archive";
import { alreadyPresentMessage, conflictPrompt, importConfirmation, importDialogOptions, importErrorMessage } from "./lesson-import.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const base: LessonArchiveSummary = {
  bundleId: "chem-l1", title: "Les orbitales", language: "fr", sceneCount: 12,
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
  expect(en.detail.includes("Validated by Élise Dumont on 2026-11-27"), "it says who validated it and when (got " + en.detail + ")");
  expect(/not a signature/.test(en.detail), "it says the approval record is not a signature (N4)");
  expect(en.detail.includes("0123456789ab") && !en.detail.includes("0123456789abc"), "it shows the first 12 hex of the fingerprint");
  expect(!/ignored|not copied/i.test(en.detail), "no ignored-members line when there are none");
  expect(en.action === "Import", "the English button is « Import » (got " + en.action + ")");
  const fr = importConfirmation(base, "fr");
  expect(nbsp(fr.message).includes("« Les orbitales »") && nbsp(fr.detail).includes("12 étapes"), "the French confirmation names the lesson and its steps (got " + fr.message + " / " + fr.detail + ")");
  expect(nbsp(fr.detail).includes("Validée par Élise Dumont le 2026-11-27") && /pas une signature/.test(fr.detail), "it says who validated it, and that it is not a signature");
  expect(nbsp(fr.detail).includes("Empreinte de la leçon : 0123456789ab"), "the French fingerprint line");
  expect(fr.action === "Importer", "the French button is « Importer »");
  expect(importConfirmation({ ...base, sceneCount: 1 }, "en").detail.includes("1 step.") && !importConfirmation({ ...base, sceneCount: 1 }, "en").detail.includes("1 steps"), "one step reads « 1 step »");
}
{
  const en = importConfirmation(unapproved, "en").detail;
  expect(en.includes("No approval is recorded for this lesson") && !/Validated by/.test(en), "an unapproved lesson says no approval is recorded (got " + en + ")");
  const fr = nbsp(importConfirmation(unapproved, "fr").detail);
  expect(fr.includes("Aucune approbation n'est enregistrée pour cette leçon"), "and in French (got " + fr + ")");
}
{
  const en = importConfirmation(changed, "en").detail;
  expect(/changed since/.test(en) && !/Validated by/.test(en), "a lesson changed since its approval says so, and never that it is validated (got " + en + ")");
  const fr = importConfirmation(changed, "fr").detail;
  expect(/a changé depuis/.test(fr) && !/Validée par/.test(fr), "and in French (got " + fr + ")");
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
  const en = conflictPrompt({ ...base, title: "Les orbitales, version 2" }, "en");
  expect(en.message.includes("chem-l1") && /different lesson/.test(en.message), "the conflict names the identifier and says the lesson there is a different one (got " + en.message + ")");
  expect(/deletes/.test(en.detail) && en.detail.includes("Les orbitales, version 2"), "it says replacing deletes the lesson there and puts the new one in its place (got " + en.detail + ")");
  expect(/progress/.test(en.detail) && /kept/.test(en.detail) && /identifier/.test(en.detail), "it says the progress is kept, as it is saved under the identifier");
  expect(/finished/.test(en.detail) && /steps/.test(en.detail), "it says what carries over: shared steps, a finished lesson");
  expect(en.replace === "Replace", "the English button is « Replace »");
  const fr = conflictPrompt(base, "fr");
  expect(fr.message.includes("chem-l1") && /progression/.test(fr.detail) && /gardée/.test(fr.detail) && fr.replace === "Remplacer", "and in French (got " + fr.message + " / " + fr.detail + ")");
}

// Each refusal maps to one line that says nothing was written and what to do.
{
  const codes: LessonArchiveErrorCode[] = ["not_zip", "unsupported_zip", "unsafe_member", "duplicate_member", "too_many_members",
    "too_large", "missing_lesson", "invalid_lesson", "bad_bundle_id"];
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
