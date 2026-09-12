/**
 * Job Application Tracker — Shared API Client
 * Tries local API first, falls back to Vercel cloud.
 */
const API_DEFAULTS = {
  localUrl: 'http://localhost:3000',
  cloudUrl: 'https://job-application-agent-kohl.vercel.app',
};

async function getSettings() {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['localApiUrl', 'cloudApiUrl', 'apiKey'], (result) => {
        resolve({
          localUrl: result.localApiUrl || API_DEFAULTS.localUrl,
          cloudUrl: result.cloudApiUrl || API_DEFAULTS.cloudUrl,
          apiKey: result.apiKey || '',
        });
      });
    } else {
      resolve({ ...API_DEFAULTS, apiKey: '' });
    }
  });
}

function buildHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Fetch with local-first, cloud-fallback strategy.
 * @param {string} path - API path (e.g. "/api/stats")
 * @param {object} options - fetch options (method, body, etc.)
 * @param {boolean} localOnly - if true, skip cloud fallback
 */
async function fetchApi(path, options = {}, localOnly = false) {
  const settings = await getSettings();
  const headers = buildHeaders(settings.apiKey);
  const fetchOptions = { ...options, headers: { ...headers, ...options.headers } };

  // Try local first
  try {
    const localResponse = await fetch(`${settings.localUrl}${path}`, {
      ...fetchOptions,
      signal: AbortSignal.timeout(3000),
    });
    if (localResponse.ok) {
      const data = await localResponse.json();
      return { data, source: 'local' };
    }
  } catch {
    // Local not available
  }

  if (localOnly) {
    throw new Error('Local API not available');
  }

  // Fall back to cloud
  try {
    const cloudResponse = await fetch(`${settings.cloudUrl}${path}`, {
      ...fetchOptions,
      signal: AbortSignal.timeout(10000),
    });
    if (!cloudResponse.ok) {
      const errBody = await cloudResponse.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${cloudResponse.status}`);
    }
    const data = await cloudResponse.json();
    return { data, source: 'cloud' };
  } catch (err) {
    throw new Error(`API request failed: ${err.message}`);
  }
}

// Convenience methods
async function apiGet(path) {
  return fetchApi(path, { method: 'GET' });
}

async function apiPost(path, body) {
  return fetchApi(path, { method: 'POST', body: JSON.stringify(body) });
}

async function apiPostLocal(path, body) {
  return fetchApi(path, { method: 'POST', body: JSON.stringify(body) }, true);
}

// Export for content scripts and popup (they share this via manifest)
if (typeof window !== 'undefined') {
  window.JobTrackerAPI = { fetchApi, apiGet, apiPost, apiPostLocal, getSettings };
}
