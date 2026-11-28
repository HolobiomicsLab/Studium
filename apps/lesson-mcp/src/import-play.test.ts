// A lesson imported by `studium-mcp import` is the one `studium-mcp play` lists: the same library, read the way the page reads it.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImportCommand } from './import.js';
import { startPlay, type PlayRun } from './play.js';

const dirs: string[] = [];
const runs: PlayRun[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map(run => run.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A zip of one stored member, enough for a lesson file.
function zipOf(name: string, data: Buffer): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let crc = 0xffffffff; for (const b of data) crc = table[(crc ^ b) & 0xff]! ^ (crc >>> 8); crc = (crc ^ 0xffffffff) >>> 0;
  const n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + data.length, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}

describe('import, then play', () => {
  it("lists the imported lesson's title through the player's list route", async () => {
    const home = mkdtempSync(join(tmpdir(), 'studium-import-play-')); dirs.push(home);
    const lesson = {
      schema_version: '1.4', bundle_id: 'orbitals-l1', source_plan_id: 'p',
      metadata: { title: 'Les orbitales importées', target: 'L1', duration_minutes: 5, language: 'en', discipline: 'chemistry' },
      concepts: [{ id: 'c1', title: 'Concept', description: 'd', bloom_level_target: 'understand' }],
      scenes: [{ id: 's0', type: 'intro', title: 'I', objective_refs: [], concept_refs: ['c1'], estimated_seconds: 0, adaptation_hooks: [], markdown: 'hi' }],
      rules: [], validated_by: 'teacher', validated_at: '2026-06-10T08:00:00Z',
    };
    const file = join(home, 'orbitals-l1.studium.zip');
    writeFileSync(file, zipOf('lesson.json', Buffer.from(JSON.stringify(lesson))));
    const env = { STUDIUM_HOME: join(home, 'studium'), STUDIUM_EPHEMERAL: '1' };
    const code = await runImportCommand({ file, yes: true, replace: false }, { env, home: '/nonexistent-home', interactive: false, ask: async () => false, print: () => {} });
    expect(code).toBe(0);

    const run = await startPlay({ port: 0, open: false }, { env, home: '/nonexistent-home', open: () => {}, print: () => {} });
    runs.push(run);
    const origin = run.url.replace(/\/play#.*/, '');
    const token = run.url.split('#token=')[1];
    const reply = await fetch(`${origin}/play/api/tools/list_lessons`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin }, body: JSON.stringify({ arguments: { language: 'en' } }),
    });
    expect(reply.status).toBe(200);
    const listed = JSON.parse(((await reply.json()) as { content: Array<{ text: string }> }).content[0]!.text) as { lessons: Array<{ title?: string; bundle_ref: string }> };
    expect(listed.lessons.map(l => l.title)).toContain('Les orbitales importées');
  });
});
