import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Call the loopback API without placing credentials in arguments or output. */
export async function callLessonApi(route:string, envelope?:unknown):Promise<unknown> {
  if (!/^\/(health|v1\/operations(?:\/[a-z_]+)?)$/.test(route)) throw new Error('Invalid API route');
  const base = new URL(process.env.STUDIUM_API_URL ?? 'http://127.0.0.1:8130');
  if (base.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('STUDIUM_API_URL must be a plain loopback HTTP origin');
  const token = process.env.STUDIUM_API_TOKEN;
  if (!token) throw new Error('Set STUDIUM_API_TOKEN in your local environment');
  const headers:Record<string,string> = {authorization:`Bearer ${token}`};
  if (envelope !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(new URL(route,base), {method:envelope === undefined ? 'GET' : 'POST',
    headers, ...(envelope === undefined ? {} : {body:JSON.stringify(envelope)}), redirect:'error', signal:AbortSignal.timeout(60_000)});
  const body = await response.json() as Record<string,unknown>;
  if (!response.ok) throw new Error(`Studium HTTP ${response.status}: ${body.code} — ${body.error}`);
  return body;
}

async function main() {
  const [operation,file] = process.argv.slice(2);
  if (!operation || operation === '--help') {
    process.stdout.write('Usage: api:call health | operations | OPERATION REQUEST.json\nJSON envelope: {arguments:{...},request_id:"unique-for-mutation",expected_scene_id:"current-scene"}\nCredentials: STUDIUM_API_TOKEN environment; optional STUDIUM_API_URL. No automatic mutation retries.\n');
    return;
  }
  if (!/^[a-z_]+$/.test(operation)) throw new Error('Invalid operation name');
  const route = operation === 'health' ? '/health' : operation === 'operations' ? '/v1/operations' : `/v1/operations/${operation}`;
  if (!['health','operations'].includes(operation) && !file) throw new Error('Pass a request JSON file; keep its request_id for retries');
  const envelope = file ? JSON.parse(await readFile(file,'utf8')) : undefined;
  process.stdout.write(JSON.stringify(await callLessonApi(route,envelope),null,2)+'\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {process.stderr.write(`${error.message}\n`); process.exitCode=1;});
}
