let currentJob = null;

document.addEventListener("DOMContentLoaded", async () => {
  const statusBadge = document.getElementById("apiStatus");
  const endpointSelect = document.getElementById("endpointSelect");
  const queueBtn = document.getElementById("queueBtn");
  const trackAppliedBtn = document.getElementById("trackAppliedBtn");
  const statusSelect = document.getElementById("statusSelect");
  const updateStatusBtn = document.getElementById("updateStatusBtn");
  const dashboardBtn = document.getElementById("dashboardBtn");
  const feedbackMsg = document.getElementById("feedbackMsg");

  // Load saved endpoint preference
  chrome.storage.local.get(["targetEndpoint"], (res) => {
    if (res.targetEndpoint) {
      endpointSelect.value = res.targetEndpoint;
    }
    checkHealth();
  });

  endpointSelect.addEventListener("change", () => {
    chrome.storage.local.set({ targetEndpoint: endpointSelect.value });
    checkHealth();
  });

  function getApiBase() {
    return `${endpointSelect.value}/api`;
  }

  async function checkHealth() {
    statusBadge.textContent = "Checking...";
    statusBadge.className = "status-badge";
    try {
      const res = await fetch(`${getApiBase()}/jobs`, { method: "GET" });
      if (res.ok) {
        statusBadge.textContent = "Online";
        statusBadge.classList.add("online");
      } else {
        statusBadge.textContent = "Error";
      }
    } catch {
      statusBadge.textContent = "Offline";
    }
  }

  // Detect active tab Indeed details
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes("indeed.com")) {
    chrome.tabs.sendMessage(tab.id, { action: "EXTRACT_JOB" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.data) {
        document.getElementById("jobTitle").textContent = "Could not extract job on this tab.";
        return;
      }

      currentJob = response.data;
      document.getElementById("jobTitle").textContent = currentJob.title || "Indeed Position";
      document.getElementById("jobCompany").textContent = `🏢 ${currentJob.employer || "Unknown"}`;
      document.getElementById("jobLocation").textContent = `📍 ${currentJob.location || "Remote"}`;

      queueBtn.disabled = false;
      trackAppliedBtn.disabled = false;
      updateStatusBtn.disabled = false;
    });
  } else {
    document.getElementById("jobTitle").textContent = "Open an Indeed job listing to activate.";
  }

  function showMsg(text, isError = false) {
    feedbackMsg.textContent = text;
    feedbackMsg.className = isError ? "msg error" : "msg success";
  }

  // 1. Queue for Playwright Autonomous Apply
  queueBtn.addEventListener("click", async () => {
    if (!currentJob) return;
    queueBtn.disabled = true;
    showMsg("Adding to autonomous queue...");

    try {
      const res = await fetch(`${getApiBase()}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...currentJob,
          source: "PLAYWRIGHT_AUTONOMOUS"
        })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg("✓ Queued for Playwright!");
      } else {
        showMsg(data.error || "Failed to queue", true);
        queueBtn.disabled = false;
      }
    } catch (err) {
      showMsg("Network error connecting to API", true);
      queueBtn.disabled = false;
    }
  });

  // 2. Track as Manually Applied
  trackAppliedBtn.addEventListener("click", async () => {
    if (!currentJob) return;
    trackAppliedBtn.disabled = true;
    showMsg("Recording submission in ledger...");

    try {
      const res = await fetch(`${getApiBase()}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: currentJob.url,
          title: currentJob.title,
          employer: currentJob.employer,
          source: "CHROME_EXTENSION",
          status: "SUBMISSION_CONFIRMED",
          notes: "Applied directly via Indeed browser extension."
        })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg("✓ Recorded in Application Ledger!");
      } else {
        showMsg(data.error || "Failed to record", true);
        trackAppliedBtn.disabled = false;
      }
    } catch {
      showMsg("Network error connecting to API", true);
      trackAppliedBtn.disabled = false;
    }
  });

  // 3. Update Lifecycle Status
  updateStatusBtn.addEventListener("click", async () => {
    if (!currentJob) return;
    const newStatus = statusSelect.value;
    updateStatusBtn.disabled = true;
    showMsg(`Updating status to ${newStatus}...`);

    try {
      const res = await fetch(`${getApiBase()}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: currentJob.url,
          title: currentJob.title,
          employer: currentJob.employer,
          source: "CHROME_EXTENSION",
          status: newStatus,
          notes: `Status updated via Chrome Extension to ${newStatus}`
        })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg(`✓ Updated to ${newStatus}!`);
        updateStatusBtn.disabled = false;
      } else {
        showMsg(data.error || "Failed to update", true);
        updateStatusBtn.disabled = false;
      }
    } catch {
      showMsg("Network error connecting to API", true);
      updateStatusBtn.disabled = false;
    }
  });

  // 4. Dashboard button
  dashboardBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: endpointSelect.value });
  });
});
