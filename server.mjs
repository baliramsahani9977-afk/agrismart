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
  const allowedOrigins = new Set(String(env.CORS_ALLOWED_ORIGINS || 'https://baliramsahani9977-afk.github.io,http://127.0.0.1:3000,http://localhost:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean));
  return createHttpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const requestUrl = new URL(request.url, 'http://localhost');
    const isApiRequest = requestUrl.pathname.startsWith('/api/');
    const origin = request.headers.origin;

    if (isApiRequest && origin && !allowedOrigins.has(origin)) {
      return sendJson(response, 403, { error: 'This website is not allowed to access the API.', code: 'origin_not_allowed' });
    }
    if (isApiRequest && origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    if (isApiRequest && request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Access-Control-Max-Age', '600');
      response.writeHead(204);
      return response.end();
    }

    if (requestUrl.pathname === '/api/status' && request.method === 'GET') {
      return sendJson(response, 200, { configured: Boolean(env.GEMINI_API_KEY), model: env.GEMINI_MODEL || 'gemini-3.8-flash' });
    }

    if (requestUrl.pathname === '/api/chat' && request.method === 'POST') {
      const forwarded = request.headers['x-forwarded-for'];
      const forwardedAddresses = typeof forwarded === 'string' ? forwarded.split(',').map((address) => address.trim()).filter(Boolean) : [];
      const clientKey = forwardedAddresses.at(-1) || request.socket.remoteAddress || 'local';
      if (!allowRequest(clientKey)) return sendJson(response, 429, { error: 'Too many chat requests. Wait a minute and try again.' });
      let body;
      try { body = await readJson(request); }
      catch (error) { return sendJson(response, error.status || 400, { error: error.message, code: 'invalid_request' }); }
      let result;
      try {
        result = await requestAssistantAnswer({
          body,
          apiKey: env.GEMINI_API_KEY,
          model: env.GEMINI_MODEL || 'gemini-3.8-flash',
          fetchImpl
        });
      } catch {
        result = { status: 502, code: 'provider_error', error: 'The AI service could not complete the request.' };
      }
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

export function startAppServer({ env = process.env, host = '0.0.0.0' } = {}) {
  const rawPort = env.PORT === undefined || env.PORT === '' ? '3000' : env.PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid TCP port number.');
  const server = createAppServer({ env });
  server.listen(port, host, () => {
    console.log('Agri Smart backend listening on ' + host + ':' + server.address().port);
    if (!env.GEMINI_API_KEY) console.log('Chat is not configured yet. Add GEMINI_API_KEY to the server environment to enable it.');
  });
  return server;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(thisFile).href) {
  await loadLocalEnv();
  startAppServer();
}
