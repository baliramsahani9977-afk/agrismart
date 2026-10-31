// Public API base URL only. Leave empty for local development through server.mjs.
// After deploying, set this to the exact HTTPS Render service URL, for example:
// window.AGRI_SMART_API_BASE_URL = 'https://your-service.onrender.com';
window.AGRI_SMART_API_BASE_URL = window.AGRI_SMART_API_BASE_URL || '';

window.AgriSmartApi = Object.freeze({
  endpoint(path) {
    if (typeof path !== 'string' || !/^\/api\/[a-z0-9/-]+$/i.test(path)) {
      throw new TypeError('Invalid Agri Smart API path.');
    }

    const base = String(window.AGRI_SMART_API_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!base) {
      const hostname = window.location.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return path;
      const error = new Error('Set the deployed backend URL in api-config.js to connect the chatbot.');
      error.code = 'backend_url_missing';
      throw error;
    }

    let parsed;
    try { parsed = new URL(base); }
    catch {
      const error = new Error('The configured backend URL is invalid.');
      error.code = 'backend_url_invalid';
      throw error;
    }
    const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
      const error = new Error('The production backend URL must use HTTPS.');
      error.code = 'backend_url_invalid';
      throw error;
    }
    return `${parsed.origin}${path}`;
  }
});
