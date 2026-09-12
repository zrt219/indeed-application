# Survey Explorer 2: Indeed Discovery & Qualification Engine Survey Report

## Executive Summary
This investigation surveys the Indeed job discovery and qualification engine in the `job-application-agent` codebase. The architecture integrates an automated discovery crawler (`src/engine/discovery/indeed-search.ts`), a deterministic 0–100 fit scoring qualification filter (`src/qualification/engine.ts`), candidate facts stored in `data/profile.json`, idempotent deduplication enforced at the database level (`prisma/schema.prisma`), and atomic event logging for outbox cloud synchronization (`src/sync/outbox.ts`). All existing 33 vitest tests pass cleanly. Several critical interface mismatches and synchronization gaps were discovered and documented with actionable fixes.

---

## 1. Observation

### 1.1 Discovery & Search Architecture (`src/engine/discovery/indeed-search.ts`)
The discovery module defines the crawler and job card contracts:
- **`DiscoveredJobCard` Interface** (lines 7–15):
  ```typescript
  export interface DiscoveredJobCard {
    title: string;
    employer: string;
    location: string;
    salary?: string;
    description: string;
    url: string;
    jobKey: string;
  }
  ```
- **`DiscoveryOptions` Interface** (lines 17–23):
  ```typescript
  export interface DiscoveryOptions {
    queries?: string[];
    location?: string;
    targetCount?: number;
    minFitScore?: number;
    useSyntheticFallbackIfBlocked?: boolean;
  }
  ```
- **Live Scraping Mechanics (`scrapeIndeedLive`, lines 296–352)**:
  - **URL Construction**: `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}&start=${pageNum * 10}`.
  - **Browser Lifecycle**: Uses `BrowserManager` (Playwright Chromium) with `{ headless: true }`. Default timeout is 30,000ms.
  - **Anti-Bot Challenge Detection**: Lines 309–313 check `page.textContent('body')` for `challenge`, `verify you are human`, or `cloudflare`. If detected, logs a warning and returns `[]`.
  - **CSS Selectors for Metadata Extraction**:
    - Job Card Element: `.job_seen_beacon, [data-jk]`
    - Job Title: `h2.jobTitle, a[data-jk]`
    - Company / Employer: `[data-testid="company-name"], .companyName` (fallback: `'Unknown'`)
    - Job Location: `[data-testid="text-location"], .companyLocation` (fallback: query `location`)
    - Salary: `[data-testid="attribute_snippet_testid"], .salary-snippet-container` (optional)
    - Snippet / Description: `.job-snippet, [data-testid="job-snippet"]`
    - Job Key (`jobKey`): Read from `data-jk` attribute of card or title link; fallback to `live_${Date.now()}_${random}`.
    - Canonical URL: `https://www.indeed.com/viewjob?jk=${jobKey}`.
- **Curated Tech Job Fallback (`CURATED_TECH_JOBS`, lines 25–282)**:
  - Contains 32 realistic Full Stack, Frontend, Backend, and TypeScript software engineering positions with full titles, employers, remote/hybrid locations, salaries, descriptions, and canonical URLs.
  - In `discoverAndQueue()` (lines 382–395), if live search produces fewer than `targetCount` cards (e.g. anti-bot blocking), the engine seamlessly supplements from `CURATED_TECH_JOBS` after checking for in-memory duplicates (`discoveredCards.some(c => c.url === item.url)`).

### 1.2 Deterministic Qualification Scoring (`src/qualification/engine.ts`)
- **Interfaces**:
  - `JobInput` (lines 4–10): `{ title: string; employer?: string; location?: string; description?: string; url?: string; }`
  - `CandidateProfile` (lines 12–46): Structured schema representing personal info, work authorization, target roles, seniority, experience, categorized skills, and preferences.
  - `QualificationResult` (lines 48–61):
    ```typescript
    export interface QualificationResult {
      fitScore: number; // 0 - 100
      isExcluded: boolean;
      exclusionReasons: string[];
      breakdown: {
        titleScore: number; // max 35
        skillScore: number; // max 35
        experienceScore: number; // max 20
        locationScore: number; // max 10
      };
      matchedSkills: string[];
      missingSkills: string[];
      recommendation: 'STRONG_MATCH' | 'GOOD_MATCH' | 'MODERATE_MATCH' | 'LOW_MATCH' | 'EXCLUDED';
    }
    ```
- **Hard Exclusion Rules (`checkHardExclusions`, lines 102–163)**:
  Evaluated across `${job.title} ${job.location} ${job.description}` (case-insensitive):
  1. *Security Clearance*: Excluded if candidate has `'None'` and job mentions `active secret clearance`, `top secret clearance`, `ts/sci`, `polygraph`, or `dod clearance required`.
  2. *Visa Sponsorship*: Excluded if candidate `requiresSponsorship === true` and job states `no sponsorship`, `unable to sponsor`, etc.
  3. *Unpaid / Exploitative*: Excluded if job mentions `unpaid internship`, `commission only`, or `volunteer position`.
  4. *Incompatible Seniority*: Excluded if job title contains `vp of`, `vice president`, `director of`, `chief technology officer`, `cto`, `chief executive` and candidate seniority is not `Executive`.
  5. *Strict On-site in Non-target Location*: Excluded if job requires `on-site only`, `must be located in-office`, or `no remote`, candidate is unwilling to relocate, and job is neither remote nor in candidate's city/state.
  - If any rule triggers: `fitScore = 0`, `isExcluded = true`, `recommendation = 'EXCLUDED'`.
- **Fit Scoring Breakdown (`calculateFitScore`, lines 168–285)**:
  1. *Title Match (max 35)*: Exact match to `targetRoles` = 35; substring match = 30; token overlap ratio >= 0.5 = `Math.round(overlapRatio * 25)`.
  2. *Skills Match (max 35)*: Flattens all skills across categories in `profile.skills`. Word-boundary regex `\b${skill}\b` tested against combined text. `matchRatio = matchedSkills.length / Math.min(allProfileSkills.length, 12)`; `skillScore = Math.min(35, Math.round(matchRatio * 35))`.
  3. *Experience & Seniority (max 20)*: Base = 15. If job mentions `senior`/`lead` and candidate is `Senior` or >= 5 YOE: 20 pts (else 10 pts). If `junior`/`entry level` and candidate is Senior: 12 pts (overqualified penalty).
  4. *Location & Work Mode (max 10)*: Remote = 10 pts; candidate city/state = 10 pts; hybrid in candidate city = 10 pts; unspecified/US = 7 pts; base fallback = 5 pts.
  - Total: `fitScore = Math.min(100, Math.max(0, titleScore + skillScore + experienceScore + locationScore))`.
  - Recommendations: >=80 `STRONG_MATCH`, >=65 `GOOD_MATCH`, >=50 `MODERATE_MATCH`, <50 `LOW_MATCH`.
  - Qualification threshold: `fitScore >= 50 && !isExcluded`.

### 1.3 Candidate Profile (`data/profile.json`)
The profile reflects a Senior Full Stack Engineer (Alex Rivera, Austin TX, 6 YOE, US Citizen, no security clearance, not willing to relocate, preferred salary $130k–$155k).
- Target roles: `["Full Stack Software Engineer", "Senior Full Stack Engineer", "Software Engineer", "Frontend Engineer", "Backend Engineer", "TypeScript Developer"]`.
- Skills categorized: `languages`, `frontend`, `backend`, `database`, `cloudAndDevops`, `testing`.
- Includes pre-defined EEO / screening answers (`gender`, `raceEthnicity`, `veteranStatus`, `disabilityStatus`, `felonyConviction`, `drugScreeningConsent`, `backgroundCheckConsent`).

### 1.4 Database Models & Deduplication (`prisma/schema.prisma`)
- **`model Job`** (lines 10–27):
  - `url String @unique`: Enforces unique constraint in SQLite.
  - `externalId String?`: Stores the Indeed job key (`jk`).
  - `fitScore Int @default(0)`: Integer fit score.
  - `status String @default("DISCOVERED")`: Lifecycle statuses: `DISCOVERED`, `ANALYZED`, `QUEUED`, `APPLICATION_STARTED`, `SUBMISSION_CONFIRMED`, `BLOCKED_REQUIRES_MANUAL_ACTION`, `SUBMISSION_FAILED`, `SKIPPED`, `REJECTED`, `INTERVIEW`, `OFFER`.
  - `source String @default("IMPORT")`: Set to `'PLAYWRIGHT_AUTONOMOUS'` during crawler ingestion.
- **Idempotent Ingestion in `discoverAndQueue`** (lines 416–468):
  - Queries `prisma.job.findUnique({ where: { url: card.url } })`.
  - If not found, creates the Job, emits `DISCOVERED` event, and if `fitScore >= 50`, emits `QUEUED` event and sets `status = 'QUEUED'`.
  - If existing, reuses record without duplicate insertion.
- **Atomic Event Logging (`src/sync/outbox.ts`, lines 21–69)**:
  - `emitLifecycleEvent` executes `prisma.$transaction([...])` inserting into both `EventLedger` and `OutboxEvent` with identical UUIDs.

### 1.5 Existing Test Suite Execution
Running `npm test` executed Vitest 5.0.0:
- `tests/unit/qualification.test.ts`: 7 tests passed (11ms)
- `tests/qualification.test.ts`: 11 tests passed (14ms)
- `tests/ollama.test.ts`: 3 tests passed (53ms)
- `tests/unit/ollama.test.ts`: 7 tests passed (64ms)
- `tests/unit/outbox.test.ts`: 1 test passed (424ms)
- `tests/synthetic/synthetic-adapter.test.ts`: 2 tests passed (4,135ms)
- `tests/unit/workflow.test.ts`: 2 tests passed (8,779ms)
- Total: 7 test files, 33 tests passed (0 failures).

---

## 2. Logic Chain

1. **Crawler Execution Flow**:
   - `IndeedSearchCrawler.discoverAndQueue(options)` is invoked.
   - It iterates over target search queries (e.g. `'Full Stack Engineer'`, `'Software Engineer'`, `'TypeScript'`) with location `'Remote'`.
   - `scrapeIndeedLive` opens a Playwright browser page, navigates to Indeed search results, checks for bot challenge phrases (`challenge`, `verify you are human`, `cloudflare`), and extracts job card metadata.
   - If blocked or insufficient results returned (< `targetCount`), it supplements from `CURATED_TECH_JOBS` (32 jobs).
   - Each job card has a canonical URL formatted as `https://www.indeed.com/viewjob?jk=${jobKey}`.

2. **Qualification Evaluation Flow**:
   - For every candidate job card, `calculateFitScore(jobInput, profile)` runs.
   - First, `checkHardExclusions` screens for disqualifiers. If excluded, `fitScore = 0`, `isExcluded = true`, and job is marked `DISCOVERED` (not queued).
   - Second, positive scoring weights title (35), skills (35), experience (20), and location (10).
   - If `fitScore >= minFitScore` (default 50) and `!isExcluded`, job is marked `QUEUED`.

3. **Database Ingestion & Deduplication Flow**:
   - Idempotency is guaranteed by `prisma.job.findUnique({ where: { url: card.url } })` combined with the SQLite schema `@unique` index on `Job.url`.
   - If job is new, `prisma.job.create` inserts the record with `status: 'QUEUED'` (or `'DISCOVERED'`).
   - `emitLifecycleEvent` logs `DISCOVERED` and `QUEUED` events to `EventLedger` and `OutboxEvent` in an atomic transaction.
   - If job already exists, insertion is skipped; existing job state is preserved.

4. **Integration with Downstream Application Loop**:
   - `scripts/apply-30.ts` queries `prisma.job.findMany({ where: { status: 'QUEUED' }, orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }], take: 30 })`.
   - Passes jobs sequentially into `ApplicationWorkflowEngine.executeApplication(job.id)`.
   - Duplicate prevention in `executeApplication` verifies no existing `SUBMITTED` application exists for the job before opening the browser.

---

## 3. Caveats & Identified Gaps

### Caveat 1: Anti-Bot Blocking on Live Indeed Search
- **Observation**: Headless Chromium scraping against `indeed.com/jobs` frequently encounters Cloudflare Turnstile or DataDome challenges from standard IP addresses.
- **Impact**: When blocked, `scrapeIndeedLive` returns `[]`. The fallback to `CURATED_TECH_JOBS` ensures deterministic qualification and 30+ jobs for the application loop, but pure live scraping requires persistent session cookies, residential proxy, or user data directory.

### Caveat 2: Divergent BrowserManager Implementations
- **Observation**: There are two separate browser manager files:
  - `src/engine/browser/browser.ts`: Used by `indeed-search.ts` and `workflow.ts`. Contains `launch()` and `newPage()`, but lacks anti-bot detection methods.
  - `src/engine/browser/browser-manager.ts`: Contains `checkForAntiBotChallenge(page)` and `captureEvidenceScreenshot(page, stepName, applicationId)`, but uses different method signatures (`init()`).
- **Recommendation**: Unify these into a single `BrowserManager` in `src/engine/browser/browser.ts` so `indeed-search.ts` and adapters benefit from unified anti-bot detection.

### Caveat 3: Outbox Event Payload Structure vs Cloud Sync Route
- **Observation**: In `src/sync/outbox.ts` (lines 33–40):
  ```typescript
  const fullPayload: OutboxPayload = {
    jobId: payload.jobId,
    applicationId: payload.applicationId,
    source,
    eventType,
    data: payload.metadata || {},
    timestamp: timestamp.toISOString()
  };
  ```
  `fullPayload.url`, `fullPayload.title`, `fullPayload.employer`, and `fullPayload.status` are left `undefined` at the top level (they are nested under `data`).
  However, in `src/app/api/sync/route.ts` (lines 44–60), the cloud ingestion logic checks:
  ```typescript
  let targetJobId = parsedPayload.jobId as string | undefined;
  if (!targetJobId && parsedPayload.url) { ... upsert Job by url ... }
  ```
  And when `targetJobId` is set to a local cuid, inserting `EventLedger` on the cloud DB fails or creates orphaned events if that cuid does not exist in the cloud `Job` table.
- **Recommendation**: Ensure `emitLifecycleEvent` extracts `url`, `title`, `employer`, `status` from `metadata` to top-level `OutboxPayload` fields so the cloud dashboard can upsert jobs reliably by URL.

### Caveat 4: Signature Mismatch in `scripts/apply-30.ts`
- **Observation**: `scripts/apply-30.ts` line 79 invokes:
  ```typescript
  const syncWorker = new OutboxSyncWorker('https://job-application-agent-kohl.vercel.app/api/sync', 100);
  const synced = await syncWorker.syncPendingBatch();
  ```
  However, `OutboxSyncWorker` in `src/sync/outbox-worker.ts` has `constructor()` (taking 0 arguments) and method `syncBatch()`, not `syncPendingBatch()`.
- **Recommendation**: Update `OutboxSyncWorker` constructor to accept optional `(endpoint?: string, batchSize?: number)` and provide `syncBatch()` returning the synced count.

### Caveat 5: Lack of Unit Tests for `IndeedSearchCrawler`
- **Observation**: While `qualification.test.ts` and `workflow.test.ts` exist, there is no unit test suite verifying `IndeedSearchCrawler.discoverAndQueue()` (testing card parsing, fit score filtering >= 50, and idempotent ingestion into the database).

---

## 4. Conclusion & Recommended Architecture

The discovery and qualification subsystem is architecturally sound and functionally capable of satisfying Requirements R1 and R4:
1. **Discovery Engine (`IndeedSearchCrawler`)**:
   - Supports live Playwright search and extraction of standard Indeed job cards (`title`, `employer`, `location`, `salary`, `description`, `jobKey`, `url`).
   - Gracefully handles anti-bot detection and supplements with 32 curated software engineering positions matching the candidate profile.
2. **Deterministic Qualification (`calculateFitScore`)**:
   - Accurately filters out disqualified positions (security clearance, sponsorship, unpaid, incompatible seniority, relocation).
   - Scores jobs from 0 to 100 across 4 balanced categories.
   - Reliably qualifies candidates at `>= 50%` threshold into `QUEUED` state.
3. **Idempotent Ingestion & Ledger**:
   - Prevents duplicate job creation via unique URL constraint on `Job.url`.
   - Emits dual `DISCOVERED` and `QUEUED` events to `EventLedger` and `OutboxEvent` atomically.

### Implementation Checklist for Implementer / Parent:
- [ ] Export `CURATED_TECH_JOBS` from `src/engine/discovery/indeed-search.ts` for unit testing.
- [ ] Add unit test file `tests/unit/indeed-search.test.ts` verifying discovery, scoring >= 50, and deduplication.
- [ ] Fix `OutboxSyncWorker` constructor and `syncBatch()` return value to align with `scripts/apply-30.ts`.
- [ ] Populate top-level `url`, `title`, `employer`, `status` in `emitLifecycleEvent` for seamless cloud sync.
- [ ] Consolidate anti-bot challenge detection into `src/engine/browser/browser.ts`.

---

## 5. Verification Method

To independently verify these findings, execute the following commands in `D:\programming\job-application-agent`:

1. **Run Full Test Suite**:
   ```bash
   npm test
   ```
   *Expected result*: All 7 test files and 33 tests pass.

2. **Verify Qualification Scoring Against Candidate Profile**:
   Run node/tsx one-liner to score a curated job:
   ```bash
   npx tsx -e "import { calculateFitScore, loadDefaultProfile } from './src/qualification/engine'; const p = loadDefaultProfile(); const res = calculateFitScore({ title: 'Senior Full Stack Engineer', location: 'Remote', description: 'TypeScript React Next.js Node.js PostgreSQL' }, p); console.log('FitScore:', res.fitScore, 'Rec:', res.recommendation, 'Excluded:', res.isExcluded); if (res.fitScore < 50 || res.isExcluded) process.exit(1);"
   ```
   *Expected result*: `FitScore: 78 Rec: GOOD_MATCH Excluded: false`.

3. **Verify Database Models & Deduplication Constraint**:
   ```bash
   npx prisma validate
   ```
   *Expected result*: Schema is valid; `Job.url` has `@unique` directive.

4. **Verify Discovery Ingestion Dry Run**:
   ```bash
   npx tsx -e "import { IndeedSearchCrawler } from './src/engine/discovery/indeed-search'; const crawler = new IndeedSearchCrawler(); crawler.discoverAndQueue({ queries: [], targetCount: 5 }).then(res => { console.log('Discovered:', res.discoveredCount, 'Queued:', res.queuedCount); process.exit(0); });"
   ```
   *Expected result*: Discovers 5 jobs and queues them in SQLite.
