// Indeed Content Script: Extracts job data from Indeed job listings and viewjob pages
function extractIndeedJob() {
  const url = window.location.href;
  
  // Try several Indeed DOM variations for title
  let title = document.querySelector('h1[data-testid="jobsearch-JobInfoHeader-title"]')?.innerText?.trim()
    || document.querySelector('.jobsearch-JobInfoHeader-title')?.innerText?.trim()
    || document.querySelector('h2.jobTitle')?.innerText?.trim()
    || document.title.replace('- Indeed.com', '').trim();

  // Company Name
  let employer = document.querySelector('[data-testid="inlineHeader-companyName"]')?.innerText?.trim()
    || document.querySelector('.jobsearch-InlineCompanyRating-companyHeader')?.innerText?.trim()
    || document.querySelector('[data-testid="jobsearch-CompanyReview--heading"]')?.innerText?.trim()
    || "Unknown Employer";

  // Location
  let location = document.querySelector('[data-testid="inlineHeader-companyLocation"]')?.innerText?.trim()
    || document.querySelector('[data-testid="job-location"]')?.innerText?.trim()
    || "Remote / Unspecified";

  // Salary
  let salary = document.querySelector('#salaryInfoAndJobType')?.innerText?.trim()
    || document.querySelector('[data-testid="attribute_snippets_section"]')?.innerText?.trim()
    || null;

  // Description
  let description = document.querySelector('#jobDescriptionText')?.innerText?.trim()
    || document.querySelector('.jobsearch-jobDescriptionText')?.innerText?.trim()
    || "";

  // Extract external job id if available in query params (jk=...)
  const urlObj = new URL(url);
  const externalId = urlObj.searchParams.get("jk") || urlObj.searchParams.get("vjk") || "";

  return {
    title,
    employer,
    location,
    salary,
    description,
    url,
    externalId,
    source: "indeed-extension"
  };
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXTRACT_JOB") {
    const jobData = extractIndeedJob();
    sendResponse({ success: true, data: jobData });
  }
  return true;
});
