// `studium-mcp import <file>` (spec 2026-11-27-moodle-etagere-design, F3): a student without VS Code imports a lesson file
// downloaded from a course page. The zips are built here; the library is a temporary STUDIUM_HOME.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMPORT_HELP, parseImportArgs, runImportCommand, type ImportDeps } from './import.js';
import { cliAnswer } from './index.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tempDir(label: string): string { const d = mkdtempSync(join(tmpdir(), 'studium-import-' + label + '-')); dirs.push(d); return d; }

// A zip writer (stored members): enough for a lesson file.
const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(data: Buffer): number { let c = 0xffffffff; for (const b of data) c = TABLE[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(members: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const [name, content] of Object.entries(members)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const n = Buffer.from(name, 'utf8'); const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
function lesson(id = 'chem-l1', title = 'Les orbitales') {
  return Buffer.from(JSON.stringify({
    schema_version: '1.4', bundle_id: id, source_plan_id: 'p',
    metadata: { title, target: 'L1', duration_minutes: 5, language: 'en', discipline: 'chemistry' },
    concepts: [{ id: 'c1', title: 'Concept', description: 'd', bloom_level_target: 'understand' }],
    scenes: ['s0', 's1'].map(sceneId => ({ id: sceneId, type: 'intro', title: sceneId, objective_refs: [], concept_refs: ['c1'], estimated_seconds: 0, adaptation_hooks: [], markdown: 'hi' })),
    rules: [], validated_by: 'teacher', validated_at: '2026-06-10T08:00:00Z',
  }), 'utf8');
}
const approval = (bytes: Buffer, reviewer = 'Élise Dumont') => JSON.stringify({
  schema: 'studium-approval/1', bundle_sha256: createHash('sha256').update(bytes).digest('hex'), reviewer, reviewed_at: '2026-11-27T09:00:00Z',
});

interface Rig { home: string; library: string; lines: string[]; deps: ImportDeps; asked: string[] }
function rig(opts: { interactive?: boolean; answers?: boolean[] } = {}): Rig {
  const home = tempDir('home');
  const lines: string[] = []; const asked: string[] = []; const answers = [...(opts.answers ?? [])];
  return {
    home, library: join(home, 'library'), lines, asked,
    deps: {
      env: { STUDIUM_HOME: home, STUDIUM_EPHEMERAL: '1' }, home: '/nonexistent-home',
      interactive: opts.interactive ?? false,
      ask: async (question: string) => { asked.push(question); return answers.shift() ?? false; },
      print: (line: string) => { lines.push(line); },
    },
  };
}
function archive(members: Record<string, string | Buffer>): string {
  const file = join(tempDir('file'), 'lesson.studium.zip'); writeFileSync(file, zip(members)); return file;
}
function snapshot(dir: string): string {
  if (!existsSync(dir)) return 'absent';
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name) + ':' + createHash('sha256').update(readFileSync(join(d, e.name))).digest('hex')]);
  return walk(dir).sort().join('\n');
}
const out = (r: Rig) => r.lines.join('\n');
const approved = () => { const l = lesson(); return archive({ 'lesson.json': l, 'approval.json': approval(l) }); };
const ask = (file: string, flags: { yes?: boolean; replace?: boolean } = {}) => ({ file, yes: flags.yes ?? false, replace: flags.replace ?? false });

describe('parseImportArgs', () => {
  it('takes one file, --yes and --replace', () => {
    expect(parseImportArgs(['a.zip'])).toEqual({ file: 'a.zip', yes: false, replace: false });
    expect(parseImportArgs(['--yes', 'a.zip', '--replace'])).toEqual({ file: 'a.zip', yes: true, replace: true });
  });
  it('refuses what it cannot read, in one line', () => {
    expect(() => parseImportArgs([])).toThrow(/give the lesson file/);
    expect(() => parseImportArgs(['a.zip', 'b.zip'])).toThrow(/one file/);
    expect(() => parseImportArgs(['a.zip', '--force'])).toThrow(/unknown option --force/);
  });
});

describe('help', () => {
  it('describes the command and is listed by studium-mcp --help', () => {
    expect(IMPORT_HELP).toMatch(/studium-mcp import/);
    expect(IMPORT_HELP).toMatch(/--yes/);
    expect(IMPORT_HELP).toMatch(/--replace/);
    expect(cliAnswer(['--help'])).toMatch(/studium-mcp import <file>/);
  });
});

describe('runImportCommand', () => {
  it('shows the summary, then without a terminal and without --yes writes nothing and says so', async () => {
    const r = rig(); const file = approved();
    const code = await runImportCommand(ask(file), r.deps);
    expect(code).toBe(1);
    const text = out(r);
    expect(text).toContain('Les orbitales');
    expect(text).toMatch(/2 steps/);
    expect(text).toMatch(/a record, not a signature/);
    expect(text).toContain('Élise Dumont');
    expect(text).toMatch(/Lesson fingerprint: [0-9a-f]{12}\b/);
    expect(text).toContain(r.library);
    expect(text).toMatch(/Nothing was written.*--yes/s);
    expect(existsSync(r.library)).toBe(false);
    expect(r.asked).toEqual([]);
  });
  it('--yes installs without asking, then says how to play', async () => {
    const r = rig(); const file = approved();
    expect(await runImportCommand(ask(file, { yes: true }), r.deps)).toBe(0);
    expect(existsSync(join(r.library, 'chem-l1', 'lesson.json'))).toBe(true);
    expect(existsSync(join(r.library, 'chem-l1', 'approval.json'))).toBe(true);
    expect(r.asked).toEqual([]);
    expect(out(r)).toMatch(/Installed .Les orbitales./);
    expect(out(r)).toMatch(/studium-mcp play/);
  });
  it('on a terminal asks, and a no writes nothing', async () => {
    const r = rig({ interactive: true, answers: [false] }); const file = approved();
    expect(await runImportCommand(ask(file), r.deps)).toBe(1);
    expect(r.asked.length).toBe(1);
    expect(existsSync(r.library)).toBe(false);
    expect(out(r)).toMatch(/Nothing was written/);
  });
  it('on a terminal, a yes installs', async () => {
    const r = rig({ interactive: true, answers: [true] }); const file = approved();
    expect(await runImportCommand(ask(file), r.deps)).toBe(0);
    expect(existsSync(join(r.library, 'chem-l1', 'lesson.json'))).toBe(true);
  });
  it('says when no approval is recorded, and when the lesson changed since its approval', async () => {
    const none = rig(); await runImportCommand(ask(archive({ 'lesson.json': lesson() })), none.deps);
    expect(out(none)).toMatch(/No approval is recorded/);
    const stale = rig(); await runImportCommand(ask(archive({ 'lesson.json': lesson(), 'approval.json': approval(lesson('chem-l1', 'Other')) })), stale.deps);
    expect(out(stale)).toMatch(/changed since/);
    expect(out(stale)).not.toMatch(/validated by/);
  });
  it('counts the members it ignores, only when there are some', async () => {
    const plain = rig(); await runImportCommand(ask(approved()), plain.deps);
    expect(out(plain)).not.toMatch(/not part of the lesson/);
    const extra = rig();
    await runImportCommand(ask(archive({ 'lesson.json': lesson(), 'notes.txt': 'x', 'run.sh': 'y' })), extra.deps);
    expect(out(extra)).toMatch(/2 files of the archive are not part of the lesson/);
  });
  it('cleans what the archive wrote before printing it', async () => {
    const r = rig();
    await runImportCommand(ask(archive({ 'lesson.json': lesson('chem-l1', 'Safe\x1b[2J\u{202E}title\nSecond line') })), r.deps);
    expect(out(r).includes('\x1b') || out(r).includes('\u{202E}')).toBe(false);
    expect(out(r)).toContain('Safe[2Jtitle Second line');
  });
  it('reports the same lesson again as already present', async () => {
    const r = rig(); const file = approved();
    await runImportCommand(ask(file, { yes: true }), r.deps);
    r.lines.length = 0;
    expect(await runImportCommand(ask(file, { yes: true }), r.deps)).toBe(0);
    expect(out(r)).toMatch(/already in your library/);
    expect(out(r)).toMatch(/studium-mcp play/);
  });
  it('reports a refreshed approval record in one line', async () => {
    const r = rig(); const l = lesson();
    await runImportCommand(ask(archive({ 'lesson.json': l }), { yes: true }), r.deps);
    r.lines.length = 0;
    expect(await runImportCommand(ask(archive({ 'lesson.json': l, 'approval.json': approval(l) }), { yes: true }), r.deps)).toBe(0);
    expect(out(r)).toMatch(/approval record or figures were updated/);
    expect(readFileSync(join(r.library, 'chem-l1', 'approval.json'), 'utf8')).toContain('Élise Dumont');
  });
  it('on a conflict says what replacing does and writes nothing without --replace', async () => {
    const r = rig();
    await runImportCommand(ask(archive({ 'lesson.json': lesson() }), { yes: true }), r.deps);
    mkdirSync(join(r.library, 'chem-l1', 'community')); writeFileSync(join(r.library, 'chem-l1', 'community', 'note.json'), '{}');
    const before = snapshot(r.library); r.lines.length = 0;
    const code = await runImportCommand(ask(archive({ 'lesson.json': lesson('chem-l1', 'Les orbitales, v2') }), { yes: true }), r.deps);
    expect(code).toBe(1);
    expect(out(r)).toMatch(/different lesson with the same identifier \(chem-l1\)/);
    expect(out(r)).toMatch(/files .* are removed/);
    expect(out(r)).toMatch(/progress is kept/i);
    expect(out(r)).toMatch(/class contributions .* are kept/);
    expect(out(r)).toMatch(/Nothing was written.*--replace/s);
    expect(snapshot(r.library)).toBe(before);
  });
  it('with --replace and --yes replaces, keeping community/', async () => {
    const r = rig();
    await runImportCommand(ask(archive({ 'lesson.json': lesson() }), { yes: true }), r.deps);
    mkdirSync(join(r.library, 'chem-l1', 'community')); writeFileSync(join(r.library, 'chem-l1', 'community', 'note.json'), '{}');
    r.lines.length = 0;
    expect(await runImportCommand(ask(archive({ 'lesson.json': lesson('chem-l1', 'Les orbitales, v2') }), { yes: true, replace: true }), r.deps)).toBe(0);
    expect(readFileSync(join(r.library, 'chem-l1', 'lesson.json'), 'utf8')).toContain('Les orbitales, v2');
    expect(existsSync(join(r.library, 'chem-l1', 'community', 'note.json'))).toBe(true);
    expect(out(r)).toMatch(/Replaced/);
  });
  it('with --replace on a terminal asks again, and a no leaves the old lesson', async () => {
    const r = rig({ interactive: true, answers: [true, false] });
    await runImportCommand(ask(archive({ 'lesson.json': lesson() })), r.deps);
    const before = snapshot(r.library);
    expect(await runImportCommand(ask(archive({ 'lesson.json': lesson('chem-l1', 'v2') }), { replace: true }), r.deps)).toBe(1);
    expect(r.asked.length).toBe(2);
    expect(snapshot(r.library)).toBe(before);
  });
  it('with --replace but no terminal and no --yes still writes nothing', async () => {
    const r = rig();
    await runImportCommand(ask(archive({ 'lesson.json': lesson() }), { yes: true }), r.deps);
    const before = snapshot(r.library);
    expect(await runImportCommand(ask(archive({ 'lesson.json': lesson('chem-l1', 'v2') }), { replace: true }), r.deps)).toBe(1);
    expect(snapshot(r.library)).toBe(before);
  });
  it('maps a refusal of the archive to one line that says what to do, exit 1, nothing written', async () => {
    const r = rig(); const file = join(tempDir('file'), 'x.zip'); writeFileSync(file, 'not a zip at all');
    expect(await runImportCommand(ask(file, { yes: true }), r.deps)).toBe(1);
    expect(r.lines.length).toBe(1);
    expect(r.lines[0]).toMatch(/not a readable lesson file.*Download/);
    expect(existsSync(r.library)).toBe(false);
  });
  it('says so, in one line, for a file that is not there', async () => {
    const r = rig();
    expect(await runImportCommand(ask(join(r.home, 'missing.zip'), { yes: true }), r.deps)).toBe(1);
    expect(r.lines.length).toBe(1);
    expect(r.lines[0]).toMatch(/no file at/);
  });
});
