/**
 * Job Application Tracker — Content Script
 * Runs on Indeed job pages. Adds Fit Score badge and Queue button.
 */

(async function () {
  'use strict';

  // Prevent double injection
  if (document.getElementById('jat-injected')) return;
  const marker = document.createElement('div');
  marker.id = 'jat-injected';
  marker.style.display = 'none';
  document.body.appendChild(marker);

  const api = window.JobTrackerAPI;

  // ── Job Page Detection ──────────────────────────────────────────────

  function isJobViewPage() {
    return window.location.pathname.includes('/viewjob') || window.location.pathname.includes('/rc/');
  }

  function isSearchPage() {
    return window.location.pathname.includes('/jobs');
  }

  // ── Extract Job Info from DOM ───────────────────────────────────────

  function extractJobInfo() {
    const title =
      document.querySelector('h1.jobsearch-JobInfoHeader-title')?.textContent?.trim() ||
      document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]')?.textContent?.trim() ||
      document.querySelector('h1')?.textContent?.trim() ||
      '';

    const employer =
      document.querySelector('[data-testid="inlineHeader-companyName"]')?.textContent?.trim() ||
      document.querySelector('[data-company-name]')?.textContent?.trim() ||
      document.querySelector('.jobsearch-InlineCompanyRating-companyHeader')?.textContent?.trim() ||
      '';

    const location =
      document.querySelector('[data-testid="inlineHeader-companyLocation"]')?.textContent?.trim() ||
      document.querySelector('[data-testid="job-location"]')?.textContent?.trim() ||
      '';

    const descriptionEl =
      document.querySelector('#jobDescriptionText') ||
      document.querySelector('[data-testid="jobDescriptionText"]') ||
      document.querySelector('.jobsearch-jobDescriptionText');
    const description = descriptionEl?.textContent?.trim()?.substring(0, 2000) || '';

    const url = window.location.href.split('#')[0].split('&from=')[0];

    return { title, employer, location, description, url };
  }

  // ── Respond to popup messages ───────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_JOB_INFO') {
      const info = extractJobInfo();
      sendResponse(info);
    }
    return true; // async response
  });

  // ── Fit Score Badge (Job View Page) ─────────────────────────────────

  async function injectFitScoreBadge() {
    if (!isJobViewPage()) return;

    const job = extractJobInfo();
    if (!job.title && !job.description) return;

    // Wait for the header to exist
    const headerEl =
      document.querySelector('h1.jobsearch-JobInfoHeader-title') ||
      document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
      document.querySelector('h1');
    if (!headerEl) return;

    // Don't re-inject
    if (document.getElementById('jat-fit-badge')) return;

    try {
      const { data } = await api.apiPost('/api/score', {
        title: job.title,
        employer: job.employer,
        location: job.location,
        description: job.description,
      });

      const score = data.fitScore ?? 0;
      const color =
        data.isExcluded ? '#dc3545' :
        score >= 70 ? '#28a745' :
        score >= 50 ? '#fd7e14' :
        '#6c757d';

      const badge = document.createElement('div');
      badge.id = 'jat-fit-badge';
      badge.innerHTML = `
        <span class="jat-score" style="color: ${color}">${score}</span>
        <span class="jat-label">Fit Score</span>
        ${data.isExcluded ? '<span class="jat-excluded">EXCLUDED</span>' : ''}
        <span class="jat-skills">${(data.matchedSkills || []).slice(0, 5).join(', ')}</span>
      `;
      headerEl.parentElement.insertBefore(badge, headerEl.nextSibling);

      // Add Queue button next to the badge
      const queueBtn = document.createElement('button');
      queueBtn.id = 'jat-queue-btn';
      queueBtn.textContent = '➕ Queue This Job';
      queueBtn.addEventListener('click', async () => {
        queueBtn.textContent = '⏳ Queueing...';
        queueBtn.disabled = true;
        try {
          const { data: qData } = await api.apiPost('/api/queue/add', {
            url: job.url,
            title: job.title,
            employer: job.employer,
            description: job.description,
          });
          if (qData.isNew) {
            queueBtn.textContent = `✅ Queued (Score: ${qData.qualification?.fitScore ?? score})`;
            queueBtn.classList.add('jat-queued');
          } else {
            queueBtn.textContent = '✅ Already Tracked';
            queueBtn.classList.add('jat-queued');
          }
        } catch (err) {
          queueBtn.textContent = '❌ Failed';
          setTimeout(() => {
            queueBtn.textContent = '➕ Queue This Job';
            queueBtn.disabled = false;
          }, 2000);
        }
      });
      badge.appendChild(queueBtn);
    } catch {
      // API not available — skip badge
    }
  }

  // ── Search Results Badges ───────────────────────────────────────────

  async function injectSearchBadges() {
    if (!isSearchPage()) return;

    const jobCards = document.querySelectorAll('.job_seen_beacon, [data-jk]');
    for (const card of jobCards) {
      if (card.querySelector('.jat-mini-badge')) continue;

      const titleEl = card.querySelector('h2.jobTitle a, h2.jobTitle span, a[data-jk]');
      const title = titleEl?.textContent?.trim() || '';
      if (!title || title.length < 3) continue;

      const employerEl = card.querySelector('[data-testid="company-name"], .companyName');
      const employer = employerEl?.textContent?.trim() || '';
      const snippetEl = card.querySelector('.job-snippet, [data-testid="job-snippet"]');
      const description = snippetEl?.textContent?.trim() || '';

      try {
        const { data } = await api.apiPost('/api/score', {
          title,
          employer,
          description,
        });

        const score = data.fitScore ?? 0;
        const color =
          data.isExcluded ? '#dc3545' :
          score >= 70 ? '#28a745' :
          score >= 50 ? '#fd7e14' :
          '#6c757d';

        const miniBadge = document.createElement('span');
        miniBadge.className = 'jat-mini-badge';
        miniBadge.style.cssText = `
          background: ${color};
          color: white;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 700;
          margin-left: 8px;
          display: inline-block;
        `;
        miniBadge.textContent = data.isExcluded ? '✕' : `${score}%`;
        miniBadge.title = data.isExcluded
          ? `Excluded: ${data.exclusionReasons?.join(', ')}`
          : `Fit Score: ${score}% — ${(data.matchedSkills || []).join(', ')}`;

        if (titleEl) titleEl.appendChild(miniBadge);
      } catch {
        // Skip on API failure
      }
    }
  }

  // ── Initialize ──────────────────────────────────────────────────────

  // Run after page settles
  setTimeout(async () => {
    await injectFitScoreBadge();
    await injectSearchBadges();
  }, 2000);

  // Re-run on SPA navigation (Indeed uses dynamic loading)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(async () => {
        await injectFitScoreBadge();
        await injectSearchBadges();
      }, 2000);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
