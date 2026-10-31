(() => {
  const form = document.getElementById('chat-form');
  if (!form) return;

  const input = form.elements.message;
  const chatWindow = document.getElementById('chat-window');
  const feedback = document.getElementById('chat-feedback');
  const status = document.getElementById('chat-status');
  const language = document.getElementById('chat-language');
  const location = document.getElementById('chat-location');
  const newChatButton = document.getElementById('chat-new');
  let conversation = [];
  let sending = false;

  function addMessage(text, speaker, className, sources = []) {
    const bubble = document.createElement('div');
    bubble.className = `chat-message ${className}`;
    const label = document.createElement('span');
    label.className = 'chat-speaker';
    label.textContent = speaker;
    const content = document.createElement('p');
    content.textContent = text;
    bubble.append(label, content);

    if (sources.length) {
      const sourceHeading = document.createElement('span');
      sourceHeading.className = 'chat-source-heading';
      sourceHeading.textContent = 'Sources retrieved';
      const list = document.createElement('ul');
      list.className = 'chat-sources';
      sources.forEach((source) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = source.title || new URL(source.url).hostname;
        item.append(link);
        list.append(item);
      });
      bubble.append(sourceHeading, list);
    } else if (className === 'assistant-message') {
      const note = document.createElement('small');
      note.className = 'chat-no-sources';
      note.textContent = 'No supporting source link was returned for this answer; treat it as general AI-generated guidance.';
      bubble.append(note);
    }

    chatWindow.append(bubble);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return bubble;
  }

  function showFeedback(message, isError = false) {
    feedback.className = `form-feedback${isError ? ' error' : ''}`;
    feedback.textContent = message;
  }

  function updateInitialMessage(message) {
    const initialMessage = document.getElementById('chat-initial-message');
    if (initialMessage && chatWindow.children.length === 1) initialMessage.textContent = message;
  }

  function explainChatError(error) {
    if (error.code === 'quota_or_rate_limit') return 'Gemini quota or request limits were reached. Check the Gemini API project quota and billing, then try again later.';
    if (error.code === 'invalid_api_key') return 'Gemini rejected the API key. Check GEMINI_API_KEY in .env and restart the backend. The key itself is never shown here.';
    if (error.code === 'provider_access') return 'The Gemini API key or project does not have access to this request. Check the key and API project settings.';
    if (error.code === 'model_unavailable') return 'The configured Gemini model was not found or is unavailable. Check GEMINI_MODEL in .env.';
    if (error.code === 'safety_blocked') return 'Gemini could not answer this request because it was blocked by its safety checks. Try rephrasing it.';
    if (error.code === 'empty_response') return 'Gemini returned no text for this request. Try rephrasing the question.';
    if (error.code === 'provider_response') return 'Gemini returned an unexpected response format. Please try again.';
    if (error.code === 'backend_not_found') return 'The configured Agri Smart backend endpoint was not found. Check the backend URL in api-config.js and confirm the Render service is running.';
    if (error.code === 'backend_url_missing') return 'The chatbot backend URL is not configured for this website. After deploying the backend, add its HTTPS Render URL to api-config.js and publish the updated GitHub Pages site.';
    if (error.code === 'backend_url_invalid') return 'The configured chatbot backend URL is invalid. Use the HTTPS URL shown for your Render service.';
    if (error.code === 'network') return 'Could not reach the Agri Smart backend. Check the configured backend URL, Render service status, and allowed GitHub Pages origin.';
    if (error.status === 503) return 'The Gemini API is not configured yet. Add GEMINI_API_KEY to the local server .env file, then restart the server.';
    if (error.status === 429) return 'The service is busy or its usage limit was reached. Wait a moment and try again.';
    if (error.status === 504) return 'The research request took too long. Please try again with a shorter question.';
    if (error.status === 502) return 'The AI provider could not complete the request. Check the API key, model access, and billing, then try again.';
    return error.message || 'The assistant is temporarily unavailable. Please try again.';
  }

  async function checkConfiguration() {
    try {
      const response = await fetch(window.AgriSmartApi.endpoint('/api/status'));
      if (!response.ok) throw new Error('status');
      const data = await response.json();
      if (data.configured) {
        status.textContent = 'KEY CONFIGURED';
        status.className = 'status-pill status-local';
        updateInitialMessage('A server-side API key was found. Ask a question to check the live AI connection.');
        showFeedback('An API key was found on the server. It will be verified when a real request succeeds.');
      } else {
        status.textContent = 'API KEY REQUIRED';
        status.className = 'status-pill status-demo';
        updateInitialMessage('The backend is running, but GEMINI_API_KEY is not configured. Add it to .env and restart the backend.');
        showFeedback('The backend is running, but GEMINI_API_KEY is not configured. Add it to .env and restart the backend.', true);
      }
    } catch (error) {
      if (error.code === 'backend_url_missing' || error.code === 'backend_url_invalid') {
        status.textContent = error.code === 'backend_url_missing' ? 'BACKEND URL REQUIRED' : 'BACKEND URL INVALID';
        status.className = 'status-pill status-unavailable';
        updateInitialMessage(explainChatError(error));
        showFeedback(explainChatError(error), true);
        return;
      }
      status.textContent = 'BACKEND OFFLINE';
      status.className = 'status-pill status-unavailable';
      updateInitialMessage('Could not reach the Agri Smart backend. Check the configured backend URL and confirm the Render service is running. For local development, start it with npm start and open http://127.0.0.1:3000.');
      showFeedback('Could not reach the Agri Smart backend. Check the configured backend URL, Render service status, and allowed GitHub Pages origin. For local development, start it with npm start and open http://127.0.0.1:3000.', true);
    }
  }

  newChatButton.addEventListener('click', () => {
    conversation = [];
    chatWindow.replaceChildren();
    addMessage('New conversation started. What would you like help with on your farm?', 'AGRI SMART ASSISTANT', 'assistant-message');
    showFeedback('Conversation context is kept in this browser tab and sent to the AI service with your question.');
    input.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) {
      showFeedback('Type your farming question before sending.', true);
      input.focus();
      return;
    }
    if (sending) return;

    sending = true;
    input.disabled = true;
    form.querySelector('button[type="submit"]').disabled = true;
    newChatButton.disabled = true;
    addMessage(question, 'YOU', 'user-message');
    const pending = addMessage('Searching for agricultural information and preparing an answer…', 'AGRI SMART · WORKING', 'assistant-message chat-pending');
    showFeedback('Please wait while the assistant researches your question.');

    const nextConversation = [...conversation, { role: 'user', content: question }].slice(-8);
    try {
      const response = await fetch(window.AgriSmartApi.endpoint('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextConversation,
          location: location.value.trim(),
          language: language.value
        })
      });
      let data = {};
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || 'The chatbot backend did not return a valid JSON response.');
        error.status = response.status;
        error.code = data.code || (response.status === 404 && !contentType.includes('application/json') ? 'backend_not_found' : undefined);
        throw error;
      }
      if (!contentType.includes('application/json') || typeof data.answer !== 'string' || !data.answer.trim()) {
        const error = new Error('The chatbot endpoint did not return a valid answer.');
        error.status = response.status;
        error.code = 'invalid_response';
        throw error;
      }

      pending.remove();
      addMessage(data.answer, 'AGRI SMART ASSISTANT · AI-GENERATED', 'assistant-message', data.sources || []);
      status.textContent = 'AI RESPONDED';
      status.className = 'status-pill status-local';
      conversation = [...nextConversation, { role: 'assistant', content: data.answer }].slice(-8);
      showFeedback(data.sources?.length
        ? 'Answer generated by AI with the linked sources retrieved for this question. Verify local or safety-critical advice.'
        : 'The AI answered, but no source links were returned. Treat this as general guidance and verify important decisions locally.');
      form.reset();
      input.focus();
    } catch (error) {
      pending.remove();
      if (error instanceof TypeError && !error.status) error.code = 'network';
      const message = explainChatError(error);
      if (error.code === 'invalid_api_key') status.textContent = 'KEY REJECTED';
      else if (error.code === 'quota_or_rate_limit') status.textContent = 'QUOTA CHECK';
      else if (error.code === 'model_unavailable' || error.code === 'provider_access') status.textContent = 'MODEL ACCESS';
      else if (error.code === 'backend_not_found' || error.code === 'network') status.textContent = 'BACKEND OFFLINE';
      else if (error.code === 'backend_url_missing') status.textContent = 'BACKEND URL REQUIRED';
      else if (error.code === 'backend_url_invalid') status.textContent = 'BACKEND URL INVALID';
      if (['invalid_api_key', 'quota_or_rate_limit', 'model_unavailable', 'provider_access', 'backend_not_found', 'network', 'backend_url_missing', 'backend_url_invalid'].includes(error.code)) {
        status.className = 'status-pill status-unavailable';
      }
      addMessage(`I could not get an AI response. ${message}`, 'SERVICE MESSAGE · NO ANSWER GENERATED', 'assistant-message chat-error');
      showFeedback(message, true);
      input.focus();
    } finally {
      sending = false;
      input.disabled = false;
      form.querySelector('button[type="submit"]').disabled = false;
      newChatButton.disabled = false;
    }
  });

  checkConfiguration();
})();
