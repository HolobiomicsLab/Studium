// `studium-mcp play`: the one-command start of the browser player (design record 2026-11-25).
import { afterEach, describe, expect, it } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parsePlayArgs, openerFor, startPlay, type PlayRun } from './play.js';
import { cliAnswer } from './index.js';

const fixtures = resolve(import.meta.dirname, '../../../fixtures');
const runs: PlayRun[] = [];
afterEach(async () => { await Promise.all(runs.splice(0).map(run => run.close())); });

describe('parsePlayArgs', () => {
  it('takes an optional folder, --port and --no-open', () => {
    expect(parsePlayArgs([])).toEqual({port:0, open:true});
    expect(parsePlayArgs(['./course', '--port', '8140', '--no-open'])).toEqual({folder:'./course', port:8140, open:false});
    expect(parsePlayArgs(['--port=8141'])).toEqual({port:8141, open:true});
  });
  it('refuses what it cannot read, in one line', () => {
    expect(() => parsePlayArgs(['--port', 'eighty'])).toThrow(/--port/);
    expect(() => parsePlayArgs(['--port', '70000'])).toThrow(/--port/);
    expect(() => parsePlayArgs(['--host', '0.0.0.0'])).toThrow(/unknown option --host/);
    expect(() => parsePlayArgs(['one', 'two'])).toThrow(/one folder/);
  });
});

describe('openerFor', () => {
  it('passes the address as one argument, without a shell', () => {
    const url = 'http://127.0.0.1:8140/play#token=abc';
    expect(openerFor('darwin', url)).toEqual(['open', [url]]);
    expect(openerFor('linux', url)).toEqual(['xdg-open', [url]]);
    expect(openerFor('win32', url)).toEqual(['cmd', ['/c', 'start', '', url]]);
  });
});

describe('startPlay', () => {
  it('offers the lessons shipped with Studium beside an empty lessons folder, apart from the learner\'s, and opens one', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'studium-play-empty-'));
    const run = await startPlay({folder:empty, port:0, open:false}, {
      env:{STUDIUM_EPHEMERAL:'1'}, home:'/nonexistent-home', open:() => {}, print:() => {},
      shippedRoot: resolve(import.meta.dirname, '../shipped-lessons'),
    });
    runs.push(run);
    const origin = run.url.replace(/\/play#.*/, '');
    const token = run.url.split('#token=')[1];
    const call = (name:string, args:Record<string, unknown>) => fetch(`${origin}/play/api/tools/${name}`, {
      method:'POST', headers:{authorization:`Bearer ${token}`, 'content-type':'application/json', origin}, body:JSON.stringify({arguments:args}),
    });
    const reply = await (await call('list_lessons', {language:'fr'})).json() as {content:Array<{text:string}>};
    const listed = JSON.parse(reply.content[0]!.text);
    expect(listed.lessons).toEqual([]);
    const refs = listed.shipped_lessons.map((lesson:{bundle_ref:string}) => lesson.bundle_ref);
    expect(refs).toContain('discover-studium-fr/lesson.json');
    const opened = await call('open_lesson_panel', {bundle_ref:'discover-studium-fr/lesson.json', locale:'fr'});
    expect(opened.status).toBe(200);
    const panel = await opened.json() as {isError?:boolean; structuredContent?:{panel?:{scene?:{id?:string}; session_id?:string}}};
    expect(panel.isError).not.toBe(true);
    expect(panel.structuredContent?.panel?.scene?.id).toBe('s1-intro');
    expect((await call('open_lesson_panel', {bundle_ref:'discover-studium-xx/lesson.json'})).status).toBe(400);
  });

  it('listens on 127.0.0.1 with a fresh token, serves the page, and opens the address it prints', async () => {
    const opened:string[] = [];
    const lines:string[] = [];
    const run = await startPlay({folder:fixtures, port:0, open:true}, {
      env:{STUDIUM_EPHEMERAL:'1'}, home:'/nonexistent-home', open:url => { opened.push(url); }, print:line => { lines.push(line); },
    });
    runs.push(run);
    // Review G, item 5: the address an assistant shows names its key k (served-player.ts); this one keeps #token=.
    expect(run.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/play#token=[0-9a-f]{64}$/);
    expect(run.server.address()).toMatchObject({address:'127.0.0.1'});
    expect(opened).toEqual([run.url]);
    expect(lines.join('\n')).toContain(run.url);
    expect(lines.join('\n')).toContain(fixtures);
    expect(lines.join('\n')).toMatch(/memory only/);
    const page = await fetch(run.url.replace(/#.*/, ''));
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain(run.url.split('#token=')[1]);
    const other = await startPlay({folder:fixtures, port:0, open:false}, {env:{STUDIUM_EPHEMERAL:'1'}, home:'/nonexistent-home', open:() => { throw new Error('not asked'); }, print:() => {}});
    runs.push(other);
    expect(other.url.split('#token=')[1]).not.toBe(run.url.split('#token=')[1]);
  });

  it('says so when the folder does not exist, before listening', async () => {
    await expect(startPlay({folder:'/nonexistent/lessons', port:0, open:false}, {env:{STUDIUM_EPHEMERAL:'1'}, home:'/tmp', open:() => {}, print:() => {}}))
      .rejects.toThrow(/no folder at \/nonexistent\/lessons/);
  });

  it('still prints the address when the browser cannot be opened', async () => {
    const lines:string[] = [];
    const run = await startPlay({folder:fixtures, port:0, open:true}, {env:{STUDIUM_EPHEMERAL:'1'}, home:'/tmp', open:() => { throw new Error('no opener'); }, print:line => { lines.push(line); }});
    runs.push(run);
    expect(lines.join('\n')).toContain(run.url);
    expect(lines.join('\n')).toMatch(/open this address in your browser/i);
  });
});

describe('the help', () => {
  it('names the play command', () => {
    expect(cliAnswer(['--help'])).toContain('npx -y studium-mcp play');
  });
});
