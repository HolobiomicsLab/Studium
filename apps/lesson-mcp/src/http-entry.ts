import { resolve } from 'node:path';
import { SessionHost } from '@studium/lesson-session-host';
import { createLessonHttpServer } from './http.js';

const bundlesRoot = resolve(process.env.BUNDLES_ROOT ?? '../../fixtures');
const token = process.env.STUDIUM_API_TOKEN ?? '';
const port = Number(process.env.STUDIUM_API_PORT ?? '8130');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('STUDIUM_API_PORT must be between 1 and 65535');
// Provider activation must be explicit for this transport.
const host = new SessionHost({bundlesRoot,live:process.env.STUDIUM_API_LIVE === '1'});
const server = createLessonHttpServer({host,token,bundlesRoot});
server.on('error', error => { process.stderr.write(`Studium API could not start: ${error.message}\n`); process.exitCode = 1; });
server.listen(port,'127.0.0.1',() => process.stderr.write(`Studium API ready at http://127.0.0.1:${port}; sessions last for this process.\n`));
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,() => { server.close(); server.closeAllConnections(); });
