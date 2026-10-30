import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { SessionHost } from '@studium/lesson-session-host';
import { lessonOperations, type Operation } from './operations.js';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RECEIPT_BYTES = 16 * 1024 * 1024;
const READ_ONLY = new Set(['get_experiment_journal', 'get_operator_context', 'get_current_scene',
  'get_scene_artifacts', 'get_next_reinforcement', 'get_run_manifest', 'explain_last_adaptation',
  'get_workflow_graph', 'get_session_state', 'get_peer_room_state', 'get_server_info', 'list_community_bundles']);
const SESSION_ENDINGS = new Set(['end_session', 'forget_session']);
const SCENE_ACTIONS = new Set(['submit_response', 'submit_turn', 'submit_run_result', 'request_hint', 'record_experiment']);
const Envelope = z.object({arguments:z.record(z.unknown()), request_id:z.string().min(1).max(128).optional(),
  expected_scene_id:z.string().min(1).optional()}).strict();
type EnvelopeInput = z.infer<typeof Envelope>;
type Reply = {status:number; body:Record<string, unknown>};
type Receipt = {digest:string; reply:Reply; sessionId?:string};
export interface HttpOptions {host:SessionHost; token:string; bundlesRoot:string; maxRequests?:number;}
class HttpError extends Error {
  constructor(readonly status:number, readonly code:string, message:string) { super(message); }
}
const problem = (status:number, code:string, error:string):Reply => ({status, body:{error,code}});

/** Build a local single-owner API; caller must listen on a loopback address. */
export function createLessonHttpServer(options:HttpOptions) {
  if (options.token.length < 32) throw new Error('STUDIUM_API_TOKEN must contain at least 32 characters');
  // Lead decision I-11 (2026-10-30 sprint): this adapter serves the lesson operations only. The study
  // tools (get_study_plan, list_lessons, rate_recall, start_review_session), the authoring tools
  // (get_authoring_guide, prepare_sources, create_lesson) and the teacher tools (review_lesson,
  // class_report) stay MCP-only this sprint: server.ts registers them, http.test.ts pins what is here.
  const operations = lessonOperations(options.host);
  const dispatch = createDispatcher(options, operations);
  const server = createServer(async (request,response) => {
    try {
      authorize(request, options.token);
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && path === '/health') return send(response,{status:200,body:{schema:'studium/http/v1',status:'ready',sessions:'process-local'}});
      if (request.method === 'GET' && path === '/v1/operations') return send(response,{status:200,body:{schema:'studium/http/v1',operations:operations.map(describeOperation)}});
      const operation = operations.find(op => path === `/v1/operations/${op.name}`);
      if (!operation || request.method !== 'POST') throw new HttpError(404,'not_found','Unknown API route');
      const input = Envelope.parse(await readJson(request));
      send(response, await dispatch(operation,input));
    } catch (error) { send(response,errorReply(error)); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}

function authorize(request:IncomingMessage, token:string) {
  const remote = request.socket.remoteAddress;
  const local = request.socket.localAddress;
  if (![remote,local].every(address => address && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address))) throw new HttpError(403,'local_only','Only loopback connections are supported');
  if (request.headers.origin !== undefined || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.host ?? '')) throw new HttpError(403,'origin_rejected','Browser origins and nonlocal hosts are not supported');
  const received = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (received.length !== expected.length || !timingSafeEqual(received,expected)) throw new HttpError(401,'unauthorized','A valid bearer token is required');
}

function describeOperation(operation:Operation) {
  return {name:operation.name,description:operation.description,mutating:!READ_ONLY.has(operation.name),
    requires_scene_id:SCENE_ACTIONS.has(operation.name),
    input_schema:zodToJsonSchema(z.object(operation.inputSchema).strict(), {$refStrategy:'none'})};
}

function readJson(request:IncomingMessage):Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new HttpError(415,'media_type','Use application/json');
  return new Promise((accept,reject) => {
    let length = 0;
    let chunks:Buffer[] = [];
    let exceeded = false;
    request.on('data',(chunk:Buffer) => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) { exceeded = true; chunks = []; reject(new HttpError(413,'body_too_large','Request exceeds 1 MiB')); }
      if (!exceeded) chunks.push(chunk);
    });
    request.on('end',() => {
      if (exceeded) return;
      try { accept(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400,'invalid_json','Body is not valid JSON')); }
    });
    request.on('error',reject);
  });
}

function createDispatcher(options:HttpOptions, operations:Operation[]) {
  const receipts = new Map<string,Receipt>();
  let queue:Promise<unknown> = Promise.resolve();
  let pending = 0;
  let receiptBytes = 0;
  const maxRequests = options.maxRequests ?? 512;
  if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new Error('maxRequests must be a positive integer');
  const execute = async (operation:Operation,input:EnvelopeInput):Promise<Reply> => {
    const mutation = !READ_ONLY.has(operation.name);
    if (mutation && !input.request_id) throw new HttpError(400,'request_id_required','Mutations require request_id; reuse it for an identical retry');
    const digest = createHash('sha256').update(JSON.stringify([operation.name,input.arguments,input.expected_scene_id])).digest('hex');
    const prior = input.request_id ? receipts.get(input.request_id) : undefined;
    if (mutation && prior) {
      if (prior.digest !== digest) throw new HttpError(409,'request_conflict','request_id already used for a different operation or payload');
      return prior.reply;
    }
    if (mutation && (receipts.size >= maxRequests || receiptBytes >= MAX_RECEIPT_BYTES) && !SESSION_ENDINGS.has(operation.name)) throw new HttpError(503,'receipt_limit','Mutation receipt limit reached; read/export your session before starting a new server');
    z.object(operation.inputSchema).strict().parse(input.arguments);
    if (SESSION_ENDINGS.has(operation.name)) options.host.getState(String(input.arguments.session_id));
    await validateBundle(options.bundlesRoot,input.arguments);
    if (SCENE_ACTIONS.has(operation.name)) {
      if (!input.expected_scene_id) throw new HttpError(400,'scene_required','Fetch current scene and provide expected_scene_id');
      const current = options.host.currentPresentation(String(input.arguments.session_id)).scene.id;
      if (current !== input.expected_scene_id) throw new HttpError(409,'stale_scene','Scene changed; read current context before responding');
    }
    const result = await operation.invoke(input.arguments);
    const body = JSON.parse(result.content[0]?.text ?? '{}') as Record<string,unknown>;
    const reply = result.isError ? problem(String(body.error).startsWith('session not found:') ? 404 : 422,'operation_failed',String(body.error)) : {status:200,body};
    if (mutation && input.request_id) {
      const sessionId = String(input.arguments.session_id ?? body.session_id ?? '');
      if (SESSION_ENDINGS.has(operation.name) && !result.isError) invalidateReceipts(receipts,sessionId,operation.name === 'forget_session');
      receipts.set(input.request_id,{digest,reply,sessionId});
      receiptBytes = [...receipts.values()].reduce((total,receipt) => total + Buffer.byteLength(JSON.stringify(receipt.reply)),0);
    }
    return reply;
  };
  return (operation:Operation,input:EnvelopeInput):Promise<Reply> => {
    if (!operations.includes(operation)) return Promise.resolve(problem(404,'not_found','Unknown operation'));
    if (pending >= 64) return Promise.resolve(problem(503,'busy','Too many pending requests; retry with the same request_id'));
    pending++;
    const result = queue.then(() => execute(operation,input)).catch(errorReply).finally(() => { pending--; });
    queue = result;
    return result;
  };
}

async function validateBundle(root:string,args:Record<string,unknown>) {
  if (typeof args.bundle_ref !== 'string') return;
  try {
    const base = await realpath(root);
    const full = await realpath(resolve(base,args.bundle_ref));
    const path = relative(base,full);
    if (!path || path === '..' || path.startsWith('../') || isAbsolute(path)) throw new Error('outside');
  } catch { throw new HttpError(400,'invalid_bundle','Bundle must exist inside the configured bundles root'); }
}

function invalidateReceipts(receipts:Map<string,Receipt>, sessionId:string, forgotten:boolean) {
  for (const receipt of receipts.values()) {
    if (receipt.sessionId === sessionId) receipt.reply = forgotten
      ? problem(410,'forgotten','This session and its cached outputs were forgotten')
      : problem(410,'session_closed','This session was closed; start a new session to resume saved progress');
  }
}
function errorReply(error:unknown):Reply {
  if (error instanceof HttpError) return problem(error.status,error.code,error.message);
  if (error instanceof z.ZodError) return problem(400,'invalid_input',error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  if (error instanceof Error && error.message.startsWith('session not found:')) return problem(404,'session_not_found','Session unavailable; it may have been forgotten or the server restarted');
  return problem(500,'internal_error','Operation failed; inspect the local server installation');
}
function send(response:ServerResponse,reply:Reply) {
  response.writeHead(reply.status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  response.end(JSON.stringify(reply.body));
}
