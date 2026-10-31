import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requestAssistantAnswer } from './chat-service.mjs';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml']
]);

function loadLocalEnv() {
  return readFile(path.join(projectDir, '.env'), 'utf8').then((contents) => {
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || (process.env[match[1]] !== undefined && process.env[match[1]] !== '')) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
      process.env[match[1]] = value;
    }
  }).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20_000) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Send valid JSON.'), { status: 400 }); }
}

export function createRateLimiter({ limit = 10, windowMs = 60_000, now = Date.now } = {}) {
  const clients = new Map();
  return (key) => {
    const current = now();
    const entries = (clients.get(key) || []).filter((time) => current - time < windowMs);
    if (entries.length >= limit) {
      clients.set(key, entries);
      return false;
    }
    entries.push(current);
    clients.set(key, entries);
    if (clients.size > 1000) {
      for (const [client, times] of clients) if (!times.some((time) => current - time < windowMs)) clients.delete(client);
    }
    return true;
  };
}

export function createAppServer({ env = process.env, fetchImpl = fetch } = {}) {
  const allowRequest = createRateLimiter();
  return createHttpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const requestUrl = new URL(request.url, 'http://localhost');

    if (requestUrl.pathname === '/api/status' && request.method === 'GET') {
      return sendJson(response, 200, { configured: Boolean(env.GEMINI_API_KEY), model: env.GEMINI_MODEL || 'gemini-3.8-flash' });
    }

    if (requestUrl.pathname === '/api/chat' && request.method === 'POST') {
      const forwarded = request.headers['x-forwarded-for'];
      const clientKey = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : request.socket.remoteAddress || 'local';
      if (!allowRequest(clientKey)) return sendJson(response, 429, { error: 'Too many chat requests. Wait a minute and try again.' });
      let body;
      try { body = await readJson(request); }
      catch (error) { return sendJson(response, error.status || 400, { error: error.message, code: 'invalid_request' }); }
      const result = await requestAssistantAnswer({
        body,
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL || 'gemini-3.8-flash',
        fetchImpl
      });
      return sendJson(response, result.status, result.status === 200
        ? { answer: result.answer, sources: result.sources }
        : { error: result.error, code: result.code });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' });

    let pathname;
    try { pathname = decodeURIComponent(requestUrl.pathname); }
    catch { return sendJson(response, 400, { error: 'Invalid path.' }); }
    if (pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.'))) return sendJson(response, 404, { error: 'Not found.' });
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(projectDir, relativePath);
    if (!filePath.startsWith(`${projectDir}${path.sep}`)) return sendJson(response, 404, { error: 'Not found.' });

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) return sendJson(response, 404, { error: 'Not found.' });
      const contents = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': mimeTypes.get(path.extname(filePath)) || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      return response.end(request.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      return sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : 'Could not read this file.' });
    }
  });
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(thisFile).href) {
  await loadLocalEnv();
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Agri Smart is running at http://127.0.0.1:${port}`);
    if (!process.env.GEMINI_API_KEY) console.log('Chat is not configured yet. Add GEMINI_API_KEY to .env and restart to enable it.');
  });
}
