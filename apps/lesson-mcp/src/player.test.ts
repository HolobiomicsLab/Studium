// The browser player (docs/design-records/specs/2026-11-25-browser-player.md): its page, its four
// tool routes and their checks, over a real socket, as a browser on this machine would call them.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import { SessionHost } from '@studium/lesson-session-host';
import { createLessonHttpServer } from './http.js';
import { createPlayer, PlayerKeys, PLAYER_TOOLS } from './player.js';

const root = resolve(import.meta.dirname, '../../../fixtures');
const token = 'synthetic-player-token-with-more-than-32-characters';
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()); })));
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive:true, force:true});
});

type Raw = {status:number; headers:Record<string,string|string[]|undefined>; text:string; json:any};
async function setup(options:{player?:boolean; bundlesRoot?:string} = {}) {
  const bundlesRoot = options.bundlesRoot ?? root;
  const host = new SessionHost({bundlesRoot, live:false, dataDir:null});
  const server = createLessonHttpServer({host, token, bundlesRoot, ...(options.player === false ? {} : {player:createPlayer({host, token})})});
  servers.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as {port:number}).port;
  const origin = `http://127.0.0.1:${port}`;
  // node:http keeps Host and Origin as written (fetch would replace them).
  const raw = (method:string, path:string, headers:Record<string,string>, body?:string) => new Promise<Raw>((accept, reject) => {
    const request = httpRequest({host:'127.0.0.1', port, method, path, headers:{host:`127.0.0.1:${port}`, ...headers}}, response => {
      const chunks:Buffer[] = [];
      response.on('data', (chunk:Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json:unknown = undefined;
        try { json = JSON.parse(text); } catch { /* the page */ }
        accept({status:response.statusCode ?? 0, headers:response.headers, text, json});
      });
    });
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
  const browser = {authorization:`Bearer ${token}`, 'content-type':'application/json', origin, 'sec-fetch-site':'same-origin'};
  const tool = (name:string, args:Record<string,unknown>, headers:Record<string,string> = {}) =>
    raw('POST', `/play/api/tools/${name}`, {...browser, ...headers}, JSON.stringify({arguments:args}));
  const view = async (name:string, args:Record<string,unknown>) => {
    const reply = await tool(name, args);
    expect(reply.status, reply.text).toBe(200);
    expect(reply.json.isError, reply.text).toBeFalsy();
    return reply.json.structuredContent.panel;
  };
  return {host, port, origin, raw, tool, view, browser};
}
const corsHeaders = (headers:Raw['headers']) => Object.keys(headers).filter(name => name.startsWith('access-control-'));

describe('browser player: the page', () => {
  it('is served without a token, with a CSP that allows only its own inline script and no CORS', async () => {
    const {raw} = await setup();
    const page = await raw('GET', '/play', {});
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    const csp = String(page.headers['content-security-policy']);
    for (const directive of ["default-src 'none'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'"]) expect(csp).toContain(directive);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    const inline = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]!);
    expect(inline.length).toBeGreaterThan(0);
    for (const script of inline) expect(csp).toContain(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(corsHeaders(page.headers)).toEqual([]);
    expect(page.text).not.toContain(token);
    expect((await raw('GET', '/', {})).headers.location).toBe('/play');
  });

  it('refuses a rebinding host name and a host on another port', async () => {
    const {raw, port} = await setup();
    expect((await raw('GET', '/play', {host:'evil.example'})).status).toBe(403);
    expect((await raw('GET', '/play', {host:`evil.example:${port}`})).status).toBe(403);
    expect((await raw('GET', '/play', {host:`127.0.0.1:${port === 1 ? 2 : 1}`})).status).toBe(403);
    expect((await raw('GET', '/play', {host:`localhost:${port}`})).status).toBe(200);
  });

  it('is absent when the API runs without the player', async () => {
    const {raw} = await setup({player:false});
    expect((await raw('GET', '/play', {})).status).toBe(401);
    expect((await raw('GET', '/play', {authorization:`Bearer ${token}`})).status).toBe(404);
  });
});

describe('browser player: the tool routes', () => {
  it('need the token, a same-origin Origin and a JSON body, and never answer with CORS headers', async () => {
    const {tool, raw, browser, port} = await setup();
    const refused = [
      await tool('list_lessons', {}, {authorization:''}),
      await tool('list_lessons', {}, {authorization:`Bearer ${token.slice(1)}x`}),
      await tool('list_lessons', {}, {origin:'https://evil.example'}),
      await tool('list_lessons', {}, {origin:`http://localhost:${port}`}),
      await tool('list_lessons', {}, {'sec-fetch-site':'cross-site'}),
      await tool('list_lessons', {}, {host:'evil.example', origin:'http://evil.example'}),
    ];
    expect(refused.map(reply => reply.status)).toEqual([401, 401, 403, 403, 403, 403]);
    const {origin: _origin, ...noOrigin} = browser;
    expect((await raw('POST', '/play/api/tools/list_lessons', noOrigin, '{"arguments":{}}')).status).toBe(403);
    expect((await tool('list_lessons', {}, {'content-type':'text/plain'})).status).toBe(415);
    const preflight = await raw('OPTIONS', '/play/api/tools/list_lessons', {origin:'https://evil.example', 'access-control-request-method':'POST'});
    expect(preflight.status).toBeGreaterThanOrEqual(400);
    for (const reply of [...refused, preflight, await tool('list_lessons', {})]) expect(corsHeaders(reply.headers)).toEqual([]);
  });

  it('leave the /v1 API refusing every browser origin', async () => {
    const {raw, origin} = await setup();
    const reply = await raw('GET', '/health', {authorization:`Bearer ${token}`, origin});
    expect(reply.status).toBe(403);
    expect(reply.json.code).toBe('origin_rejected');
  });

  it('serve exactly four tools', async () => {
    const {tool} = await setup();
    expect([...PLAYER_TOOLS].sort()).toEqual(['get_panel_view', 'list_lessons', 'open_lesson_panel', 'panel_action']);
    for (const name of ['create_lesson', 'forget_session', 'class_report', 'export_concept_map', 'get_scene_artifacts']) {
      expect((await tool(name, {})).status).toBe(404);
    }
  });

  it('list the lessons of the folder for the server\'s learner, and open only a listed one', async () => {
    const {tool} = await setup();
    const listing = await tool('list_lessons', {learner_id:'someone-else', language:'fr'});
    expect(listing.status).toBe(200);
    const lessons = JSON.parse(listing.json.content[0].text).lessons;
    expect(lessons.some((lesson:{bundle_ref:string}) => lesson.bundle_ref === 'atomistique-l1/lesson.json')).toBe(true);
    for (const bundle_ref of ['../package.json', '/etc/hosts', 'atomistique-l1/../../package.json']) {
      const opened = await tool('open_lesson_panel', {bundle_ref});
      expect(opened.status).toBe(400);
      expect(opened.json.code).toBe('invalid_bundle');
    }
  });
});

// Review of decision 4, finding 2 (probe p1): get_panel_view is read through open_lesson_panel, which takes a bundle_ref,
// and the page's bundle_ref went with it: a lesson on disk that list_lessons does not show opened there.
describe('browser player: a lesson the list does not show', () => {
  it('is opened by no route, get_panel_view included', async () => {
    const bundlesRoot = mkdtempSync(join(tmpdir(), 'player-unlisted-'));
    dirs.push(bundlesRoot);
    for (const folder of ['listed', 'community/c1']) {
      mkdirSync(join(bundlesRoot, folder), {recursive:true});
      copyFileSync(join(root, 'atomistique-l1/lesson.json'), join(bundlesRoot, folder, 'lesson.json'));
    }
    const {tool, view} = await setup({bundlesRoot});
    const listed = JSON.parse((await tool('list_lessons', {language:'fr'})).json.content[0].text).lessons.map((lesson:{bundle_ref:string}) => lesson.bundle_ref);
    expect(listed).toEqual(['listed/lesson.json']);
    const unlisted = 'community/c1/lesson.json';
    const shown = await view('open_lesson_panel', {bundle_ref:'listed/lesson.json', locale:'fr'});
    for (const [name, args] of [
      ['open_lesson_panel', {bundle_ref:unlisted}],
      ['get_panel_view', {bundle_ref:unlisted}],
      ['get_panel_view', {session_id:shown.session_id, bundle_ref:unlisted}],
    ] as const) {
      const refused = await tool(name, args);
      expect(refused.status, `${name} ${JSON.stringify(args)}: ${refused.text.slice(0, 200)}`).toBe(400);
      expect(refused.json.code).toBe('invalid_bundle');
    }
    // The session on screen still reads as itself.
    expect((await view('get_panel_view', {session_id:shown.session_id})).bundle_ref).toBe('listed/lesson.json');
  });
});

// Review of decision 4, nit: a body over 1 MiB cut the connection before any answer; the page then saw a network error,
// which it reads as a server that is gone. The 413 now reaches the client.
describe('browser player: a body too large', () => {
  it('is answered 413, not with a closed connection', async () => {
    const {raw, browser} = await setup();
    const reply = await raw('POST', '/play/api/tools/list_lessons', browser, JSON.stringify({arguments:{pad:'x'.repeat(1_100_000)}}));
    expect(reply.status).toBe(413);
    expect(reply.json.code).toBe('body_too_large');
  });
});

describe('browser player: a lesson played through the routes', () => {
  it('shows no answer key before the answer, grades on the server and offers no assistant', async () => {
    const {view, tool, host} = await setup();
    let panel = await view('open_lesson_panel', {bundle_ref:'atomistique-l1/lesson.json', learner_id:'someone-else', locale:'fr'});
    expect(panel.learner_id).toBe(host.defaultLearnerId);
    expect(panel.surface.kind).toBe('pane');
    expect(panel.voices).toBeDefined();
    expect(panel.actions).not.toContain('ask');
    expect(Object.keys(panel.strings).length).toBeGreaterThan(0); // the pane draws its labels from them
    const session_id = panel.session_id;
    while (panel.scene.type !== 'quiz') {
      panel = await view('panel_action', {session_id, action:{type:'respond', input:{kind:'ack'}, expected_scene_id:panel.scene.id}});
    }
    expect(panel.scene.id).toBe('s1-quiz-fer');
    // The key stays on the server: no choice says which one is right, before the answer.
    expect(panel.scene.choices.map((choice:Record<string,unknown>) => Object.keys(choice).includes('correct'))).toEqual([false, false, false, false]);
    const {strings: _labels, ...shown} = panel; // the label catalogue names keys such as chat_reference_key_points
    expect(JSON.stringify(shown)).not.toMatch(/"correct":\s*true|feedback_correct|"key_points"|"claims"/);
    const hinted = await view('panel_action', {session_id, action:{type:'hint'}});
    expect(hinted.hint).toBeDefined();
    const asked = await tool('panel_action', {session_id, action:{type:'ask'}});
    expect(asked.status).toBe(400);
    expect(asked.json.code).toBe('action_unavailable');
    const answered = await view('panel_action', {session_id, action:{type:'respond', input:{kind:'quiz_choice', choiceId:'b'}, expected_scene_id:'s1-quiz-fer'}});
    expect(answered.verdict).toMatchObject({scene_id:'s1-quiz-fer', correct:true, assessed_by:'key'});
    expect(answered.actions).not.toContain('ask');
    // The explanation rung hands over to an assistant: closed here, with its reason, never a dead button.
    const explain = answered.help.rungs.find((rung:{kind:string}) => rung.kind === 'explain');
    expect(explain.available).toBe(false);
    expect(explain.why_not).toMatch(/^pas d'assistant sur cette page.: relis la leçon ou demande un indice$/);
    // A written answer no judge assessed asks for a recall rating; the rating is the learner's, through the page.
    expect(answered.scene.type).toBe('summary_audit');
    const written = await view('panel_action', {session_id, action:{type:'respond', input:{kind:'summary_audit', text:'Le résumé omet les isotopes.'}, expected_scene_id:answered.scene.id}});
    expect(written.verdict).toMatchObject({assessed_by:'none'});
    expect(written.self_rating).toMatchObject({requested:true});
    const rated = await view('panel_action', {session_id, action:{type:'rateRecall', sceneId:written.self_rating.scene_id, grade:'good'}});
    expect(rated.recall_rated).toEqual({sceneId:written.self_rating.scene_id, grade:'good'});
    const again = await view('get_panel_view', {session_id});
    expect(again.session_id).toBe(session_id);
    expect(again.surface.kind).toBe('pane');
  });
});

// D4 (waiting review 2026-11-25, owner decision 4): the server an assistant runs mints one key per learner, and the
// player plays the learner of the key for every call made with it: the page cannot choose another learner, and a key
// minted for one learner never reads or moves another learner's session.
describe('browser player: a key per learner (the server an assistant runs)', () => {
  async function keyed() {
    const host = new SessionHost({bundlesRoot:root, live:false, dataDir:null});
    const keys = new PlayerKeys();
    const server = createLessonHttpServer({host, token, bundlesRoot:root, player:createPlayer({host, keys})});
    servers.push(server);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as {port:number}).port;
    const origin = `http://127.0.0.1:${port}`;
    const as = (key:string) => async (name:string, args:Record<string,unknown>) => {
      const reply = await fetch(`${origin}/play/api/tools/${name}`, {
        method:'POST', headers:{authorization:`Bearer ${key}`, 'content-type':'application/json', origin}, body:JSON.stringify({arguments:args}),
      });
      return {status:reply.status, json:await reply.json() as any};
    };
    return {host, keys, as};
  }

  it('mints one fresh key per learner, the same for each call, and no key for nobody', async () => {
    const {keys} = await keyed();
    const ana = keys.keyFor('ana');
    expect(ana).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.keyFor('ana')).toBe(ana);
    expect(keys.keyFor('bob')).not.toBe(ana);
    expect(keys.learnerOf(`Bearer ${ana}`)).toBe('ana');
    expect(keys.learnerOf(`Bearer ${ana.slice(1)}x`)).toBeNull();
    expect(keys.learnerOf(undefined)).toBeNull();
    expect(new PlayerKeys().keyFor('ana')).not.toBe(ana);
  });

  it('plays the learner of the key, whatever learner_id the page sends', async () => {
    const {keys, as} = await keyed();
    const opened = await as(keys.keyFor('ana'))('open_lesson_panel', {bundle_ref:'atomistique-l1/lesson.json', learner_id:'bob', locale:'fr'});
    expect(opened.status).toBe(200);
    expect(opened.json.structuredContent.panel.learner_id).toBe('ana');
    const listed = await as(keys.keyFor('ana'))('list_lessons', {learner_id:'bob', language:'fr'});
    const atom = JSON.parse(listed.json.content[0].text).lessons.find((lesson:{bundle_ref:string}) => lesson.bundle_ref === 'atomistique-l1/lesson.json');
    expect(atom.status).toBeDefined();
    expect((await as('x'.repeat(64))('list_lessons', {})).status).toBe(401);
  });

  it('never acts on another learner\'s session with a key minted for one learner', async () => {
    const {keys, as, host} = await keyed();
    const bob = await host.create('atomistique-l1/lesson.json', 'bob');
    const asAna = as(keys.keyFor('ana'));
    for (const [name, args] of [
      ['get_panel_view', {session_id:bob.sessionId}],
      ['panel_action', {session_id:bob.sessionId, action:{type:'respond', input:{kind:'ack'}, expected_scene_id:bob.presentation.scene.id}}],
      ['open_lesson_panel', {session_id:bob.sessionId}],
    ] as const) {
      const refused = await asAna(name, args);
      expect(refused.status, name).toBe(403);
      expect(refused.json.code).toBe('not_your_session');
    }
    // Bob's session has not moved, and Bob's own key plays it.
    expect(host.currentPresentation(bob.sessionId).scene.id).toBe(bob.presentation.scene.id);
    const asBob = await as(keys.keyFor('bob'))('get_panel_view', {session_id:bob.sessionId});
    expect(asBob.status).toBe(200);
    expect(asBob.json.structuredContent.panel.learner_id).toBe('bob');
  });

  it('starts nothing for the server\'s default learner from a session the page acts on first', async () => {
    const {keys, as, host} = await keyed();
    const bob = await host.create('atomistique-l1/lesson.json', 'bob');
    // No view first: « start again » starts the lesson for the learner of the panel's context, which must be Bob.
    const restarted = await as(keys.keyFor('bob'))('panel_action', {session_id:bob.sessionId, action:{type:'restartLesson'}});
    expect(restarted.status, JSON.stringify(restarted.json)).toBe(200);
    const panel = restarted.json.structuredContent.panel;
    expect(panel.learner_id).toBe('bob');
    expect(await host.sessionPlays(panel.session_id, 'bob')).toBe(true);
  });
});
