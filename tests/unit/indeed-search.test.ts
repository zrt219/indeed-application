import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  IndeedSearchCrawler,
  CURATED_TECH_JOBS,
} from '../../src/engine/discovery/indeed-search';
import { BrowserManager } from '../../src/engine/browser/browser';
import { prisma } from '../../src/db/prisma';
import { calculateFitScore, loadDefaultProfile } from '../../src/qualification/engine';

describe('Indeed Job Discovery & Qualification Engine (M1)', () => {
  let browserManager: BrowserManager;

  const mockJobsHtml = `
    <!DOCTYPE html>
    <html>
      <body>
        <div class="job_seen_beacon" data-jk="test_m1_card1">
          <h2 class="jobTitle"><a data-jk="test_m1_card1">Senior Full Stack Engineer - TypeScript & React</a></h2>
          <span data-testid="company-name">Apex Test Systems</span>
          <div data-testid="text-location">Austin, TX (Remote)</div>
          <div data-testid="attribute_snippet_testid">$145,000 - $175,000 a year</div>
          <div class="job-snippet">Building cloud applications with TypeScript, React, Next.js, and Node.js.</div>
        </div>
        <div class="job_seen_beacon" data-jk="test_m1_card2">
          <h2 class="jobTitle">Staff Software Engineer</h2>
          <div class="companyName">CloudCore Data</div>
          <div class="companyLocation">Remote</div>
          <div class="salary-snippet-container">$160,000 - $190,000 a year</div>
          <div data-testid="job-snippet">High throughput distributed systems with TypeScript and PostgreSQL.</div>
        </div>
        <div class="job_seen_beacon" data-jk="test_m1_card3">
          <h2 class="jobTitle">Software Developer</h2>
          <div class="job-snippet">General web development tasks.</div>
        </div>
        <div class="job_seen_beacon" data-jk="test_m1_excluded">
          <h2 class="jobTitle">Full Stack Engineer - Defense Platforms</h2>
          <div class="companyName">AeroDefense Corp</div>
          <div class="companyLocation">Austin, TX</div>
          <div class="job-snippet">Must possess active Top Secret clearance TS/SCI required for federal contract.</div>
        </div>
        <div class="job_seen_beacon" data-jk="test_m1_empty">
          <h2 class="jobTitle"></h2>
          <div class="companyName">Bad Card Co</div>
        </div>
      </body>
    </html>
  `;

  const mockChallengeHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Just a moment...</title></head>
      <body>
        <h1>Attention Required! | Cloudflare</h1>
        <p>Please complete the security check to access indeed.com. Verify you are human challenge.</p>
      </body>
    </html>
  `;

  beforeAll(async () => {
    browserManager = new BrowserManager({ headless: true });
    const context = await browserManager.launch();

    await context.route('https://www.indeed.com/**', async (route) => {
      const url = route.request().url();
      if (url.includes('challenge-test')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: mockChallengeHtml,
        });
      } else if (url.includes('error-test')) {
        await route.abort('failed');
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: mockJobsHtml,
        });
      }
    });
  }, 20000);

  afterAll(async () => {
    // Clean up test records created during testing
    await prisma.eventLedger.deleteMany({ where: { job: { url: { contains: 'test_m1_' } } } });
    await prisma.outboxEvent.deleteMany({ where: { payload: { contains: 'test_m1_' } } });
    await prisma.job.deleteMany({ where: { url: { contains: 'test_m1_' } } });
    await browserManager.close();
  }, 20000);

  beforeEach(async () => {
    // Retry cleanup to handle SQLite WAL contention under sequential execution
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await prisma.eventLedger.deleteMany({ where: { job: { url: { contains: 'test_m1_' } } } });
        await prisma.outboxEvent.deleteMany({ where: { payload: { contains: 'test_m1_' } } });
        await prisma.job.deleteMany({ where: { url: { contains: 'test_m1_' } } });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }, 15000);

  describe('1. Curated Tech Jobs Export & Integrity', () => {
    it('should export CURATED_TECH_JOBS containing at least 30 valid positions', () => {
      expect(CURATED_TECH_JOBS).toBeDefined();
      expect(Array.isArray(CURATED_TECH_JOBS)).toBe(true);
      expect(CURATED_TECH_JOBS.length).toBeGreaterThanOrEqual(30);
    });

    it('should have complete metadata and canonical Indeed URLs for every curated position', () => {
      for (const job of CURATED_TECH_JOBS) {
        expect(job.title).toBeTruthy();
        expect(job.employer).toBeTruthy();
        expect(job.location).toBeTruthy();
        expect(job.description).toBeTruthy();
        expect(job.url).toMatch(/^https:\/\/www\.indeed\.com\/viewjob\?jk=ind_[a-z0-9_]+$/);
      }
    });

    it('should qualify at least 30 curated jobs against the candidate profile (fitScore >= 50)', () => {
      const profile = loadDefaultProfile();
      let qualifiedCount = 0;

      for (const job of CURATED_TECH_JOBS) {
        const result = calculateFitScore(job, profile);
        if (result.fitScore >= 50 && !result.isExcluded) {
          qualifiedCount++;
        }
      }

      expect(qualifiedCount).toBeGreaterThanOrEqual(30);
    });
  });

  describe('2. Metadata Extraction & Canonicalization (scrapeIndeedLive)', () => {
    it('should extract title, employer, location, salary, description, and canonical URL from job cards', async () => {
      const crawler = new IndeedSearchCrawler(browserManager);
      const cards = await crawler.scrapeIndeedLive('TypeScript', 'Remote', 0);

      expect(cards.length).toBe(4); // 4 valid cards (empty title card skipped)

      const card1 = cards.find((c) => c.jobKey === 'test_m1_card1');
      expect(card1).toBeDefined();
      expect(card1?.title).toBe('Senior Full Stack Engineer - TypeScript & React');
      expect(card1?.employer).toBe('Apex Test Systems');
      expect(card1?.location).toBe('Austin, TX (Remote)');
      expect(card1?.salary).toBe('$145,000 - $175,000 a year');
      expect(card1?.description).toContain('TypeScript, React, Next.js, and Node.js');
      expect(card1?.url).toBe('https://www.indeed.com/viewjob?jk=test_m1_card1');

      const card2 = cards.find((c) => c.jobKey === 'test_m1_card2');
      expect(card2).toBeDefined();
      expect(card2?.title).toBe('Staff Software Engineer');
      expect(card2?.employer).toBe('CloudCore Data');
      expect(card2?.salary).toBe('$160,000 - $190,000 a year');
      expect(card2?.url).toBe('https://www.indeed.com/viewjob?jk=test_m1_card2');
    }, 20000);

    it('should apply graceful fallbacks for missing employer, location, and salary', async () => {
      const crawler = new IndeedSearchCrawler(browserManager);
      const cards = await crawler.scrapeIndeedLive('Full Stack', 'Remote', 0);

      const card3 = cards.find((c) => c.jobKey === 'test_m1_card3');
      expect(card3).toBeDefined();
      expect(card3?.title).toBe('Software Developer');
      expect(card3?.employer).toBe('Unknown');
      expect(card3?.location).toBe('Remote');
      expect(card3?.salary).toBeUndefined();
      expect(card3?.url).toBe('https://www.indeed.com/viewjob?jk=test_m1_card3');
    }, 20000);

    it('should skip malformed job cards with missing or too short titles', async () => {
      const crawler = new IndeedSearchCrawler(browserManager);
      const cards = await crawler.scrapeIndeedLive('Full Stack', 'Remote', 0);

      const emptyCard = cards.find((c) => c.jobKey === 'test_m1_empty');
      expect(emptyCard).toBeUndefined();
    }, 20000);
  });

  describe('3. Anti-Bot Challenge Handling', () => {
    it('should detect bot challenge text and cleanly return empty array', async () => {
      const crawler = new IndeedSearchCrawler(browserManager);
      const cards = await crawler.scrapeIndeedLive('challenge-test', 'Remote', 0);

      expect(cards).toEqual([]);
    }, 20000);

    it('should catch network errors gracefully and return empty array', async () => {
      const crawler = new IndeedSearchCrawler(browserManager);
      const cards = await crawler.scrapeIndeedLive('error-test', 'Remote', 0);

      expect(cards).toEqual([]);
    }, 20000);
  });

  describe('4. Deterministic Scoring & Auto-Ingestion Filtering (discoverAndQueue)', () => {
    it('should ingest qualifying jobs into QUEUED state and non-qualifying jobs into DISCOVERED state', async () => {
      const crawler = new IndeedSearchCrawler(browserManager);
      const result = await crawler.discoverAndQueue({
        queries: ['Full Stack Engineer'],
        location: 'Remote',
        targetCount: 4,
        minFitScore: 50,
        useSyntheticFallbackIfBlocked: false,
      });

      expect(result.discoveredCount).toBe(4);
      expect(result.queuedCount).toBeGreaterThanOrEqual(2);

      // Verify Card 1 (Qualified) in SQLite
      const qualifiedJob = await prisma.job.findUnique({
        where: { url: 'https://www.indeed.com/viewjob?jk=test_m1_card1' },
      });
      expect(qualifiedJob).not.toBeNull();
      expect(qualifiedJob?.status).toBe('QUEUED');
      expect(qualifiedJob?.fitScore).toBeGreaterThanOrEqual(50);
      expect(qualifiedJob?.source).toBe('PLAYWRIGHT_AUTONOMOUS');

      // Verify Excluded Card in SQLite
      const excludedJob = await prisma.job.findUnique({
        where: { url: 'https://www.indeed.com/viewjob?jk=test_m1_excluded' },
      });
      expect(excludedJob).not.toBeNull();
      expect(excludedJob?.status).toBe('DISCOVERED');
      expect(excludedJob?.fitScore).toBe(0);
      expect(excludedJob?.source).toBe('PLAYWRIGHT_AUTONOMOUS');
    }, 20000);

    it('should atomically emit DISCOVERED and QUEUED events with source PLAYWRIGHT_AUTONOMOUS', async () => {
      const crawler = new IndeedSearchCrawler(browserManager);
      await crawler.discoverAndQueue({
        queries: ['Full Stack Engineer'],
        location: 'Remote',
        targetCount: 4,
        minFitScore: 50,
        useSyntheticFallbackIfBlocked: false,
      });

      const qualifiedJob = await prisma.job.findUnique({
        where: { url: 'https://www.indeed.com/viewjob?jk=test_m1_card1' },
      });
      expect(qualifiedJob).not.toBeNull();

      // Check EventLedger entries
      const ledgerEvents = await prisma.eventLedger.findMany({
        where: { jobId: qualifiedJob!.id },
        orderBy: { timestamp: 'asc' },
      });
      const ledgerTypes = ledgerEvents.map((e) => e.type);
      expect(ledgerTypes).toContain('DISCOVERED');
      expect(ledgerTypes).toContain('QUEUED');

      // Check OutboxEvent entries
      const outboxEvents = await prisma.outboxEvent.findMany({
        where: { payload: { contains: qualifiedJob!.id } },
      });
      const outboxTypes = outboxEvents.map((e) => e.eventType);
      expect(outboxTypes).toContain('DISCOVERED');
      expect(outboxTypes).toContain('QUEUED');

      // Check atomic pairing (same ID, source, un-synced status)
      for (const ledgerEntry of ledgerEvents) {
        const matchingOutbox = outboxEvents.find((o) => o.id === ledgerEntry.id);
        expect(matchingOutbox).toBeDefined();
        expect(matchingOutbox?.source).toBe('PLAYWRIGHT_AUTONOMOUS');
        expect(matchingOutbox?.syncedAt).toBeNull();
        expect(matchingOutbox?.syncAttempts).toBe(0);
      }

      // Check Excluded Card events (only DISCOVERED, never QUEUED)
      const excludedJob = await prisma.job.findUnique({
        where: { url: 'https://www.indeed.com/viewjob?jk=test_m1_excluded' },
      });
      expect(excludedJob).not.toBeNull();

      const excludedLedgerEvents = await prisma.eventLedger.findMany({
        where: { jobId: excludedJob!.id },
      });
      const excludedTypes = excludedLedgerEvents.map((e) => e.type);
      expect(excludedTypes).toContain('DISCOVERED');
      expect(excludedTypes).not.toContain('QUEUED');
    }, 20000);
  });

  describe('5. Idempotent Deduplication', () => {
    it('should strictly prevent duplicate insertions on identical job URLs', async () => {
      const crawler = new IndeedSearchCrawler(browserManager);

      // Run discovery once
      const firstRun = await crawler.discoverAndQueue({
        queries: ['Full Stack Engineer'],
        location: 'Remote',
        targetCount: 4,
        minFitScore: 50,
        useSyntheticFallbackIfBlocked: false,
      });
      expect(firstRun.discoveredCount).toBe(4);

      const jobCountAfterFirst = await prisma.job.count({
        where: { url: { contains: 'test_m1_' } },
      });
      expect(jobCountAfterFirst).toBe(4);

      const ledgerCountAfterFirst = await prisma.eventLedger.count({
        where: { job: { url: { contains: 'test_m1_' } } },
      });
      const outboxCountAfterFirst = await prisma.outboxEvent.count({
        where: { payload: { contains: 'test_m1_' } },
      });

      // Run discovery second time with the exact same jobs
      const secondRun = await crawler.discoverAndQueue({
        queries: ['Full Stack Engineer'],
        location: 'Remote',
        targetCount: 4,
        minFitScore: 50,
        useSyntheticFallbackIfBlocked: false,
      });
      expect(secondRun.discoveredCount).toBe(4);

      // Assert zero duplicate job rows were created in SQLite
      const jobCountAfterSecond = await prisma.job.count({
        where: { url: { contains: 'test_m1_' } },
      });
      expect(jobCountAfterSecond).toBe(4);

      // Assert zero duplicate lifecycle events were emitted
      const ledgerCountAfterSecond = await prisma.eventLedger.count({
        where: { job: { url: { contains: 'test_m1_' } } },
      });
      const outboxCountAfterSecond = await prisma.outboxEvent.count({
        where: { payload: { contains: 'test_m1_' } },
      });

      expect(ledgerCountAfterSecond).toBe(ledgerCountAfterFirst);
      expect(outboxCountAfterSecond).toBe(outboxCountAfterFirst);

      // Verify each individual test URL occurs exactly once
      for (const key of ['test_m1_card1', 'test_m1_card2', 'test_m1_card3', 'test_m1_excluded']) {
        const matches = await prisma.job.findMany({
          where: { url: `https://www.indeed.com/viewjob?jk=${key}` },
        });
        expect(matches.length).toBe(1);
      }
    }, 25000);
  });

  describe('6. Fallback Behavior & Target Ingestion Guarantee', () => {
    it('should seamlessly activate CURATED_TECH_JOBS fallback when live search is blocked', async () => {
      const crawler = new IndeedSearchCrawler(browserManager);
      const result = await crawler.discoverAndQueue({
        queries: ['challenge-test'],
        location: 'Remote',
        targetCount: 10,
        minFitScore: 50,
        useSyntheticFallbackIfBlocked: true,
      });

      expect(result.discoveredCount).toBe(10);
      expect(result.jobs.length).toBe(10);
      expect(result.queuedCount + result.skippedCount).toBe(10);

      // Verify all jobs returned have valid attributes
      for (const job of result.jobs) {
        expect(job.id).toBeTruthy();
        expect(job.title).toBeTruthy();
        expect(job.employer).toBeTruthy();
        expect(job.fitScore).toBeGreaterThanOrEqual(0);
        expect(['QUEUED', 'DISCOVERED', 'SUBMITTED', 'SUBMISSION_FAILED']).toContain(job.status);
      }
    }, 20000);

    it('should not activate fallback when useSyntheticFallbackIfBlocked is false', async () => {
      const crawler = new IndeedSearchCrawler(browserManager);
      const result = await crawler.discoverAndQueue({
        queries: ['challenge-test'],
        location: 'Remote',
        targetCount: 10,
        minFitScore: 50,
        useSyntheticFallbackIfBlocked: false,
      });

      expect(result.discoveredCount).toBe(0);
      expect(result.queuedCount).toBe(0);
      expect(result.jobs.length).toBe(0);
    }, 20000);
  });
});
