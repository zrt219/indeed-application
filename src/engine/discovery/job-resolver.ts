import { BrowserManager } from '../browser/browser';

export interface ResolvedJobMetadata {
  title: string;
  employer: string;
  location?: string;
  salary?: string;
  description?: string;
  url: string;
  source: 'json-ld' | 'html-meta' | 'dom-scrape' | 'fallback';
}

/**
 * Parses JSON-LD structured data from HTML if present
 */
function extractJsonLd(html: string): Partial<ResolvedJobMetadata> | null {
  try {
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (!jsonLdMatches) return null;

    for (const match of jsonLdMatches) {
      const contentMatch = match.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
      if (!contentMatch || !contentMatch[1]) continue;

      try {
        const parsed = JSON.parse(contentMatch[1].trim());
        const items = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of items) {
          if (item['@type'] === 'JobPosting' || item['@type']?.includes?.('JobPosting')) {
            const title = item.title || item.name;
            const employer = item.hiringOrganization?.name || item.hiringOrganization || item.employer;
            const location =
              item.jobLocation?.address?.addressLocality ||
              item.jobLocation?.address?.addressRegion ||
              (typeof item.jobLocation === 'string' ? item.jobLocation : undefined);
            const description = typeof item.description === 'string' ? item.description.replace(/<[^>]+>/g, ' ').trim() : undefined;
            const salary = item.baseSalary?.value?.value
              ? `$${item.baseSalary.value.value} ${item.baseSalary.currency || 'USD'}`
              : undefined;

            if (title) {
              return {
                title: String(title).trim(),
                employer: employer ? String(employer).trim() : undefined,
                location: location ? String(location).trim() : undefined,
                salary,
                description,
                source: 'json-ld',
              };
            }
          }
        }
      } catch {
        // Continue to next script
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Extracts title and employer from HTML meta tags or <title>
 */
function extractFromMeta(html: string): Partial<ResolvedJobMetadata> | null {
  try {
    // 1. OpenGraph title
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    const rawTitle = ogTitleMatch ? ogTitleMatch[1] : null;

    // 2. Fallback to <title>
    const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleTag = titleTagMatch ? titleTagMatch[1].trim() : null;

    const pageTitle = rawTitle || titleTag;
    if (!pageTitle) return null;

    // Indeed format is typically: "Job Title - City, State - Indeed.com" or "Job Title - Company - City, State | Indeed.com"
    const cleaned = pageTitle
      .replace(/\s*\|\s*Indeed\.com/gi, '')
      .replace(/\s*-\s*Indeed\.com/gi, '')
      .replace(/\s*Indeed\.com/gi, '')
      .trim();

    const parts = cleaned.split(/\s*[-–—]\s*/);
    let title = parts[0]?.trim() || '';
    let employer = parts.length > 1 ? parts[1]?.trim() : 'Unknown';
    let location: string | undefined = parts.length > 2 ? parts[2]?.trim() : undefined;

    // If title has "at Company"
    if (title.includes(' at ')) {
      const atParts = title.split(' at ');
      title = atParts[0].trim();
      employer = atParts[1].trim();
    }

    // Description from meta
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    const description = descMatch ? descMatch[1].trim() : undefined;

    const nonJobTitles = [
      'just a moment',
      'attention required',
      'ready to take the next step',
      'job search',
      'sign in',
      'log in',
      'indeed',
      'security check',
      'verify you are human',
      'page not found',
      '404',
    ];
    const isNonJob = nonJobTitles.some((bad) => title.toLowerCase().includes(bad));

    if (title && title.length > 2 && !isNonJob) {
      return {
        title,
        employer: employer && employer !== 'Indeed' ? employer : 'Unknown',
        location,
        description,
        source: 'html-meta',
      };
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Resolves real job title, employer, and description from any job URL.
 * Attempts fast HTTP fetch first (with JSON-LD & meta tag parsing),
 * then falls back to stealth Playwright page inspection if blocked.
 */
export async function resolveJobMetadata(
  url: string,
  existingFallback?: { title?: string; employer?: string; location?: string; description?: string }
): Promise<ResolvedJobMetadata> {
  const cleanUrl = url.trim();

  // 1. Fast HTTP fetch with browser headers
  try {
    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    });

    if (res.ok) {
      const html = await res.text();

      // Check for JSON-LD JobPosting first (highest accuracy)
      const jsonLd = extractJsonLd(html);
      if (jsonLd && jsonLd.title) {
        return {
          title: jsonLd.title,
          employer: jsonLd.employer || existingFallback?.employer || 'Unknown',
          location: jsonLd.location || existingFallback?.location,
          salary: jsonLd.salary,
          description: jsonLd.description || existingFallback?.description,
          url: cleanUrl,
          source: 'json-ld',
        };
      }

      // Check OpenGraph & <title> tags
      const meta = extractFromMeta(html);
      if (meta && meta.title) {
        return {
          title: meta.title,
          employer: meta.employer || existingFallback?.employer || 'Unknown',
          location: meta.location || existingFallback?.location,
          description: meta.description || existingFallback?.description,
          url: cleanUrl,
          source: 'html-meta',
        };
      }
    }
  } catch (err) {
    console.warn(`[JobResolver] Fast HTTP fetch failed for ${cleanUrl}, attempting browser scrape:`, err);
  }

  // 2. Playwright fallback if HTTP was challenged or lacked tags
  try {
    const bm = new BrowserManager({ headless: true });
    const page = await bm.newPage();

    try {
      await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1500);

      const pageContent = await page.content();
      const jsonLd = extractJsonLd(pageContent);
      if (jsonLd && jsonLd.title) {
        await page.close().catch(() => {});
        await bm.close().catch(() => {});
        return {
          title: jsonLd.title,
          employer: jsonLd.employer || existingFallback?.employer || 'Unknown',
          location: jsonLd.location || existingFallback?.location,
          salary: jsonLd.salary,
          description: jsonLd.description || existingFallback?.description,
          url: cleanUrl,
          source: 'json-ld',
        };
      }

      // Query DOM elements on Indeed
      const domTitle = await page.$eval(
        'h1.jobsearch-JobInfoHeader-title, [data-testid="jobsearch-JobInfoHeader-title"], h1',
        (el) => el.textContent?.trim() || ''
      ).catch(() => '');

      const domEmployer = await page.$eval(
        '[data-testid="inlineHeader-companyName"], [data-company-name], .companyName',
        (el) => el.textContent?.trim() || ''
      ).catch(() => '');

      const domLocation = await page.$eval(
        '[data-testid="inlineHeader-companyLocation"], [data-testid="job-location"]',
        (el) => el.textContent?.trim() || ''
      ).catch(() => '');

      const domDescription = await page.$eval(
        '#jobDescriptionText, [data-testid="jobDescriptionText"]',
        (el) => el.textContent?.trim() || ''
      ).catch(() => '');

      await page.close().catch(() => {});
      await bm.close().catch(() => {});

      if (domTitle && domTitle.length > 2) {
        return {
          title: domTitle,
          employer: domEmployer || existingFallback?.employer || 'Unknown',
          location: domLocation || existingFallback?.location,
          description: domDescription || existingFallback?.description,
          url: cleanUrl,
          source: 'dom-scrape',
        };
      }
    } catch {
      await page.close().catch(() => {});
      await bm.close().catch(() => {});
    }
  } catch {
    // Playwright failed
  }

  // 3. Fallback: Parse URL job key or use provided title
  let fallbackTitle = existingFallback?.title;
  if (!fallbackTitle || fallbackTitle === 'Unknown Position') {
    // Check URL parameters (e.g. ?q=, jk=)
    const urlObj = new URL(cleanUrl);
    const qParam = urlObj.searchParams.get('q');
    const jkParam = urlObj.searchParams.get('jk');
    if (qParam) {
      fallbackTitle = decodeURIComponent(qParam);
    } else if (jkParam) {
      fallbackTitle = `Indeed Position (${jkParam})`;
    } else {
      fallbackTitle = 'Software Engineer';
    }
  }

  return {
    title: fallbackTitle,
    employer: existingFallback?.employer || 'Unknown',
    location: existingFallback?.location,
    description: existingFallback?.description,
    url: cleanUrl,
    source: 'fallback',
  };
}
