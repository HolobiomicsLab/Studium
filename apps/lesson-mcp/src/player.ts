// The browser player (docs/design-records/specs/2026-11-25-browser-player.md): a page and four tool
// routes under /play, served by the local lesson API on 127.0.0.1. The routes call the panel tools of
// this server through an in-process MCP client, so the page receives the public PanelView the VS Code
// pane and the MCP Apps panels receive, drawn there by the same renderer and bridge.
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SessionHost } from '@studium/lesson-session-host';
import { buildMcpServer } from './server.js';
import { SERVER_VERSION } from './build-info.js';
import { browserHtml } from '../../lesson-panel-ui/dist/resources.js';
import { phrase } from '../../../packages/lesson-panel/src/phrases.js';

/** The only tools the page reaches: no authoring, teacher, export or forget-by-learner tool. */
export const PLAYER_TOOLS = ['list_lessons', 'open_lesson_panel', 'get_panel_view', 'panel_action'] as const;
type PlayerTool = (typeof PLAYER_TOOLS)[number];
/** The page has no assistant: the hand-over to one is neither offered nor taken. */
const NO_ASSISTANT = new Set(['ask']);
const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const CDN = 'https://cdn.jsdelivr.net';

export interface Player {
  /** Whether `path` belongs to the player (`/`, `/play`, `/play/...`). */
  owns(path: string): boolean;
  handle(request: IncomingMessage, response: ServerResponse, path: string): Promise<void>;
}

class PlayerError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** The page's headers: its inline scripts are allowed by their hash, nothing else runs inline. */
export function pageHeaders(html: string): Record<string, string> {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => `'sha256-${createHash('sha256').update(match[1]!).digest('base64')}'`);
  const csp = [
    "default-src 'none'", `script-src ${hashes.join(' ')} ${CDN}`, `style-src 'unsafe-inline' ${CDN}`,
    `font-src ${CDN} data:`, "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  };
}

const digest = (authorization: string) => createHash('sha256').update(authorization).digest('hex');

/** The keys of a player, each bound to one learner. D4 (waiting review 2026-11-25, owner decision 4): the server an
 * assistant runs mints one key per learner the assistant names, and an address carries that learner's key, so that
 * every call made with it plays that learner, whatever the page sends; `studium-mcp play` has one key, for the host's
 * default learner. A received header is looked up by its SHA-256 digest: the comparison never runs over the key. */
export class PlayerKeys {
  private readonly learnerByDigest = new Map<string, string>();
  private readonly keyByLearner = new Map<string, string>();
  constructor(private readonly fresh: () => string = () => randomBytes(32).toString('hex')) {}

  /** A player of one key, bound to `learnerId`. */
  static single(key: string, learnerId: string): PlayerKeys {
    const keys = new PlayerKeys(() => key);
    keys.keyFor(learnerId);
    return keys;
  }

  /** The key of `learnerId`'s addresses: made on first need, the same for the life of the player. */
  keyFor(learnerId: string): string {
    const known = this.keyByLearner.get(learnerId);
    if (known !== undefined) return known;
    const key = this.fresh();
    if (key.length < 32) throw new Error('the player token must contain at least 32 characters');
    this.keyByLearner.set(learnerId, key);
    this.learnerByDigest.set(digest(`Bearer ${key}`), learnerId);
    return key;
  }

  /** The learner whose key an Authorization header carries, or null. */
  learnerOf(authorization: string | undefined): string | null {
    return authorization ? this.learnerByDigest.get(digest(authorization)) ?? null : null;
  }
}

/** The player of one SessionHost. Every call plays the learner of the key it carries, whatever the page sends: with
 * `token`, the host's default learner (`studium-mcp play`); with `keys`, the learner each key was minted for. */
export function createPlayer(options: { host: SessionHost; token?: string; keys?: PlayerKeys; html?: string }): Player {
  if (options.token !== undefined && options.token.length < 32) throw new Error('the player token must contain at least 32 characters');
  const keys = options.keys ?? (options.token !== undefined ? PlayerKeys.single(options.token, options.host.defaultLearnerId) : null);
  if (!keys) throw new Error('a player needs a token or keys');
  const html = options.html ?? browserHtml;
  const headers = pageHeaders(html);
  let client: Promise<Client> | null = null;
  const connect = () => (client ??= (async () => {
    const server = buildMcpServer(options.host);
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const mcp = new Client({ name: 'studium-browser-player', version: SERVER_VERSION });
    await mcp.connect(clientSide);
    return mcp;
  })());

  /** DNS rebinding: the Host must name this loopback server and the port it listens on. */
  function checkLocal(request: IncomingMessage): string {
    const { remoteAddress, localAddress, localPort } = request.socket;
    if (![remoteAddress, localAddress].every(address => address && LOOPBACK.includes(address))) {
      throw new PlayerError(403, 'local_only', 'Only loopback connections are supported');
    }
    const host = request.headers.host ?? '';
    if (![`127.0.0.1:${localPort}`, `localhost:${localPort}`, `[::1]:${localPort}`].includes(host)) {
      throw new PlayerError(403, 'host_rejected', 'This page is served on the loopback address only');
    }
    return host;
  }
  /** Cross-site requests: the page's own origin only, and the token in a header (never a cookie). Returns the learner
   * the token plays. */
  function checkCaller(request: IncomingMessage, host: string): string {
    const site = request.headers['sec-fetch-site'];
    if (request.headers.origin !== `http://${host}` || (site !== undefined && site !== 'same-origin')) {
      throw new PlayerError(403, 'origin_rejected', 'Only the player page of this server may call it');
    }
    const learner = keys!.learnerOf(request.headers.authorization);
    if (learner === null) throw new PlayerError(401, 'unauthorized', 'A valid token is required: open the address the player printed');
    return learner;
  }

  /** A session the page names is read or moved only when it plays the learner of the key; one this server does not
   * hold is left to the tool, which says so. */
  async function checkSession(sessionId: unknown, learner: string): Promise<void> {
    if (typeof sessionId !== 'string') return;
    if (await options.host.sessionPlays(sessionId, learner) === false) {
      throw new PlayerError(403, 'not_your_session', 'This session belongs to another learner');
    }
  }

  /** The sessions whose panel context this player made with the learner of their key. A context remembers its learner,
   * and an action such as « start again » or « review » starts a session for it: one made by get_panel_view or
   * panel_action, which take no learner_id, would hold the server's default learner instead. */
  const viewed = new Set<string>();

  /** The tool the page's call goes to and its arguments: always the learner of the key; get_panel_view is read through
   * open_lesson_panel {session_id}, the same view, so that the context it makes holds that learner. */
  async function callFor(name: PlayerTool, args: Record<string, unknown>, learner: string): Promise<{ tool: string; args: Record<string, unknown> }> {
    const routed = await argumentsFor(name, args, learner);
    return name === 'get_panel_view' ? { tool: 'open_lesson_panel', args: { ...routed, learner_id: learner } } : { tool: name, args: routed };
  }

  async function argumentsFor(name: PlayerTool, args: Record<string, unknown>, learner: string): Promise<Record<string, unknown>> {
    const { learner_id: _ignored, ...rest } = args;
    if (name === 'list_lessons') return { ...rest, learner_id: learner };
    await checkSession(rest.session_id, learner);
    if (name === 'open_lesson_panel') {
      if (rest.bundle_ref !== undefined) {
        const catalog = await options.host.listLessons();
        const listed = [...catalog.lessons, ...catalog.shipped_lessons].map(lesson => lesson.bundle_ref);
        if (typeof rest.bundle_ref !== 'string' || !listed.includes(rest.bundle_ref)) {
          throw new PlayerError(400, 'invalid_bundle', 'Open a lesson the list shows');
        }
      }
      // The page is a native pane, as the VS Code pane is: no client capability can declare it.
      return { ...rest, learner_id: learner, surface: 'pane' };
    }
    if (name === 'get_panel_view') return { ...rest, surface: 'pane' };
    const action = rest.action as { type?: unknown } | undefined;
    if (typeof action?.type === 'string' && NO_ASSISTANT.has(action.type)) {
      throw new PlayerError(400, 'action_unavailable', 'There is no assistant on this page');
    }
    return rest;
  }

  /** The tool's result as an MCP App reads it. A view no longer offers the hand-over to an assistant, and
   * the explanation rung of the help ladder, which is that hand-over, is closed with its reason. */
  function forPage(result: Awaited<ReturnType<Client['callTool']>>) {
    if (result.isError) return { isError: true, content: result.content };
    type Rung = { kind?: string; available?: boolean; why_not?: string };
    type View = { actions?: string[]; locale?: 'fr' | 'en'; help?: { rungs?: Rung[] } };
    const structured = result.structuredContent as { panel?: View } | undefined;
    if (structured?.panel) {
      const view = structured.panel;
      const closed = phrase('player_no_assistant', {}, view.locale === 'en' ? 'en' : 'fr');
      const panel: View = { ...view, actions: (view.actions ?? []).filter(action => !NO_ASSISTANT.has(action)) };
      if (Array.isArray(view.help?.rungs)) {
        panel.help = { ...view.help, rungs: view.help.rungs.map(rung => rung.kind === 'explain' ? { ...rung, available: false, why_not: closed } : rung) };
      }
      return { structuredContent: { ...structured, panel } };
    }
    return { content: result.content };
  }

  return {
    owns: path => path === '/' || path === '/play' || path.startsWith('/play/'),
    async handle(request, response, path) {
      try {
        const host = checkLocal(request);
        if (path === '/' && request.method === 'GET') {
          response.writeHead(302, { location: '/play', 'cache-control': 'no-store' });
          response.end();
          return;
        }
        if (path === '/play' && (request.method === 'GET' || request.method === 'HEAD')) {
          response.writeHead(200, headers);
          response.end(request.method === 'HEAD' ? undefined : html);
          return;
        }
        const name = path.startsWith('/play/api/tools/') ? path.slice('/play/api/tools/'.length) : null;
        if (request.method !== 'POST' || !name) throw new PlayerError(404, 'not_found', 'Unknown player route');
        const learner = checkCaller(request, host);
        if (!(PLAYER_TOOLS as readonly string[]).includes(name)) throw new PlayerError(404, 'not_found', 'This tool is not served to the page');
        const body = await readJson(request);
        const args = typeof body === 'object' && body !== null && typeof (body as { arguments?: unknown }).arguments === 'object'
          ? (body as { arguments: Record<string, unknown> | null }).arguments ?? {} : {};
        const mcp = await connect();
        const call = await callFor(name as PlayerTool, args, learner);
        const session = call.args.session_id;
        if (call.tool === 'panel_action' && typeof session === 'string' && !viewed.has(session)) {
          // An action on a session this player has not shown yet: its context is made first, with the key's learner.
          const shown = await mcp.callTool({ name: 'open_lesson_panel', arguments: { session_id: session, learner_id: learner, surface: 'pane' } });
          if (shown.isError) return sendJson(response, 200, forPage(shown));
          viewed.add(session);
        }
        const result = await mcp.callTool({ name: call.tool, arguments: call.args });
        const shownSession = (result.structuredContent as { panel?: { session_id?: unknown } } | undefined)?.panel?.session_id;
        if (!result.isError && typeof shownSession === 'string') viewed.add(shownSession);
        sendJson(response, 200, forPage(result));
      } catch (error) {
        if (error instanceof PlayerError) return sendJson(response, error.status, { error: error.message, code: error.code });
        return sendJson(response, 500, { error: 'The player failed; read the terminal of the server', code: 'internal_error' });
      }
    },
  };
}

function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    return Promise.reject(new PlayerError(415, 'media_type', 'Use application/json'));
  }
  return new Promise((accept, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) { reject(new PlayerError(413, 'body_too_large', 'Request exceeds 1 MiB')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { accept(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new PlayerError(400, 'invalid_json', 'Body is not valid JSON')); }
    });
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body));
}
