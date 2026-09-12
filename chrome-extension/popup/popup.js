/**
 * Job Application Tracker — Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  const api = window.JobTrackerAPI;

  // Elements
  const statusBadge = document.getElementById('connection-status');
  const statSubmitted = document.getElementById('stat-submitted');
  const statQueued = document.getElementById('stat-queued');
  const statAction = document.getElementById('stat-action');
  const statTotal = document.getElementById('stat-total');
  const btnApply = document.getElementById('btn-apply-current');
  const btnQueue = document.getElementById('btn-queue-current');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnDashboard = document.getElementById('btn-dashboard');
  const btnSettings = document.getElementById('btn-settings');
  const ledgerFeed = document.getElementById('ledger-feed');

  // Toast helper
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // Format relative time
  function timeAgo(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  // Load stats
  async function loadStats() {
    try {
      const { data, source } = await api.apiGet('/api/stats');
      statSubmitted.textContent = data.submitted ?? 0;
      statQueued.textContent = data.queued ?? 0;
      statAction.textContent = data.actionNeeded ?? 0;
      statTotal.textContent = data.totalJobs ?? 0;

      statusBadge.textContent = source === 'local' ? '🟢 Local' : '☁️ Cloud';
      statusBadge.className = `status-badge ${source === 'local' ? 'connected' : 'cloud'}`;

      // Update extension badge
      chrome.runtime.sendMessage({
        type: 'UPDATE_BADGE',
        count: (data.queued ?? 0) + (data.actionNeeded ?? 0),
      });
    } catch (err) {
      statusBadge.textContent = '🔴 Offline';
      statusBadge.className = 'status-badge error';
      showToast('Failed to connect to API', 'error');
    }
  }

  // Load ledger feed
  async function loadLedger() {
    try {
      const { data } = await api.apiGet('/api/ledger');
      const events = Array.isArray(data) ? data.slice(0, 20) : (data.events || []).slice(0, 20);

      if (events.length === 0) {
        ledgerFeed.innerHTML = '<p class="loading-text">No events yet</p>';
        return;
      }

      ledgerFeed.innerHTML = events.map((event) => {
        const type = event.type || event.eventType || 'UNKNOWN';
        const time = event.timestamp || event.createdAt || '';
        const meta = typeof event.metadata === 'string'
          ? JSON.parse(event.metadata)
          : event.metadata || {};
        const detail = meta.title || meta.reason || meta.status || '';

        return `
          <div class="ledger-item">
            <span class="event-type ${type}">${type}</span>
            <span class="event-time">${time ? timeAgo(time) : ''}</span>
            ${detail ? `<div class="event-detail">${detail}</div>` : ''}
          </div>
        `;
      }).join('');
    } catch {
      ledgerFeed.innerHTML = '<p class="loading-text">Failed to load events</p>';
    }
  }

  // Get current tab info for Indeed job pages
  async function getCurrentTabJob() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.url || !tab.url.includes('indeed.com')) {
          resolve(null);
          return;
        }
        // Request job info from content script
        chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB_INFO' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve(null);
          } else {
            resolve(response);
          }
        });
      });
    });
  }

  // Enable/disable action buttons based on current tab
  async function updateActionButtons() {
    const job = await getCurrentTabJob();
    if (job && job.url) {
      btnApply.disabled = false;
      btnQueue.disabled = false;
      btnApply.title = `Apply to: ${job.title || 'this job'}`;
      btnQueue.title = `Queue: ${job.title || 'this job'}`;
    } else {
      btnApply.disabled = true;
      btnQueue.disabled = true;
      btnApply.title = 'Navigate to an Indeed job page first';
      btnQueue.title = 'Navigate to an Indeed job page first';
    }
  }

  // Button handlers
  btnQueue.addEventListener('click', async () => {
    const job = await getCurrentTabJob();
    if (!job) return showToast('No job found on current page', 'error');

    btnQueue.disabled = true;
    btnQueue.textContent = '⏳ Queueing...';
    try {
      const { data } = await api.apiPost('/api/queue/add', {
        url: job.url,
        title: job.title,
        employer: job.employer,
        description: job.description,
      });
      if (data.isNew) {
        showToast(`Queued! Fit Score: ${data.qualification?.fitScore ?? '?'}`, 'success');
      } else {
        showToast('Job already in tracker', 'info');
      }
      await loadStats();
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    } finally {
      btnQueue.textContent = '➕ Queue Current Job';
      btnQueue.disabled = false;
    }
  });

  btnApply.addEventListener('click', async () => {
    const job = await getCurrentTabJob();
    if (!job) return showToast('No job found on current page', 'error');

    btnApply.disabled = true;
    btnApply.textContent = '⏳ Triggering...';
    try {
      // First queue the job if not already tracked
      const { data: queueData } = await api.apiPost('/api/queue/add', {
        url: job.url,
        title: job.title,
        employer: job.employer,
        description: job.description,
      });

      const jobId = queueData.job?.id;
      if (!jobId) throw new Error('Could not get job ID');

      // Trigger local apply (local-only)
      const { data } = await api.apiPostLocal('/api/apply/trigger', { jobId });
      showToast(data.message || 'Application triggered!', 'success');
      await loadStats();
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    } finally {
      btnApply.textContent = '🚀 Apply to Current Job';
      btnApply.disabled = false;
    }
  });

  btnRefresh.addEventListener('click', async () => {
    btnRefresh.textContent = '⏳ Refreshing...';
    await Promise.all([loadStats(), loadLedger()]);
    btnRefresh.textContent = '🔄 Refresh Stats';
    showToast('Refreshed!', 'success');
  });

  btnDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.storage.local.get(['cloudApiUrl'], (result) => {
      const url = result.cloudApiUrl || 'https://job-application-agent-kohl.vercel.app';
      chrome.tabs.create({ url });
    });
  });

  btnSettings.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Initial load
  await Promise.all([loadStats(), loadLedger(), updateActionButtons()]);
});
