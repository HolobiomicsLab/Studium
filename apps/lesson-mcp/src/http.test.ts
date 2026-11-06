import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionHost } from '@studium/lesson-session-host';
import { resolve } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request as httpRequest, type Server } from 'node:http';
import { Readable } from 'node:stream';
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

/** Exercise the real HTTP request handler without opening a socket (some sandboxes forbid listen()). */
async function callInProcess(server:Server,name:string,args:Record<string,unknown>,extra:Record<string,unknown> = {}) {
  const body = Buffer.from(JSON.stringify({arguments:args,...extra}));
  const request = new Readable({read() { this.push(body); this.push(null); }}) as any;
  Object.assign(request, {
    method:'POST', url:`/v1/operations/${name}`,
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json',host:'127.0.0.1'},
    socket:{remoteAddress:'127.0.0.1',localAddress:'127.0.0.1'},
  });
  return new Promise<{status:number;body:any}>((accept) => {
    let status = 0;
    const response = {
      writeHead(code:number) { status = code; },
      end(payload:string) { accept({status,body:JSON.parse(payload)}); },
    } as any;
    server.emit('request',request,response);
  });
}

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
    // Contract decision C1/C2 (owner request 2026-11-05): the 25 lesson operations plus rate_recall;
    // the other study operations and every authoring/teacher operation remain MCP-only (I-11).
    expect(body.operations).toHaveLength(26);
    expect(body.operations.find((operation:{name:string;mutating:boolean;requires_scene_id:boolean}) =>
      operation.name === 'rate_recall')).toMatchObject({mutating:true,requires_scene_id:false});
    for (const name of ['get_study_plan','list_lessons','start_review_session','get_authoring_guide',
      'prepare_sources','create_lesson','review_lesson','class_report']) {
      expect(body.operations.some((operation:{name:string}) => operation.name === name)).toBe(false);
    }
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
  it('records a requested self-rating without an expected scene id and refuses a second rating', async () => {
    const dir = mkdtempSync(resolve(tmpdir(),'http-self-rating-')); dirs.push(dir);
    writeFileSync(resolve(dir,'lesson.json'), JSON.stringify({
      schema_version:'1.4', bundle_id:'http-self-rating', source_plan_id:'p',
      metadata:{title:'HTTP self-rating',target:'L1',duration_minutes:2,language:'en',discipline:'chemistry'},
      concepts:[{id:'c-sign',title:'Sign',description:'A sign change',bloom_level_target:'understand'}],
      scenes:[
        {id:'s-explain',type:'explain_back',title:'Explain',objective_refs:[],concept_refs:['c-sign'],
          estimated_seconds:30,adaptation_hooks:[],prompt:'Explain why the sign changes.',
          key_points:[{id:'kp',text:'The sign changes between lobes.',cues:['sign']}],
          model_explanation:'The sign changes between lobes.',rubric:{completeness:1,evidence_quality:1,tone:1}},
        {id:'s-quiz',type:'quiz',title:'Check',objective_refs:[],concept_refs:['c-sign'],estimated_seconds:30,
          adaptation_hooks:[],question:'Does the sign change?',choices:[
            {id:'yes',text:'Yes',correct:true},{id:'no',text:'No',correct:false}],
          feedback_correct:'Correct.',feedback_incorrect:'Try again.',hints:[]},
      ],
      rules:[],validated_by:'Test',validated_at:'2026-11-05T00:00:00Z',
    }));
    const host = new SessionHost({bundlesRoot:dir,live:false,dataDir:null});
    const server = createLessonHttpServer({host,token,bundlesRoot:dir});
    const call = (name:string,args:Record<string,unknown>,extra:Record<string,unknown> = {}) =>
      callInProcess(server,name,args,extra);
    const started = await call('start_lesson_session',{bundle_ref:'lesson.json'},{request_id:'start-rating'});
    expect(started.status).toBe(200);
    const session_id = started.body.session_id;
    const scene_id = host.currentPresentation(session_id).scene.id;
    const answered = await call('submit_response',
      {session_id,input:{kind:'reply',text:'The sign changes between the lobes.'}},
      {request_id:'answer-rating',expected_scene_id:scene_id});
    expect(answered.status).toBe(200);
    expect(answered.body.transition.self_rating).toEqual({
      requested:true,grades:['again','hard','good','easy'],scene_id:'s-explain',
    });

    expect((await call('rate_recall',{session_id,scene_id:'s-explain',grade:'hard'})).status).toBe(400);
    const rated = await call('rate_recall',{session_id,scene_id:'s-explain',grade:'hard'},{request_id:'rate-once'});
    expect(rated).toMatchObject({status:200,body:{scene_id:'s-explain',concept_id:'c-sign',grade:'hard',source:'self_rated'}});
    expect(await call('rate_recall',{session_id,scene_id:'s-explain',grade:'hard'},{request_id:'rate-once'})).toEqual(rated);
    const second = await call('rate_recall',{session_id,scene_id:'s-explain',grade:'good'},{request_id:'rate-twice'});
    expect(second).toMatchObject({status:422,body:{code:'operation_failed'}});
    expect(second.body.error).toMatch(/no self-rating was requested for scene "s-explain"/);
  });
  it('plays the two live-trial regressions through the HTTP handler on atomistique-l1', async () => {
    const host = new SessionHost({bundlesRoot:root,live:false,dataDir:null});
    const server = createLessonHttpServer({host,token,bundlesRoot:root});
    const call = (name:string,args:Record<string,unknown>,extra:Record<string,unknown> = {}) =>
      callInProcess(server,name,args,extra);
    const fixture = JSON.parse(readFileSync(resolve(root,'atomistique-l1/lesson.json'),'utf8')) as any;
    const keyedText = (sceneId:string) => fixture.scenes.find((scene:any) => scene.id === sceneId)
      .choices.find((choice:any) => choice.correct).text as string;
    const displayedId = (presentation:any,text:string) => {
      const choice = presentation.scene.choices.find((candidate:any) => candidate.text === text);
      if (!choice) throw new Error(`displayed choice not found: ${text}`);
      return choice.id as string;
    };

    const started = await call('start_lesson_session',
      {bundle_ref:'atomistique-l1/lesson.json',learner_id:'http-trial-regression'},
      {request_id:'trial-start'});
    expect(started.status).toBe(200);
    const session_id = started.body.session_id as string;
    let presentation = started.body.presentation;
    let request = 0;
    const respond = async (input:Record<string,unknown>) => {
      const sceneId = presentation.scene.id as string;
      const answered = await call('submit_response',{session_id,input},
        {request_id:`trial-answer-${++request}`,expected_scene_id:sceneId});
      expect(answered.status, JSON.stringify(answered.body)).toBe(200);
      const transition = answered.body.transition;
      if (transition.presentation) presentation = transition.presentation;
      return transition;
    };

    await respond({kind:'ack'}); // intro
    await respond({kind:'ack'}); // particles concept
    await respond({kind:'quiz_choice',choiceId:displayedId(presentation,keyedText('s1-quiz-fer'))});
    await respond({kind:'summary_audit',text:'A et Z permettent de vérifier protons et neutrons.'});
    await respond({kind:'ack'}); // quantum-numbers concept
    expect(presentation.scene.id).toBe('s2-quiz-4f');

    const wrong = await respond({kind:'quiz_choice',choiceId:displayedId(presentation,'5')});
    // The gate now sends the learner to another item of the same concept (the closing recall item,
    // unseen so far) instead of the question just missed; the reference stays held back meanwhile.
    expect(wrong.presentation.scene.id).toBe('s9-rappel-3d');
    expect(wrong.verdict.key_points).toBeUndefined();
    expect(wrong.verdict.feedback).toContain('compte les valeurs entières');
    expect(wrong.verdict.display_markdown).toContain('✗');
    expect(wrong.verdict.display_markdown).not.toMatch(/(^|[^\p{L}\p{N}])7([^\p{L}\p{N}]|$)/u);

    await respond({kind:'quiz_choice',choiceId:displayedId(presentation,keyedText('s9-rappel-3d'))});
    expect(presentation.scene.id).toBe('s3-concept-orbitales');
    await respond({kind:'ack'});
    await respond({kind:'quiz_choice',choiceId:displayedId(presentation,keyedText('s3-quiz-noeuds'))});
    expect(presentation.scene.id).toBe('s3b-explain-2p');
    const explained = await respond({kind:'explanation',text:'Les deux lobes ont des signes opposés de part et d’autre du plan nodal.'});
    expect(explained.self_rating).toMatchObject({requested:true,scene_id:'s3b-explain-2p'});
    const rated = await call('rate_recall',
      {session_id,scene_id:'s3b-explain-2p',grade:'good'},
      {request_id:'trial-rate-s3b'});
    expect(rated).toMatchObject({status:200,body:{scene_id:'s3b-explain-2p',grade:'good',source:'self_rated'}});
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
