import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionHost } from '@studium/lesson-session-host';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request as httpRequest, type Server } from 'node:http';
import { createLessonHttpServer } from './http.js';

const root = resolve(import.meta.dirname, '../../../fixtures');
const token = 'synthetic-test-token-with-32-characters';
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()); })));
  dirs.splice(0).forEach(p => rmSync(p, {recursive:true, force:true}));
});
async function setup(options: {bundlesRoot?: string; maxRequests?: number} = {}) {
  const bundlesRoot = options.bundlesRoot ?? root;
  const host = new SessionHost({bundlesRoot, live:false, dataDir:null}); // I-10: in memory, whatever the environment says
  const server = createLessonHttpServer({host, token, bundlesRoot, ...options});
  servers.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address() as {port:number};
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (name:string, args:Record<string,unknown>, extra:Record<string,unknown> = {}) => {
    const response = await fetch(`${base}/v1/operations/${name}`, {method:'POST', headers:{authorization:`Bearer ${token}`, 'content-type':'application/json'}, body:JSON.stringify({arguments:args,...extra})});
    return {status:response.status, body:await response.json() as any};
  };
  return {base,call,host};
}
const startArgs = {bundle_ref:'capsule-judgment-demo/lesson.json'};
const start = (call:any) => call('start_lesson_session', startArgs, {request_id:'start'});

describe('local lesson HTTP API', () => {
  it('requires auth; rejects origins and hostile hosts', async () => {
    const {base} = await setup();
    expect((await fetch(base+'/health')).status).toBe(401);
    expect((await fetch(base+'/health', {headers:{authorization:`Bearer ${token}`,origin:'https://example.com'}})).status).toBe(403);
    // Native request preserves Host; fetch can overwrite it.
    const hostileStatus = await new Promise<number | undefined>((accept,reject) => {
      const request = httpRequest(base+'/health', {headers:{authorization:`Bearer ${token}`,host:'evil.example'}}, response => {response.resume(); accept(response.statusCode);});
      request.on('error',reject); request.end();
    });
    expect(hostileStatus).toBe(403);
    expect((await fetch(base+'/health', {headers:{authorization:`Bearer ${token}`}})).status).toBe(200);
  });
  it('discovers complete input schemas and operation semantics', async () => {
    const {base} = await setup();
    const response = await fetch(base+'/v1/operations', {headers:{authorization:`Bearer ${token}`}});
    const body:any = await response.json();
    const submit = body.operations.find((x:any) => x.name === 'submit_response');
    expect(submit.input_schema.properties.input).toBeDefined();
    expect(submit.mutating).toBe(true);
    expect(submit.requires_scene_id).toBe(true);
    expect(body.operations.some((x:any) => x.name === 'record_experiment')).toBe(true);
    // The lesson operations only: the study, authoring and teacher tools are MCP-only this sprint (I-11).
    expect(body.operations).toHaveLength(25);
    for (const name of ['get_server_info', 'list_community_bundles']) {
      expect(body.operations.find((operation:{name:string;mutating:boolean}) => operation.name === name)?.mutating).toBe(false);
    }
    const info = await fetch(`${base}/v1/operations/get_server_info`, {
      method:'POST', headers:{authorization:`Bearer ${token}`, 'content-type':'application/json'},
      body:JSON.stringify({arguments:{}}),
    });
    expect(info.status).toBe(200);
    const metadata = await info.json() as {tools:string[]};
    expect(metadata.tools).toEqual(body.operations.map((operation:{name:string}) => operation.name).sort());
  });
  it('redacts answers, resumes via a second client and switches language', async () => {
    const {call,host} = await setup();
    const created = await start(call);
    expect(created.status).toBe(200);
    const session_id = created.body.session_id;
    const context = await call('get_operator_context', {session_id});
    expect(context.status).toBe(200);
    const scene_id = host.currentPresentation(session_id).scene.id;
    const changed = await call('set_session_language', {session_id,presentation_language:'en'}, {request_id:'language'});
    expect(changed.status).toBe(200);
    const advanced = await call('submit_response', {session_id,input:{kind:'ack'}}, {request_id:'answer',expected_scene_id:scene_id});
    expect(advanced.status).toBe(200);
    expect(JSON.stringify(advanced.body)).not.toContain('flaws_expected');
    expect((await call('get_current_scene', {session_id})).status).toBe(200);
  });
  it('deduplicates concurrent submissions and rejects changed retry payloads and stale scenes', async () => {
    const {call,host} = await setup();
    const {body:{session_id}} = await start(call);
    const scene_id = host.currentPresentation(session_id).scene.id;
    const args = {session_id,input:{kind:'ack'}};
    const extra = {request_id:'answer',expected_scene_id:scene_id};
    const [a,b] = await Promise.all([call('submit_response',args,extra),call('submit_response',args,extra)]);
    expect(a.status).toBe(200); expect(b).toEqual(a);
    expect((await call('submit_response',args,{...extra,request_id:'stale'})).status).toBe(409);
    expect((await call('submit_response',{...args,input:{kind:'confidence',value:2}},extra)).status).toBe(409);
    expect((await call('get_current_scene',{session_id})).status).toBe(200);
  });
  it('requires request and scene identifiers; validates arguments', async () => {
    const {call} = await setup();
    expect((await call('start_lesson_session', startArgs)).status).toBe(400);
    const {body:{session_id}} = await start(call);
    expect((await call('submit_response',{session_id,input:{kind:'ack'}},{request_id:'a'})).status).toBe(400);
    expect((await call('submit_response',{session_id,input:{kind:'invalid'}},{request_id:'b',expected_scene_id:'s-intro'})).status).toBe(400);
    expect((await call('get_current_scene',{session_id:'missing'})).status).toBe(404);
    expect((await call('unknown',{})).status).toBe(404);
  });
  it('forget erases cached session outputs and makes old request IDs unusable', async () => {
    const {call} = await setup();
    const {body:{session_id}} = await start(call);
    expect((await call('forget_session',{session_id},{request_id:'forget'})).status).toBe(200);
    expect((await start(call)).status).toBe(410);
    expect((await call('get_current_scene',{session_id})).status).toBe(404);
  });
  it('forgets a learner by learner_id, with no session to name, and retires the request IDs of the sessions it closed', async () => {
    // L-13: forget_session {learner_id} erases a learner who has no live session; one still open closes.
    const {call} = await setup();
    const started = await call('start_lesson_session', {...startArgs, learner_id:'ana'}, {request_id:'start-ana'});
    expect(started.status).toBe(200);
    const forgotten = await call('forget_session', {learner_id:'ana'}, {request_id:'forget-ana'});
    expect(forgotten.status).toBe(200);
    expect(forgotten.body).toMatchObject({forgotten:true, scope:'learner'});
    const stale = await call('start_lesson_session', {...startArgs, learner_id:'ana'}, {request_id:'start-ana'});
    expect(stale.status).toBe(410);
    expect(stale.body.code).toBe('forgotten');
    expect((await call('get_current_scene', {session_id:started.body.session_id})).status).toBe(404);
  });
  it('rejects traversal and symlink bundles outside the configured root', async () => {
    const dir = mkdtempSync(resolve(tmpdir(),'http-bundles-')); dirs.push(dir);
    symlinkSync(resolve(root, startArgs.bundle_ref),resolve(dir,'outside.json'));
    const {call} = await setup({bundlesRoot:dir});
    for(const bundle_ref of ['../x.json','outside.json']) {
      expect((await call('start_lesson_session',{bundle_ref},{request_id:bundle_ref})).status).toBe(400);
    }
  });
  it('caps retained mutation requests without evicting retry protection', async () => {
    const {call} = await setup({maxRequests:1});
    const first = await start(call);
    expect((await start(call))).toEqual(first);
    expect((await call('start_lesson_session', startArgs, {request_id:'second'})).status).toBe(503);
    expect((await call('get_current_scene', {session_id:first.body.session_id})).status).toBe(200);
    const erased = await call('forget_session',{session_id:first.body.session_id},{request_id:'erase-at-cap'});
    expect(erased.status).toBe(200);
    expect(await call('forget_session',{session_id:first.body.session_id},{request_id:'erase-at-cap'})).toEqual(erased);
    expect((await start(call)).status).toBe(410);
  });
  it('closes without erasure even at the receipt cap and rejects retries against the closed handle', async () => {
    const {call,host} = await setup({maxRequests:1});
    const {body:{session_id}} = await start(call);
    const forget = vi.spyOn(host, 'forget');
    const closed = await call('end_session',{session_id},{request_id:'close-at-cap'});
    expect(closed).toEqual({status:200,body:{closed:true,state_kept:true}});
    expect(forget).not.toHaveBeenCalled();
    expect(await call('end_session',{session_id},{request_id:'close-at-cap'})).toEqual(closed);
    const stale = await start(call);
    expect(stale.status).toBe(410);
    expect(stale.body.code).toBe('session_closed');
    expect((await call('get_current_scene',{session_id})).status).toBe(404);
  });
  it('rejects invalid JSON, media types and oversized request bodies', async () => {
    const {base} = await setup();
    for (const [body,type,status] of [['{','application/json',400],['{}','text/plain',415],['x'.repeat(1048577),'application/json',413]] as const) {
      expect((await fetch(base+'/v1/operations/start_lesson_session', {method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':type},body})).status).toBe(status);
    }
  });
});
