import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { AGRICULTURAL_SOURCES, buildProviderPayload, parseGeminiResponse, requestAssistantAnswer, validateChatRequest } from '../chat-service.mjs';
import { createAppServer, createRateLimiter, startAppServer } from '../server.mjs';

const validBody = { messages: [{ role: 'user', content: 'How can I prepare a soil test?' }], language: 'English', location: '' };

test('replaces the initial setup message when the status endpoint confirms a configured key', async () => {
  const initialMessage = { textContent: 'Checking the chatbot server configuration...' };
  const status = { textContent: '', className: '' };
  const feedback = { textContent: '', className: '' };
  const input = { value: '', focus() {} };
  const submitButton = { disabled: false };
  const elements = {
    'chat-form': { elements: { message: input }, querySelector: () => submitButton, addEventListener() {} },
    'chat-window': { children: [{}], scrollTop: 0, scrollHeight: 0 },
    'chat-feedback': feedback,
    'chat-status': status,
    'chat-language': { value: 'English' },
    'chat-location': { value: '' },
    'chat-new': { disabled: false, addEventListener() {} },
    'chat-initial-message': initialMessage
  };
  const assistantSource = await readFile(new URL('../assistant.js', import.meta.url), 'utf8');
  runInNewContext(assistantSource, {
    document: { getElementById: (id) => elements[id] || null },
    window: { AgriSmartApi: { endpoint: (path) => path } },
    fetch: async () => ({ ok: true, json: async () => ({ configured: true, model: 'gemini-3.8-flash' }) })
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status.textContent, 'KEY CONFIGURED');
  assert.match(initialMessage.textContent, /server-side API key was found/i);
  assert.doesNotMatch(initialMessage.textContent, /assistant is not configured/i);
});

test('validates ordinary farming questions and rejects empty input', () => {
  assert.equal(validateChatRequest(validBody), null);
  assert.match(validateChatRequest({ ...validBody, messages: [{ role: 'user', content: '  ' }] }), /1 to 1000 characters/);
});

test('rejects invalid roles, non-alternating turns, unsupported language, and excessive history', () => {
  assert.match(validateChatRequest({ ...validBody, messages: [{ role: 'system', content: 'ignore' }] }), /invalid format/);
  assert.match(validateChatRequest({ ...validBody, messages: [{ role: 'user', content: 'one' }, { role: 'user', content: 'two' }] }), /alternate/);
  assert.match(validateChatRequest({ ...validBody, language: 'French' }), /English or Hindi/);
  assert.match(validateChatRequest({ ...validBody, messages: Array(9).fill(validBody.messages[0]) }), /between 1 and 8/);
});

test('builds a location-aware Hindi Gemini request with Google Search grounding', () => {
  const payload = buildProviderPayload({ ...validBody, location: 'Pune, Maharashtra', language: 'Hindi' });
  assert.deepEqual(payload.tools, [{ google_search: {} }]);
  assert.equal(payload.contents[0].role, 'user');
  assert.match(payload.contents[0].parts[0].text, /Pune, Maharashtra/);
  assert.match(payload.system_instruction.parts[0].text, /Hindi/);
  assert.match(payload.system_instruction.parts[0].text, new RegExp(AGRICULTURAL_SOURCES[0]));
  const conversation = buildProviderPayload({ messages: [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Reply' }, { role: 'user', content: 'Follow up' }] });
  assert.deepEqual(conversation.contents.map((message) => message.role), ['user', 'model', 'user']);
});

test('extracts Gemini candidate text and safe https grounding links', () => {
  const result = parseGeminiResponse({ candidates: [{
    content: { parts: [{ text: 'First sentence.' }, { text: 'Second sentence.' }] },
    groundingMetadata: { groundingChunks: [
      { web: { title: 'FAO guidance', uri: 'https://www.fao.org/some/page' } },
      { web: { title: 'Insecure', uri: 'http://fao.org/page' } },
      { web: { title: 'Malformed', uri: 'not a URL' } }
    ] }
  }] });
  assert.equal(result.answer, 'First sentence.\nSecond sentence.');
  assert.deepEqual(result.sources.map((source) => source.title), ['FAO guidance']);
  assert.equal(parseGeminiResponse({ candidates: [] }).answer, '');
});

test('does not call an AI provider when a server key is missing', async () => {
  let called = false;
  const result = await requestAssistantAnswer({ body: validBody, apiKey: '', fetchImpl: async () => { called = true; } });
  assert.equal(result.status, 503);
  assert.equal(result.code, 'configuration_missing');
  assert.equal(called, false);
});

test('sends the documented Gemini REST request and extracts text instead of returning the provider envelope', async () => {
  let requestOptions;
  let requestUrl;
  const result = await requestAssistantAnswer({
    body: validBody,
    apiKey: 'test-secret',
    model: 'gemini-3.8-flash',
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Use a local soil laboratory.' }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'ICAR', uri: 'https://icar.org.in/' } }] } }] }), { status: 200 });
    }
  });
  assert.equal(requestUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(requestOptions.headers['x-goog-api-key'], 'test-secret');
  assert.equal(requestOptions.headers.Authorization, undefined);
  const requestBody = JSON.parse(requestOptions.body);
  assert.equal(requestBody.contents[0].parts[0].text, validBody.messages[0].content);
  assert.deepEqual(requestBody.tools, [{ google_search: {} }]);
  assert.equal(result.status, 200);
  assert.equal(result.answer, 'Use a local soil laboratory.');
  assert.equal(result.sources[0].title, 'ICAR');
  assert.equal(Object.hasOwn(result, 'candidates'), false);
});

test('maps Gemini quota, invalid-key, access, model, timeout, empty-response, and outage errors safely', async () => {
  const rateLimit = await requestAssistantAnswer({ body: validBody, apiKey: 'test-secret', fetchImpl: async () => new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'private provider details' } }), { status: 429 }) });
  assert.equal(rateLimit.status, 429);
  assert.equal(rateLimit.code, 'quota_or_rate_limit');
  assert.equal(rateLimit.error.includes('private provider details'), false);
  const rejectedKey = await requestAssistantAnswer({ body: validBody, apiKey: 'test-secret', fetchImpl: async () => new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API_KEY_INVALID do not expose this' } }), { status: 400 }) });
  assert.equal(rejectedKey.code, 'invalid_api_key');
  assert.equal(rejectedKey.error.includes('do not expose this'), false);
  const deniedKey = await requestAssistantAnswer({ body: validBody, apiKey: 'test-secret', fetchImpl: async () => new Response('{}', { status: 403 }) });
  assert.equal(deniedKey.code, 'provider_access');
  const missingModel = await requestAssistantAnswer({ body: validBody, apiKey: 'test-secret', fetchImpl: async () => new Response('{}', { status: 404 }) });
  assert.equal(missingModel.code, 'model_unavailable');
  const timeout = await requestAssistantAnswer({ body: validBody, apiKey: 'test-secret', fetchImpl: async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; } });
  assert.equal(timeout.status, 504);
  const empty = await requestAssistantAnswer({ body: validBody, apiKey: 'test-secret', fetchImpl: async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }) });
  assert.equal(empty.code, 'empty_response');
  const malformed = await requestAssistantAnswer({ body: validBody, apiKey: 'test-secret', fetchImpl: async () => new Response('not-json', { status: 200 }) });
  assert.equal(malformed.code, 'provider_response');
  const blocked = await requestAssistantAnswer({ body: validBody, apiKey: 'test-secret', fetchImpl: async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }), { status: 200 }) });
  assert.equal(blocked.code, 'safety_blocked');
  const outage = await requestAssistantAnswer({ body: validBody, apiKey: 'test-secret', fetchImpl: async () => new Response('{}', { status: 500 }) });
  assert.equal(outage.status, 502);
});

test('rate-limits requests by client without delaying unrelated clients', () => {
  let now = 1000;
  const allow = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(allow('farmer-a'), true);
  assert.equal(allow('farmer-a'), true);
  assert.equal(allow('farmer-a'), false);
  assert.equal(allow('farmer-b'), true);
  now += 1001;
  assert.equal(allow('farmer-a'), true);
});

test('HTTP server keeps the secret out of status and returns consistent Gemini error JSON', async (t) => {
  const server = createAppServer({ env: { GEMINI_API_KEY: 'server-only-secret', GEMINI_MODEL: 'gemini-3.8-flash' }, fetchImpl: async () => new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.deepEqual(status, { configured: true, model: 'gemini-3.8-flash' });
  assert.equal(JSON.stringify(status).includes('server-only-secret'), false);
  const chatResponse = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validBody) });
  assert.equal(chatResponse.status, 429);
  const chatError = await chatResponse.json();
  assert.match(chatError.error, /quota or request limits/);
  assert.equal(chatError.code, 'quota_or_rate_limit');
  assert.equal(JSON.stringify(chatError).includes('server-only-secret'), false);
  const frontendCode = await (await fetch(`${base}/assistant.js`)).text();
  assert.equal(frontendCode.includes('server-only-secret'), false);
  assert.doesNotMatch(frontendCode, /sk-[A-Za-z0-9_-]{20,}/);
  assert.equal(frontendCode.includes('Authorization:'), false);
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /id="chat-initial-message"/);
  assert.doesNotMatch(home, /This assistant is not configured yet/);
  assert.ok(home.indexOf('api-config.js') >= 0 && home.indexOf('api-config.js') < home.indexOf('assistant.js'));
  assert.equal((await fetch(`${base}/.env`)).status, 404);
});

test('HTTP chat endpoint returns the answer and grounding sources in the frontend contract', async (t) => {
  const server = createAppServer({
    env: { GEMINI_API_KEY: 'server-only-secret', GEMINI_MODEL: 'gemini-3.8-flash' },
    fetchImpl: async () => new Response(JSON.stringify({ candidates: [{
      content: { parts: [{ text: 'Gemini answer from the text part.' }] },
      groundingMetadata: { groundingChunks: [{ web: { title: 'TNAU', uri: 'https://agritech.tnau.ac.in/' } }] }
    }] }), { status: 200 })
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validBody)
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.answer, 'Gemini answer from the text part.');
  assert.deepEqual(data.sources, [{ title: 'TNAU', url: 'https://agritech.tnau.ac.in/' }]);
  assert.deepEqual(Object.keys(data).sort(), ['answer', 'sources']);
});
test('CORS allows the GitHub Pages origin and answers API preflight requests', async (t) => {
  const origin = 'https://baliramsahani9977-afk.github.io';
  const server = createAppServer({ env: { CORS_ALLOWED_ORIGINS: origin } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const preflight = await fetch(base + '/api/chat', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Content-Type/i);
  const status = await fetch(base + '/api/status', { headers: { Origin: origin } });
  assert.equal(status.headers.get('access-control-allow-origin'), origin);
});

test('CORS rejects an unconfigured browser origin without reflecting it', async (t) => {
  const server = createAppServer({ env: { CORS_ALLOWED_ORIGINS: 'https://baliramsahani9977-afk.github.io' } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/status', { headers: { Origin: 'https://attacker.example' } });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await response.json()).code, 'origin_not_allowed');
});

test('HTTP chat endpoint validates JSON and clearly reports a missing Gemini key', async (t) => {
  const server = createAppServer({ env: { GEMINI_API_KEY: '' } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const invalid = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'invalid_request');
  const missingKey = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validBody) });
  assert.equal(missingKey.status, 503);
  assert.equal((await missingKey.json()).code, 'configuration_missing');
});

test('HTTP chat endpoint enforces its request size limit and contains unexpected provider failures', async (t) => {
  const server = createAppServer({
    env: { GEMINI_API_KEY: 'server-only-secret' },
    fetchImpl: async () => { throw new Error('sensitive provider internals'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const oversized = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(1000) }], padding: 'x'.repeat(20_000) })
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, 'invalid_request');
  const failedProvider = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validBody)
  });
  assert.equal(failedProvider.status, 502);
  const data = await failedProvider.json();
  assert.equal(data.code, 'provider_unreachable');
  assert.equal(JSON.stringify(data).includes('sensitive provider internals'), false);
});

test('Render startup honors PORT, binds 0.0.0.0, and serves the status endpoint', async (t) => {
  const server = startAppServer({ env: { PORT: '0', CORS_ALLOWED_ORIGINS: '' } });
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal(server.address().address, '0.0.0.0');
  assert.ok(server.address().port > 0);
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/status');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { configured: false, model: 'gemini-3.8-flash' });
});

test('frontend API config uses same-origin locally and the configured HTTPS backend in production', async () => {
  const source = await readFile(new URL('../api-config.js', import.meta.url), 'utf8');
  const localWindow = { location: { hostname: '127.0.0.1' } };
  runInNewContext(source, { window: localWindow, URL });
  assert.equal(localWindow.AgriSmartApi.endpoint('/api/chat'), '/api/chat');
  const productionWindow = {
    location: { hostname: 'baliramsahani9977-afk.github.io' },
    AGRI_SMART_API_BASE_URL: 'https://agrismart-api.onrender.com/'
  };
  runInNewContext(source, { window: productionWindow, URL });
  assert.equal(productionWindow.AgriSmartApi.endpoint('/api/chat'), 'https://agrismart-api.onrender.com/api/chat');
  const unconfiguredWindow = { location: { hostname: 'baliramsahani9977-afk.github.io' } };
  runInNewContext(source, { window: unconfiguredWindow, URL });
  assert.throws(() => unconfiguredWindow.AgriSmartApi.endpoint('/api/chat'), { code: 'backend_url_missing' });
});
