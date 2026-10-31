export const AGRICULTURAL_SOURCES = Object.freeze([
  'icar.org.in',
  'icar.gov.in',
  'iari.res.in',
  'agritech.tnau.ac.in',
  'tnau.ac.in',
  'fao.org',
  'agriwelfare.gov.in',
  'agmarknet.gov.in',
  'manage.gov.in',
  'gov.in'
]);

export function validateChatRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Send a valid chat request.';
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 8) {
    return 'A conversation must contain between 1 and 8 messages.';
  }
  for (const message of body.messages) {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      return 'Conversation messages have an invalid format.';
    }
    if (!message.content.trim() || message.content.length > 1000) return 'Each message must contain 1 to 1000 characters.';
  }
  if (body.messages.at(-1).role !== 'user') return 'The newest conversation message must be from the user.';
  if (body.messages.some((message, index) => index > 0 && message.role === body.messages[index - 1].role)) {
    return 'Conversation turns must alternate between user and assistant.';
  }
  if (body.location !== undefined && (typeof body.location !== 'string' || body.location.length > 100)) {
    return 'Location must be 100 characters or fewer.';
  }
  if (body.language !== undefined && !['English', 'Hindi'].includes(body.language)) return 'Choose English or Hindi.';
  return null;
}

export function createInstructions(language = 'English') {
  const preferredDomains = AGRICULTURAL_SOURCES.join(', ');
  return `You are Agri Smart, an agricultural information assistant. Answer the farmer in ${language}, in plain, practical language with short steps where useful. Use Google Search grounding for current factual agricultural claims, and prefer credible official agriculture, research, FAO, and government sources, especially these domains: ${preferredDomains}. The app displays retrieved citations as source links separately, so do not type raw URLs or invent citations. Clearly distinguish sourced information from general explanation. If search does not find relevant reliable evidence, say so plainly and do not invent sources, local recommendations, current weather, prices, crop suitability, pesticide instructions, fertilizer doses, or scheme eligibility. If no location is supplied, ask for state/district/country only when it materially changes the answer; do not require it for general questions. Use supplied location only at the detail level supported by retrieved sources; never infer village-level facts from a state-level source. For pesticides, ask for crop, pest/symptoms, growth stage and location when important; prefer current official product labels and local extension guidance, do not guess concentrations or mixes, and advise label compliance and protective equipment. For fertilizer dosage, explain that a local soil test and crop/stage-specific official recommendation are needed before giving a rate. Describe symptom possibilities as uncertain, not a diagnosis, and recommend an agricultural expert/KVK for severe or unclear cases. Treat model output as informational, never as a yield guarantee or substitute for a local agronomist. For time-sensitive topics such as weather, market prices and government schemes, use retrieved current sources and state dates when available.`;
}

export function buildProviderPayload({ messages, location = '', language = 'English' }) {
  const contents = messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }));
  if (location) {
    const last = contents.at(-1);
    last.parts[0].text = `Optional farm location supplied by the user: ${location}.\n\nUser question: ${last.parts[0].text}`;
  }
  return {
    system_instruction: { parts: [{ text: createInstructions(language) }] },
    contents,
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 900 }
  };
}

function isHttpsSource(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseGeminiResponse(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const candidate = candidates.find((item) => Array.isArray(item?.content?.parts) && item.content.parts.some((part) => typeof part.text === 'string' && part.text.trim())) || candidates[0];
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const answer = parts.filter((part) => typeof part.text === 'string').map((part) => part.text).join('\n').trim();
  const sources = new Map();
  for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
    const web = chunk.web;
    if (web && isHttpsSource(web.uri)) sources.set(web.uri, { title: web.title || '', url: web.uri });
  }
  for (const annotation of candidate?.content?.parts?.flatMap((part) => part.annotations || []) || []) {
    const url = annotation.url || annotation.url_citation?.url;
    if (isHttpsSource(url)) sources.set(url, { title: annotation.title || annotation.url_citation?.title || '', url });
  }
  return {
    answer,
    sources: [...sources.values()],
    finishReason: candidate?.finishReason || '',
    blockReason: payload?.promptFeedback?.blockReason || ''
  };
}

async function providerErrorDetails(response) {
  try {
    const payload = await response.json();
    const message = String(payload?.error?.message || '');
    return {
      status: String(payload?.error?.status || '').toUpperCase(),
      code: String(payload?.error?.code || '').toUpperCase(),
      keyRejected: /API[_ ]KEY[_ ]INVALID|API key not valid/i.test(message)
    };
  } catch {
    return { status: '', code: '', keyRejected: false };
  }
}

export async function requestAssistantAnswer({ body, apiKey, model = 'gemini-3.8-flash', fetchImpl = fetch, timeoutMs = 45000 }) {
  if (!apiKey) return { status: 503, code: 'configuration_missing', error: 'Gemini API is not configured.' };
  const invalid = validateChatRequest(body);
  if (invalid) return { status: 400, code: 'invalid_request', error: invalid };
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,99}$/.test(model)) {
    return { status: 500, code: 'model_configuration', error: 'The configured Gemini model name is invalid.' };
  }

  let response;
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildProviderPayload(body)),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return { status: 504, code: 'provider_timeout', error: 'Gemini took too long to respond.' };
    return { status: 502, code: 'provider_unreachable', error: 'Could not reach the Gemini API.' };
  }

  if (!response.ok) {
    const details = await providerErrorDetails(response);
    const providerStatus = details.status;
    if (response.status === 401 || providerStatus === 'UNAUTHENTICATED' || details.code.includes('API_KEY_INVALID') || details.keyRejected) {
      return { status: 502, code: 'invalid_api_key', error: 'Gemini rejected the server API key.' };
    }
    if (response.status === 403 || providerStatus === 'PERMISSION_DENIED') {
      return { status: 502, code: 'provider_access', error: 'The Gemini API key or project does not have access to this request.' };
    }
    if (response.status === 404) return { status: 502, code: 'model_unavailable', error: 'The configured Gemini model or endpoint was not found.' };
    if (response.status === 429 || providerStatus === 'RESOURCE_EXHAUSTED') {
      return { status: 429, code: 'quota_or_rate_limit', error: 'Gemini quota or request limits were reached.' };
    }
    return { status: 502, code: 'provider_error', error: 'Gemini could not complete the request.' };
  }

  let payload;
  try { payload = await response.json(); }
  catch { return { status: 502, code: 'provider_response', error: 'Gemini returned unreadable JSON.' }; }

  const result = parseGeminiResponse(payload);
  if (!result.answer) {
    if (result.blockReason || result.finishReason === 'SAFETY') {
      return { status: 422, code: 'safety_blocked', error: 'Gemini could not answer this request because it was blocked by its safety checks.' };
    }
    return { status: 502, code: 'empty_response', error: 'Gemini returned no text answer.' };
  }
  return { status: 200, ...result };
}
