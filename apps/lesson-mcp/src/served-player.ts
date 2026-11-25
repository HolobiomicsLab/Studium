// apps/lesson-mcp/src/served-player.ts
//
// D4 (waiting review 2026-11-25, owner decision 4; hub intent INT-STUDIUM-064): when no VS Code extension serves Studium
// (Vibe, OpenCode, Copilot configured by hand), the stdio server an assistant started offers its own browser player.
// It starts it on first need — the first lesson it offers, never at startup — once per process, in the same process
// and on the same SessionHost, so that a step answered in the browser is the progress the chat sees, and the reverse.
// Same protections as `studium-mcp play` (player.ts): 127.0.0.1 only, a free port, the Host checked against DNS
// rebinding, the page's own origin only, a key in a header. One key per learner (PlayerKeys): an address plays the
// learner the assistant named in the call that minted it, never another. Studium never opens the browser itself: the
// assistant shows the address. The player lives as long as the process: neither it nor a tab left open keeps the
// process alive, so it ends with the assistant's session. If it cannot listen (a sandbox, a refused port), no address
// is given, the chat goes on as before, and one line on stderr says why.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SessionHost } from '@studium/lesson-session-host';
import { createPlayer, PlayerKeys } from './player.js';

/** The values of STUDIUM_BROWSER_PLAYER that turn the player off (classrooms, IT policies). */
const OFF = ['off', 'none', '0', 'false', 'no'];

/** Whether this stdio server offers its browser player: not when the VS Code extension serves Studium
 * (STUDIUM_OPEN_LINK: its pane is offered), not when STUDIUM_BROWSER_PLAYER is off. */
export function browserPlayerWanted(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env['STUDIUM_OPEN_LINK']?.trim()) return false;
  return !OFF.includes((env['STUDIUM_BROWSER_PLAYER'] ?? '').trim().toLowerCase());
}

export interface ServedPlayer {
  /** The address that plays `bundleRef` (else lists the lessons) in the browser as `learnerId`. The first call starts
   * the player; null when it cannot start. */
  linkFor(learnerId: string, bundleRef?: string): Promise<string | null>;
  /** The port the player listens on, or null: not started yet, could not start, or closed. */
  port(): number | null;
  close(): Promise<void>;
}

export interface ServedPlayerOptions {
  /** The SessionHost of the stdio server, read when the player starts. */
  host: () => SessionHost;
  /** One line for stderr (never stdout: it carries the MCP stream). */
  log: (line: string) => void;
  /** How the server listens; tests make it fail. Default: a free port of 127.0.0.1. */
  listen?: (server: Server) => Promise<void>;
}

function listenOnLoopback(server: Server): Promise<void> {
  return new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); accept(); });
  });
}

/** The browser player of a stdio server, started on first need. */
export function servedPlayer(options: ServedPlayerOptions): ServedPlayer {
  type Running = { server: Server; origin: string; port: number };
  const keys = new PlayerKeys();
  let running: Running | null = null;
  let started: Promise<Running | null> | null = null;
  const start = () => (started ??= (async () => {
    const player = createPlayer({ host: options.host(), keys });
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (player.owns(path)) return void player.handle(request, response, path);
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(JSON.stringify({ error: 'Unknown player route', code: 'not_found' }));
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    // A tab left open holds a connection: it must not keep the process alive once the assistant has gone.
    server.on('connection', (socket) => socket.unref());
    try {
      await (options.listen ?? listenOnLoopback)(server);
    } catch (error) {
      options.log(`studium: the browser player could not start (${(error as Error).message}); lessons are offered in the chat only\n`);
      return null;
    }
    server.unref();
    const { port } = server.address() as AddressInfo;
    running = { server, origin: `http://127.0.0.1:${port}`, port };
    options.log(`studium: browser player on ${running.origin}/play, until this server stops\n`);
    return running;
  })());

  return {
    async linkFor(learnerId, bundleRef) {
      const served = await start();
      if (!served) return null;
      const lesson = bundleRef === undefined ? '' : `&lesson=${encodeURIComponent(bundleRef)}`;
      return `${served.origin}/play#token=${keys.keyFor(learnerId)}&from=assistant${lesson}`;
    },
    port: () => running?.port ?? null,
    async close() {
      const served = running;
      running = null;
      if (!served) return;
      await new Promise<void>((done) => { served.server.closeAllConnections(); served.server.close(() => done()); });
    },
  };
}
