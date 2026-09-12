/**
 * Job Application Tracker — Service Worker (Background)
 * Handles badge updates, periodic stats polling, and message routing.
 */

// ── API Settings ──────────────────────────────────────────────────────

const DEFAULTS = {
  localUrl: 'http://localhost:3000',
  cloudUrl: 'https://job-application-agent-kohl.vercel.app',
};

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['localApiUrl', 'cloudApiUrl', 'apiKey'], (result) => {
      resolve({
        localUrl: result.localApiUrl || DEFAULTS.localUrl,
        cloudUrl: result.cloudApiUrl || DEFAULTS.cloudUrl,
        apiKey: result.apiKey || '',
      });
    });
  });
}

async function fetchStats() {
  const settings = await getSettings();
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

  // Try local
  try {
    const resp = await fetch(`${settings.localUrl}/api/stats`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) return await resp.json();
  } catch {}

  // Fall back to cloud
  try {
    const resp = await fetch(`${settings.cloudUrl}/api/stats`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) return await resp.json();
  } catch {}

  return null;
}

// ── Badge Updates ─────────────────────────────────────────────────────

async function updateBadge(count) {
  const text = count > 0 ? String(count) : '';
  const color = count > 0 ? '#fd7e14' : '#28a745';

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function refreshBadge() {
  const stats = await fetchStats();
  if (stats) {
    const pendingCount = (stats.queued || 0) + (stats.actionNeeded || 0);
    await updateBadge(pendingCount);
  }
}

// ── Alarms (periodic polling) ─────────────────────────────────────────

chrome.alarms.create('refreshStats', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshStats') {
    await refreshBadge();
  }
});

// ── Message Handling ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'UPDATE_BADGE') {
    updateBadge(message.count || 0);
    sendResponse({ ok: true });
  }
  return true;
});

// ── Install / Startup ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[JobTracker] Extension installed.');
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshBadge();
});
