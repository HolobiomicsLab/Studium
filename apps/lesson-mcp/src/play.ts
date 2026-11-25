// `studium-mcp play [folder]`: the browser player in one command (design record
// docs/design-records/specs/2026-11-25-browser-player.md). A fresh token, the lesson API with its player
// on a free port of 127.0.0.1, the address printed and opened in the default browser.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { createLessonHttpServer } from './http.js';
import { createPlayer } from './player.js';
import { hostFromEnvironment, shippedLessonsRoot } from './index.js';

export interface PlayArgs { folder?: string; port: number; open: boolean }
export interface PlayRun { url: string; server: Server; close(): Promise<void> }
export interface PlayDeps {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  open: (url: string) => void;
  print: (line: string) => void;
  /** The folder of the lessons shipped with Studium (index.ts shippedLessonsRoot); absent or null: none. */
  shippedRoot?: string | null;
}

export const PLAY_HELP = `studium-mcp play: play Studium lessons in your web browser (experimental)

Usage
  npx -y studium-mcp play [folder] [--port N] [--no-open]

  folder      a folder of lessons (default: the library, ~/.studium/library)
  --port N    the port on 127.0.0.1 (default: a free one)
  --no-open   print the address without opening the browser

The player listens on this computer only (127.0.0.1) and stops with this terminal (Ctrl+C).
Its address carries a key made for this run: do not share it.
`;

/** The command line after `play`; one line of error for anything it cannot read. */
export function parsePlayArgs(argv: readonly string[]): PlayArgs {
  const args: PlayArgs = { port: 0, open: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--no-open') { args.open = false; continue; }
    if (arg === '--port' || arg.startsWith('--port=')) {
      const value = arg === '--port' ? argv[++i] : arg.slice('--port='.length);
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port takes a number from 0 to 65535');
      args.port = port;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option ${arg}; see studium-mcp play --help`);
    if (args.folder !== undefined) throw new Error('give one folder of lessons at most');
    args.folder = arg;
  }
  return args;
}

/** The platform's opener, the address passed as one argument (no shell). */
export function openerFor(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]];
  // `start` takes its first quoted argument as a window title: the empty one keeps the address an address.
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}

function openInBrowser(url: string): void {
  const [command, args] = openerFor(process.platform, url);
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => { /* the address is printed: the person opens it */ });
  child.unref();
}

/** Start the player and print its address; the caller keeps the process alive. */
export async function startPlay(args: PlayArgs, deps: PlayDeps): Promise<PlayRun> {
  const env = { ...deps.env };
  if (args.folder !== undefined) {
    const folder = resolve(args.folder);
    let isFolder = false;
    try { isFolder = statSync(folder).isDirectory(); } catch { /* reported below */ }
    if (!isFolder) throw new Error(`no folder at ${folder}`);
    env['BUNDLES_ROOT'] = folder;
  }
  const { host, config } = hostFromEnvironment(env, deps.home, { shippedRoot: deps.shippedRoot ?? null });
  const token = randomBytes(32).toString('hex');
  const server = createLessonHttpServer({ host, token, bundlesRoot: config.bundlesRoot, player: createPlayer({ host, token }) });
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(args.port, '127.0.0.1', () => { server.off('error', reject); accept(); });
  });
  const { port } = server.address() as { port: number };
  const url = `http://127.0.0.1:${port}/play#token=${token}`;
  const folders = config.bundlesRoot === config.libraryRoot ? config.bundlesRoot : `${config.bundlesRoot} and ${config.libraryRoot}`;
  deps.print('Studium player (experimental). Keep this window open; Ctrl+C stops the player.');
  deps.print(`Lessons:  ${folders}`);
  deps.print(`Progress: ${config.dataDir ?? 'memory only (STUDIUM_EPHEMERAL): lost when the player stops'}`);
  deps.print(`Address:  ${url}`);
  if (args.open) {
    try { deps.open(url); deps.print('Opening your browser. If it does not open, open this address in your browser.'); }
    catch { deps.print('Could not open a browser: open this address in your browser.'); }
  }
  return {
    url, server,
    close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }),
  };
}

/** The `play` command of the CLI. */
export async function runPlay(argv: readonly string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(PLAY_HELP); return; }
  const run = await startPlay(parsePlayArgs(argv), {
    env: process.env, home: homedir(), open: openInBrowser,
    shippedRoot: shippedLessonsRoot({ scriptPath: process.argv[1], env: process.env }), print: line => process.stdout.write(`${line}\n`),
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void run.close().then(() => process.exit(0)); });
  }
}
