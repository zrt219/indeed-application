let currentJob = null;
const API_BASE = "http://localhost:3000/api";

document.addEventListener("DOMContentLoaded", async () => {
  const statusBadge = document.getElementById("apiStatus");
  const queueBtn = document.getElementById("queueBtn");
  const dashboardBtn = document.getElementById("dashboardBtn");
  const feedbackMsg = document.getElementById("feedbackMsg");

  // 1. Check local Next.js API status
  try {
    const res = await fetch(`${API_BASE}/jobs`, { method: "GET" });
    if (res.ok) {
      statusBadge.textContent = "API Connected";
      statusBadge.classList.add("online");
    } else {
      statusBadge.textContent = "API Error";
    }
  } catch (err) {
    statusBadge.textContent = "API Offline (Start Next.js)";
  }

  // 2. Query active tab and request extraction
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes("indeed.com")) {
    chrome.tabs.sendMessage(tab.id, { action: "EXTRACT_JOB" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.data) {
        document.getElementById("jobTitle").textContent = "Could not extract job from this page.";
        return;
      }

      currentJob = response.data;
      document.getElementById("jobTitle").textContent = currentJob.title || "Job Title Found";
      document.getElementById("jobCompany").textContent = `🏢 ${currentJob.employer || "Unknown"}`;
      document.getElementById("jobLocation").textContent = `📍 ${currentJob.location || "Location unknown"}`;
      
      if (currentJob.salary) {
        const salEl = document.getElementById("jobSalary");
        salEl.textContent = currentJob.salary;
        salEl.style.display = "inline-block";
      }

      queueBtn.disabled = false;
    });
  } else {
    document.getElementById("jobTitle").textContent = "Navigate to an Indeed job listing to import.";
  }

  // 3. Queue Button Handler
  queueBtn.addEventListener("click", async () => {
    if (!currentJob) return;
    queueBtn.disabled = true;
    feedbackMsg.textContent = "Sending to application queue...";
    feedbackMsg.className = "msg";

    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentJob)
      });
      const data = await res.json();
      if (res.ok) {
        feedbackMsg.textContent = "✓ Added to Agent Queue!";
        feedbackMsg.className = "msg success";
      } else {
        feedbackMsg.textContent = data.error || "Failed to queue job.";
        feedbackMsg.className = "msg error";
        queueBtn.disabled = false;
      }
    } catch (err) {
      feedbackMsg.textContent = "Error connecting to local server.";
      feedbackMsg.className = "msg error";
      queueBtn.disabled = false;
    }
  });

  // 4. Open Dashboard Handler
  dashboardBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "http://localhost:3000" });
  });
});
