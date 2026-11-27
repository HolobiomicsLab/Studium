// `studium-mcp import <file>`: a lesson file downloaded from a course page, put into the library without VS Code
// (spec 2026-11-27-moodle-etagere-design, F3). It follows the VS Code command (apps/studium-vscode/src/lesson-import.ts):
// the archive is inspected first (nothing written), the person confirms from what it holds, then it is installed; a
// different lesson under the same identifier is replaced only on --replace and a second confirmation. The archive is
// checked and written by packages/lesson-session-host/src/lesson-archive.ts; every string taken from it is cleaned by
// shownText before it is printed.
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  inspectLessonArchive, installLessonArchive, LessonArchiveError, resolvePersistence, shownText,
  type InstallOutcome, type LessonArchiveSummary,
} from '@studium/lesson-session-host';

export interface ImportArgs { file: string; yes: boolean; replace: boolean }
export interface ImportDeps {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  /** Standard input is a terminal: only then can the person be asked. */
  interactive: boolean;
  /** A yes/no question put to the person. */
  ask: (question: string) => Promise<boolean>;
  print: (line: string) => void;
}

export const IMPORT_HELP = `studium-mcp import: put a lesson file from a course page into your Studium library

Usage
  npx -y studium-mcp import <file> [--yes] [--replace]

  file        the lesson file you downloaded (a .studium.zip)
  --yes       do not ask: import after showing what the file holds (needed without a terminal)
  --replace   replace a different lesson that has the same identifier in your library

It first shows the title, the number of steps, the approval the file records (a record, not a
signature) and the folder it will write into, then asks. Nothing is written until you say yes.
Then play it: studium-mcp play
`;

/** The command line after `import`; one line of error for anything it cannot read. */
export function parseImportArgs(argv: readonly string[]): ImportArgs {
  const args: { file?: string; yes: boolean; replace: boolean } = { yes: false, replace: false };
  for (const arg of argv) {
    if (arg === '--yes' || arg === '-y') { args.yes = true; continue; }
    if (arg === '--replace') { args.replace = true; continue; }
    if (arg.startsWith('-')) throw new Error(`unknown option ${arg}; see studium-mcp import --help`);
    if (args.file !== undefined) throw new Error('give one file at most');
    args.file = arg;
  }
  if (args.file === undefined) throw new Error('give the lesson file to import; see studium-mcp import --help');
  return { file: args.file, yes: args.yes, replace: args.replace };
}

/** The first characters of the lesson's sha256 shown, as the teacher's instruction prints them. */
const FINGERPRINT_LENGTH = 12;
const MAX_SHOWN_PATH = 1000;

function approvalLine(summary: LessonArchiveSummary): string {
  const { approval } = summary;
  if (!approval.recorded) return 'No approval is recorded for this lesson.';
  if (!approval.matches) return 'An approval is recorded, but the lesson changed since: this is not the lesson that was validated.';
  const date = /^\d{4}-\d{2}-\d{2}/.exec(approval.reviewed_at ?? '')?.[0];
  const reviewer = shownText(approval.reviewer ?? '');
  return `Approval recorded in the file (a record, not a signature): validated by ${reviewer}${date ? ` on ${date}` : ''}.`;
}

function summaryLines(summary: LessonArchiveSummary, library: string): string[] {
  const lines = [
    `Lesson: ${shownText(summary.title)}`,
    summary.sceneCount === 1 ? '1 step.' : `${summary.sceneCount} steps.`,
    approvalLine(summary),
    `Lesson fingerprint: ${summary.lessonSha256.slice(0, FINGERPRINT_LENGTH)}.`,
  ];
  if (summary.ignoredMembers === 1) lines.push('1 file of the archive is not part of the lesson: it will not be copied.');
  else if (summary.ignoredMembers > 1) lines.push(`${summary.ignoredMembers} files of the archive are not part of the lesson: they will not be copied.`);
  lines.push(`It will be written into: ${shownText(library, MAX_SHOWN_PATH)}`);
  return lines;
}

/** What replacing does, as the VS Code prompt says it; the contributions are promised only when a replace carries them. */
function conflictLines(summary: LessonArchiveSummary, existingSha256: string, carriesCommunity: boolean): string[] {
  const id = shownText(summary.bundleId);
  const title = shownText(summary.title);
  if (existingSha256 === '') {
    return [
      `A folder named ${id} is already in your library and holds no readable lesson.`,
      carriesCommunity
        ? `Replacing deletes what this folder holds, except its community/ folder (the class contributions), and puts "${title}" there.`
        : `Replacing deletes what this folder holds and puts "${title}" there.`,
      'Progress saved under this identifier, if there is any, is kept and the new lesson takes it up.',
    ];
  }
  return [
    `A different lesson with the same identifier (${id}) is already in your library.`,
    `Replacing: the old version's files in the ${id} folder of your library are removed and "${title}" is put there${carriesCommunity ? '; the class contributions in its community/ folder are kept' : ''}.`,
    "Your progress is kept: it is saved under the lesson's identifier, not its content, and the new version takes it up. The steps it shares with the old one stay done; if you had finished the old one, the new one is marked finished.",
  ];
}

const ERROR_LINES: Record<LessonArchiveError['code'], (error: LessonArchiveError) => string> = {
  not_zip: () => 'This is not a readable lesson file; nothing was written. Download the .studium.zip file again from the course page.',
  unsupported_zip: () => 'This archive uses a zip format Studium does not read (zip64, encryption or an unusual compression); nothing was written. Ask your teacher to make the file again with Studium.',
  unsafe_member: e => `This archive contains an unsafe path (${shownText(e.member ?? '?', 300)}); nothing was written. Ask your teacher for a new file.`,
  duplicate_member: e => `This archive contains the same file twice (${shownText(e.member ?? '?', 300)}); nothing was written. Ask your teacher for a new file.`,
  too_many_members: () => 'This archive contains more than 2000 files; nothing was written. Ask your teacher for a lighter file.',
  too_large: () => 'This archive, or one of its files, is over the size allowed (50 MB per file, 200 MB in all); nothing was written. Ask your teacher for a lighter file.',
  missing_lesson: () => 'This archive has no lesson.json, so it is not a Studium lesson file; nothing was written. Check that you downloaded the right file.',
  invalid_lesson: e => `The lesson in this archive is not valid (${shownText(e.message, 300)}); nothing was written. Tell your teacher.`,
  bad_bundle_id: () => "This lesson's identifier (bundle_id) cannot be used as a folder name; nothing was written. Tell your teacher.",
  changed_since_check: () => 'The lesson file changed after it was shown to you; nothing was written. Run the command again.',
  folder_taken: e => `Your library already has a folder "${shownText(e.member ?? '?', 300)}" whose name differs from this lesson's identifier only by case or accents; nothing was written. Rename or move that folder, then import again.`,
  write_failed: e => `The lesson could not be written into your library (${shownText(e.systemCode ?? '?', 40)}); nothing was changed. Check the free space and the permissions of your Studium folder, then import again.`,
  restore_failed: e => `The new lesson could not take the place of the old one, and the old one could not be put back (${shownText(e.systemCode ?? '?', 40)}). The old lesson and its contributions are kept in the folder ${shownText(e.member ?? '?', MAX_SHOWN_PATH)} (subfolders previous and new): put them back into your library.`,
};

/** One line that says why the file was not imported and what to do. */
export function importErrorLine(error: unknown): string {
  if (error instanceof LessonArchiveError) return ERROR_LINES[error.code](error);
  return `Could not import this file: ${shownText(error instanceof Error ? error.message : String(error), 300)}`;
}

const PLAY_HINT = 'To play it: studium-mcp play';

function outcomeLines(outcome: Exclude<InstallOutcome, { status: 'conflict' }>): string[] {
  const title = `"${shownText(outcome.summary.title)}"`;
  const done = {
    installed: `Installed ${title} into your library.`,
    replaced: `Replaced the lesson ${title} in your library; your progress is kept.`,
    already_present: `${title} was already in your library: nothing changed.`,
    refreshed: `${title} was already in your library; its approval record or figures were updated.`,
  }[outcome.status];
  return [done, PLAY_HINT];
}

/** Runs the command; the exit code: 0 done (or already there), 1 nothing was imported. */
export async function runImportCommand(args: ImportArgs, deps: ImportDeps): Promise<number> {
  const { print } = deps;
  const archive = resolve(args.file);
  try {
    if (!existsSync(archive) || !statSync(archive).isFile()) { print(`There is no file at ${shownText(archive, MAX_SHOWN_PATH)}; nothing was written.`); return 1; }
    const library = resolvePersistence(deps.env, deps.home).libraryRoot;
    const summary = await inspectLessonArchive(archive);
    for (const line of summaryLines(summary, library)) print(line);
    // The person decides from what was just shown: the terminal is asked, or --yes stands for the answer.
    if (!args.yes) {
      if (!deps.interactive) { print('Nothing was written: this is not a terminal, so there is no one to ask. Run the command again with --yes to import.'); return 1; }
      if (!await deps.ask('Import this lesson into your library? [y/N] ')) { print('Nothing was written.'); return 1; }
    }
    // The file the person confirmed, byte for byte: a file swapped since is refused (changed_since_check).
    const expectedArchiveSha256 = summary.archiveSha256;
    let outcome = await installLessonArchive(archive, library, { expectedArchiveSha256 });
    // Replace only what the prompt showed: when the library changed meanwhile, the install answers conflict again.
    for (let asked = 0; outcome.status === 'conflict' && asked < 3; asked++) {
      for (const line of conflictLines(outcome.summary, outcome.existingSha256, outcome.carriesCommunity)) print(line);
      if (!args.replace) { print('Nothing was written. To replace it, run the command again with --replace.'); return 1; }
      if (!args.yes) {
        if (!deps.interactive) { print('Nothing was written: this is not a terminal, so there is no one to ask. Run the command again with --replace --yes to replace it.'); return 1; }
        if (!await deps.ask('Replace the lesson in your library? [y/N] ')) { print('Nothing was written.'); return 1; }
      }
      outcome = await installLessonArchive(archive, library, { replace: true, expectedArchiveSha256, expectedExistingSha256: outcome.existingSha256 });
    }
    if (outcome.status === 'conflict') { print('The library changed while this ran; nothing was written. Run the command again.'); return 1; }
    for (const line of outcomeLines(outcome)) print(line);
    return 0;
  } catch (error) {
    print(importErrorLine(error));
    return 1;
  }
}

/** The `import` command of the CLI. A usage error is one line on standard error and exit 2. */
export async function runImport(argv: readonly string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(IMPORT_HELP); return; }
  let args: ImportArgs;
  try { args = parseImportArgs(argv); }
  catch (error) { process.stderr.write(`studium-mcp import: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; return; }
  const interactive = process.stdin.isTTY === true;
  process.exitCode = await runImportCommand(args, {
    env: process.env, home: homedir(), interactive,
    ask: async question => {
      const lines = createInterface({ input: process.stdin, output: process.stdout });
      try { return /^y(es)?$/i.test((await lines.question(question)).trim()); } finally { lines.close(); }
    },
    print: line => process.stdout.write(`${line}\n`),
  });
}
