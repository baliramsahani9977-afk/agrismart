# Agri Smart farming assistant setup

The homepage chat uses Google's Gemini API through the local Node server. Browser code posts questions to `/api/chat`; `server.mjs` reads `GEMINI_API_KEY` from `.env`, calls the Gemini `generateContent` REST endpoint, extracts text from `candidates[].content.parts[].text`, and returns a consistent `{ answer, sources }` JSON object. The browser never receives the key.

The configured default model is `gemini-3.8-flash`. The request enables Gemini Google Search grounding and shows source links returned in `groundingMetadata`. The assistant prompt prioritizes ICAR, TNAU, FAO, and government sources, but Gemini's built-in Google Search grounding does not enforce a domain allowlist; sources can include other sites. This is live retrieval, not a downloaded agricultural reference database.

## Requirements and configuration

- Node.js 20 or newer.
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
- API billing or free-tier availability depends on your Google AI project, model, region, and usage. Check current [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) and quota before testing.

On Windows, in the project folder:

1. If `.env` does not exist, copy `.env.example` and name the copy `.env`.
2. Open `.env` and paste your key after `GEMINI_API_KEY=`. Keep the key private; never place it in HTML or browser JavaScript.
3. Keep `GEMINI_MODEL=gemini-3.8-flash` and `PORT=3000`, unless you intentionally select another model your API project supports.
4. Open a terminal in this folder and run `npm.cmd start` (or `npm start`). Leave that terminal running.
5. Open `http://127.0.0.1:3000`. Live Server alone cannot serve the API route.

Without a Gemini key, the rest of the site still loads and the chat reports that configuration is missing. It never returns a scripted answer.

## Tests and manual check

Run `npm.cmd run test:chat`. The provider tests use mocked Gemini HTTP responses and do not make paid calls. For a live check, with your key saved and server restarted, confirm the chat status says `KEY CONFIGURED`, ask a new question, then ask a follow-up. A successful response changes the status to `AI RESPONDED`. Use **Start new chat** to clear in-tab conversation history.

The last eight turns stay in the current browser tab and are sent to Gemini for context. There is no farm account or persistent chat database. The local server applies a limit of 10 chat requests per minute per client.

## Boundaries

- The model is not trained specifically for agriculture and the assistant is not scientifically validated.
- Google Search grounding can return general web sources; the prompt prioritizes credible sources but the Gemini tool request does not strictly filter domains.
- The assistant does not automatically receive weather, crop-screening, or calendar data from other Agri Smart tools.
- No disease-image diagnosis, fertilizer-rate calculator, market-price feed, or persistent chat history is provided here.
- The local server binds to `127.0.0.1`. Do not expose it publicly without production authentication, abuse protection, and secret management.
