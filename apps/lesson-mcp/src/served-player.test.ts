// D4 (waiting review 2026-11-25, owner decision 4): the browser player of the stdio server, started on first need,
// once per process, on the server's own SessionHost; 127.0.0.1 only, a free port, a fresh key per learner. If it
// cannot start, no address is given and one line says why on stderr. The stdio end-to-end case is
// served-player.e2e.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { SessionHost } from '@studium/lesson-session-host';
import { browserPlayerWanted, servedPlayer, type ServedPlayer } from './served-player.js';

const root = resolve(import.meta.dirname, '../../../fixtures');
const players: ServedPlayer[] = [];
afterEach(async () => { await Promise.all(players.splice(0).map(player => player.close())); });
function served(options: {listen?: Parameters<typeof servedPlayer>[0]['listen']} = {}) {
  const host = new SessionHost({bundlesRoot:root, live:false, dataDir:null});
  const lines: string[] = [];
  const player = servedPlayer({host:() => host, log:line => { lines.push(line); }, ...(options.listen ? {listen:options.listen} : {})});
  players.push(player);
  return {host, player, lines};
}

describe('servedPlayer', () => {
  it('listens nowhere until the first address is asked for, then on 127.0.0.1 with a key per learner', async () => {
    const {player, lines} = served();
    expect(player.port()).toBeNull();
    expect(lines).toEqual([]);
    const ana = await player.linkFor('ana', 'atomistique-l1/lesson.json');
    expect(ana).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/play#token=[0-9a-f]{64}&from=assistant&lesson=atomistique-l1%2Flesson\.json$/);
    const port = player.port();
    expect(port).toBe(Number(new URL(ana!).port));
    // Once per process: the same port, the same key for the same learner, another key for another learner.
    const again = await player.linkFor('ana', 'other/lesson.json');
    expect(new URL(again!).port).toBe(String(port));
    expect(again!.match(/token=([0-9a-f]+)/)![1]).toBe(ana!.match(/token=([0-9a-f]+)/)![1]);
    const bob = await player.linkFor('bob', 'atomistique-l1/lesson.json');
    expect(bob!.match(/token=([0-9a-f]+)/)![1]).not.toBe(ana!.match(/token=([0-9a-f]+)/)![1]);
    // One line on stderr, with the origin and never a key.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`http://127.0.0.1:${port}`);
    expect(lines[0]).not.toMatch(/token|[0-9a-f]{64}/);
    const page = await fetch(`http://127.0.0.1:${port}/play`);
    expect(page.status).toBe(200);
    const tool = await fetch(`http://127.0.0.1:${port}/play/api/tools/list_lessons`, {
      method:'POST', headers:{'content-type':'application/json', origin:`http://127.0.0.1:${port}`}, body:'{"arguments":{}}',
    });
    expect(tool.status).toBe(401);
    // Nothing but the player: the lesson API of 'studium-mcp api' is not served here.
    expect((await fetch(`http://127.0.0.1:${port}/v1/operations`)).status).toBe(404);
  });

  it('gives no address, says why in one line, and does not try again, when it cannot listen', async () => {
    let tries = 0;
    const {player, lines} = served({listen: async () => { tries++; throw Object.assign(new Error('listen EPERM: operation not permitted 127.0.0.1'), {code:'EPERM'}); }});
    expect(await player.linkFor('ana', 'atomistique-l1/lesson.json')).toBeNull();
    expect(await player.linkFor('bob', 'atomistique-l1/lesson.json')).toBeNull();
    expect(tries).toBe(1);
    expect(player.port()).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/browser player/);
    expect(lines[0]).toMatch(/EPERM/);
  });

  it('stops listening when closed', async () => {
    const {player} = served();
    const link = await player.linkFor('ana');
    const port = new URL(link!).port;
    expect(link).not.toContain('lesson=');
    await player.close();
    await expect(fetch(`http://127.0.0.1:${port}/play`)).rejects.toThrow();
  });
});

describe('browserPlayerWanted', () => {
  it('is wanted unless the VS Code extension serves Studium or STUDIUM_BROWSER_PLAYER turns it off', () => {
    expect(browserPlayerWanted({})).toBe(true);
    expect(browserPlayerWanted({STUDIUM_BROWSER_PLAYER:'on'})).toBe(true);
    expect(browserPlayerWanted({STUDIUM_OPEN_LINK:'vscode://holobiomicslab.studium-vscode/open?bundle='})).toBe(false);
    for (const off of ['off', 'OFF', ' off ', '0', 'false', 'none', 'no']) expect(browserPlayerWanted({STUDIUM_BROWSER_PLAYER:off}), off).toBe(false);
  });
});
