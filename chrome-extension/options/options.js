/**
 * Job Application Tracker — Options Page Script
 */

document.addEventListener('DOMContentLoaded', () => {
  const localUrlInput = document.getElementById('local-url');
  const cloudUrlInput = document.getElementById('cloud-url');
  const apiKeyInput = document.getElementById('api-key');
  const btnSave = document.getElementById('btn-save');
  const btnTest = document.getElementById('btn-test');
  const statusMsg = document.getElementById('status-msg');

  // Load saved settings
  chrome.storage.local.get(['localApiUrl', 'cloudApiUrl', 'apiKey'], (result) => {
    localUrlInput.value = result.localApiUrl || 'http://localhost:3000';
    cloudUrlInput.value = result.cloudApiUrl || 'https://job-application-agent-kohl.vercel.app';
    apiKeyInput.value = result.apiKey || '';
  });

  function showStatus(message, type = 'info') {
    statusMsg.textContent = message;
    statusMsg.className = `status-msg ${type}`;
    setTimeout(() => {
      statusMsg.className = 'status-msg';
    }, 5000);
  }

  // Save
  btnSave.addEventListener('click', () => {
    const settings = {
      localApiUrl: localUrlInput.value.replace(/\/$/, '') || 'http://localhost:3000',
      cloudApiUrl: cloudUrlInput.value.replace(/\/$/, '') || 'https://job-application-agent-kohl.vercel.app',
      apiKey: apiKeyInput.value.trim(),
    };

    chrome.storage.local.set(settings, () => {
      showStatus('✅ Settings saved successfully!', 'success');
    });
  });

  // Test Connection
  btnTest.addEventListener('click', async () => {
    btnTest.textContent = '⏳ Testing...';
    btnTest.disabled = true;

    const headers = { 'Content-Type': 'application/json' };
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    let localOk = false;
    let cloudOk = false;

    // Test local
    try {
      const localUrl = localUrlInput.value.replace(/\/$/, '') || 'http://localhost:3000';
      const resp = await fetch(`${localUrl}/api/stats`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      localOk = resp.ok;
    } catch {}

    // Test cloud
    try {
      const cloudUrl = cloudUrlInput.value.replace(/\/$/, '') || 'https://job-application-agent-kohl.vercel.app';
      const resp = await fetch(`${cloudUrl}/api/stats`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      cloudOk = resp.ok;
    } catch {}

    btnTest.textContent = 'Test Connection';
    btnTest.disabled = false;

    if (localOk && cloudOk) {
      showStatus('✅ Both local and cloud APIs are reachable!', 'success');
    } else if (cloudOk) {
      showStatus('☁️ Cloud API reachable. Local API not available (start your dev server for one-click apply).', 'info');
    } else if (localOk) {
      showStatus('🟢 Local API reachable. Cloud API not responding.', 'info');
    } else {
      showStatus('❌ Neither API is reachable. Check your URLs and API key.', 'error');
    }
  });
});
