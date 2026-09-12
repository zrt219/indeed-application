// Service Worker Background Script for Indeed Application Assistant
chrome.runtime.onInstalled.addListener(() => {
  console.log("Indeed Job Application Assistant Extension Installed.");
});

// Proxy API requests if necessary to bypass CORS or manage auth
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "QUEUE_JOB") {
    fetch("http://localhost:3000/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.job)
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
});
