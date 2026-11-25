// `studium-mcp play`: the one-command start of the browser player (design record 2026-11-25).
import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
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
  it('listens on 127.0.0.1 with a fresh token, serves the page, and opens the address it prints', async () => {
    const opened:string[] = [];
    const lines:string[] = [];
    const run = await startPlay({folder:fixtures, port:0, open:true}, {
      env:{STUDIUM_EPHEMERAL:'1'}, home:'/nonexistent-home', open:url => { opened.push(url); }, print:line => { lines.push(line); },
    });
    runs.push(run);
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
