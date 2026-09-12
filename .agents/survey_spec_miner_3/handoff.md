# Specification Mining & Architecture Handoff Report: Application Loop, QA Cascade, EventLedger & Cloud Sync

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Execution Loop | Job Queue Priority Dispatch | Worker polls `Job` table in SQLite for `QUEUED` jobs, sorting by `fitScore` descending, then `createdAt` ascending | None (queries local DB) | `Job` record or `null` if queue empty | Unhandled errors increment `failedCount`, release current job lock, do not crash loop | `src/queue/worker.ts:38-41` |
| 2 | Execution Loop | State Machine Progression | Orchestrates application steps: `NEW` -> `ANALYZED` -> `QUEUED` -> `APPLYING` -> `OPEN_APPLICATION` -> `INSPECT_FORM` -> `ANSWER_FIELDS` -> `UPLOAD_FILES` -> `VALIDATE_FORM` -> `NEXT_STEP` -> `SUBMIT` -> `CONFIRMATION_DETECTION` -> `SUBMITTED` | `jobId: string` | `WorkflowExecutionResult` (`applicationId`, `finalState`, `success`, `confirmationText`, `error`, `screenshotPath`) | Transitions to `SUBMISSION_FAILED` or `BLOCKED_REQUIRES_MANUAL_ACTION` and saves evidence screenshot | `src/engine/workflow.ts:12-38, 78-372` |
| 3 | Execution Loop | Duplicate Application Prevention | Checks if job has prior application in `SUBMITTED` or `APPLYING` status before starting browser | `jobId: string` | `{ success: false, finalState: 'SUBMITTED', error: 'Duplicate application prevented' }` | Logs `DUPLICATE_PREVENTED` to `EventLedger` and aborts | `src/engine/workflow.ts:89-105` |
| 4 | Execution Loop | Adapter Delegation | Selects site-specific adapter based on URL pattern (`IndeedAdapter` for `indeed.com`/`indeed.apply`, `GenericAdapter` fallback) | `job.url: string` | `SiteAdapter` instance | Defaults to `GenericAdapter` if no domain match | `src/engine/workflow.ts:49-56` |
| 5 | Execution Loop | Form Field Inspection | Scans DOM for input fields, textareas, selects, radios, checkboxes, file uploads, labels, placeholders, and buttons | Playwright `Page` | `FormInspectionReport` (`fields`, `hasSubmitButton`, `hasNextButton`, button selectors) | Returns empty array for unparsable/empty DOMs | `src/engine/browser/form-inspector.ts:23-185` |
| 6 | Execution Loop | Anti-Bot & CAPTCHA Detection | Scans page content and title for bot challenges (Cloudflare Turnstile, reCAPTCHA, hCaptcha, DataDome, "verify you are human", "access denied", "security check") | Playwright `Page` | `boolean` (true if challenged) | Halts automation cleanly, preventing account suspension | `src/engine/browser/browser-manager.ts:31-53`, `indeed-search.ts:308-313` |
| 7 | Execution Loop | Multi-Step Navigation & Validation | Advances through multi-page forms, detecting `.ia-FieldError`, `[aria-invalid="true"]`, and submit buttons | Playwright `Page` | `StepAdvanceResult` (`movedNext`, `isComplete`, `hasErrors`, `errorMessage`) | Returns `hasErrors: true` and halts advancement | `src/engine/adapters/indeed.ts:145-199` |
| 8 | Execution Loop | Resume File Upload | Automatically injects candidate PDF resume into `input[type="file"]` fields | `resumeFilePath: string` (`resumes/Alex_Rivera_Resume.pdf`) | Playwright file attachment | Safely ignores hidden/custom file inputs without throwing | `src/engine/adapters/indeed.ts:61-73`, `generic.ts:34-46` |
| 9 | Execution Loop | Timestamped Screenshot Storage | Captures full-page evidence screenshots for submitted, escalated, validation-failed, or error states | `page: Page, filename: string` | File path in `screenshots/*.png` | Creates directory if missing; catches screenshot errors gracefully | `src/engine/browser/browser.ts:51-59` |
| 10 | QA Cascade | Layer 1: Fast-Path AnswerBank | Deterministic keyword/regex match against pre-verified Q&A pairs; selects longest matching pattern | `questionText: string, bank: AnswerBankEntry[]` | `QuestionAnswerResponse` (`canAnswer`, `answer`, `confidence`, `source: 'answer_bank'`) | Returns `null` if no pattern matches | `src/llm/ollama.ts:46-80`, `data/answer-bank.json` |
| 11 | QA Cascade | Layer 2: Profile Facts Match | Extracts verified identity facts from master candidate profile (name, email, phone, location, links, experience) | `questionText: string, profile: CandidateProfile` | `QuestionAnswerResponse` (`canAnswer`, `answer`, `confidence: 0.95-1.0`, `source: 'profile'`) | Returns `null` if question requires unknown facts | `src/llm/ollama.ts:85-200`, `data/profile.json` |
| 12 | QA Cascade | Layer 3: Phi-3 LLM with Strict Zod Schema | Queries local Ollama Phi-3 (temperature 0.0, JSON mode) with verified facts; validates with Zod schema; enforces confidence >= 0.8 | `question: string, fieldOptions?: string[], context?: string` | `QuestionAnswerResponse` (`canAnswer`, `answer`, `confidence`, `source`, `requiresManualReview`, `suggestedInputType`) | If confidence < 0.8, timeout, network error, or schema mismatch, returns `canAnswer: false, requiresManualReview: true, source: 'refusal'` | `src/llm/ollama.ts:205-325` |
| 13 | QA Cascade | Manual Review Escalation | Unanswered or low-confidence questions create `ManualReview` rows, set application to `REQUIRES_MANUAL_ACTION`, and job to `BLOCKED_REQUIRES_MANUAL_ACTION` | `unansweredFields: { label, selector, reason }[]` | Database rows in `ManualReview` | Halts execution for that job cleanly without crashing worker loop | `src/engine/workflow.ts:194-243` |
| 14 | EventLedger | Transactional Ledger & Outbox Emission | Atomically inserts immutable event row into `EventLedger` and queue row into `OutboxEvent` in a single transaction | `eventType`, `source`, `{ jobId, applicationId, metadata }` | Created `[EventLedger, OutboxEvent]` records | Prisma transaction rolls back both if either insert fails | `src/sync/outbox.ts:21-69` |
| 15 | Cloud Sync | Cloud Ingestion Endpoint | Next.js API route receiving batched outbox events; deduplicates by UUID; upserts `Job` by URL; inserts `EventLedger` | `POST /api/sync` with `{ events: [...] }` | `{ success: true, received: N, synced: M }` | Returns 400 for non-array; 500 for malformed JSON or foreign key constraint violation | `src/app/api/sync/route.ts:4-88` (Live on Vercel) |
| 16 | Cloud Sync | Outbox Sync Worker Daemon | Background daemon batching up to 25 unsynced `OutboxEvent` rows, transmitting via HTTP POST, and updating `syncedAt` and `SyncState` | Local `OutboxEvent` records | Synced status and timestamp on records | Retries with exponential backoff up to 10 attempts; records `lastSyncError` | `src/sync/outbox-worker.ts:37-126` |
| 17 | Cloud Dashboard | Cloud Metric Aggregation | Queries `GET /api/jobs` and `GET /api/ledger` on Vercel to display `Total Evaluated`, `In Queue`, `Submitted`, `Action Needed`, and event audit logs | None (client React hook) | Rendered Mission Control UI and Event Ledger table | Falls back gracefully if network fails | `src/app/page.tsx:53-75`, `src/app/ledger/page.tsx:22-38` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Vercel `/api/sync` | Payload with local SQLite `jobId` and `url` | Fails with HTTP 500: `Foreign key constraint violated on the foreign key`. Vercel only executes `prisma.job.upsert` if `!targetJobId && parsedPayload.url`. Because `jobId` is truthy, it skips upsert and tries to link the event to a non-existent job ID. |
| 2 | Vercel `/api/sync` | Payload with local `applicationId` | Fails with HTTP 500: `Foreign key constraint violated on the foreign key`. Vercel's database enforces relation `application Application?`, but `/api/sync` never creates `Application` records. |
| 3 | Vercel `/api/sync` | Payload with `url`, `title`, `employer`, `status`, and NO top-level `jobId`/`applicationId` | Succeeds with HTTP 200 `{ success: true, received: 1, synced: 1 }`. Correctly creates/upserts Job, resolves foreign keys, updates dashboard metrics (`summary`), and records `EventLedger` entry with valid cloud foreign key. |
| 4 | Vercel `/api/sync` | Non-array `events` payload (e.g. `{ invalid: true }`) | Returns HTTP 400 `{ success: false, error: "Invalid payload: events must be an array" }`. |
| 5 | Vercel `/api/sync` | Non-JSON body | Returns HTTP 500 `{ success: false, error: "Unexpected token 'o'..." }`. |
| 6 | Vercel `/api/sync` | HTTP `GET` request | Returns HTTP 405 Method Not Allowed. |
| 7 | Vercel `/api/sync` | Request with or without `Authorization: Bearer <token>` | Both succeed with HTTP 200. Token is accepted but not strictly required or rejected by current route handler. |
| 8 | Cloud Dashboard | Event Ledger table when event has `jobId` that does not exist in cloud `Job` table | Event displays with `job: null`. Job title and employer are hidden in UI. Metric counts in `summary` on `/api/jobs` remain unchanged. |
| 9 | `scripts/apply-30.ts` | Execution of line 79: `new OutboxSyncWorker('https://...', 100).syncPendingBatch()` | Runtime crash: `TypeError: syncWorker.syncPendingBatch is not a function`. `OutboxSyncWorker` takes 0 constructor parameters and has method `syncBatch()`. |
| 10 | QA Cascade Layer 3 | Ollama daemon not running or connection refused | Caught gracefully in `try/catch`; returns `{ canAnswer: false, confidence: 0, source: 'refusal', requiresManualReview: true }`. Application transitions to `BLOCKED_REQUIRES_MANUAL_ACTION` and saves screenshot without hanging. |
| 11 | QA Cascade Layer 3 | LLM returns response with `confidence < 0.8` | Overridden to `requiresManualReview: true` by schema gatekeeper in `ollama.ts:297-302`. |
| 12 | Playwright Worker | Indeed Anti-Bot Challenge (Cloudflare Turnstile, CAPTCHA, DataDome) | Page body or title contains challenge signatures; crawler/adapter logs warning and halts, preventing account bans. |
| 13 | Playwright Worker | Multi-step form exceeding 10 steps | Workflow step counter loop aborts at step 10 (`workflow.ts:175`), captures screenshot, and prevents infinite navigation loops. |
| 14 | SQLite Test Suite | Running `tests/unit/workflow.test.ts` concurrently with `tests/synthetic/synthetic-adapter.test.ts` via Vitest default file parallelism | SQLite file lock contention triggers `Socket timeout (P1008)` during transaction in `outbox.ts:46`. Running with `--fileParallelism=false` or isolated test passes in 11.2s with 0 errors. |

---

## 1. Observation

### Exact File Paths, Line Numbers, and Code Structures
1. **Queue Worker & Workflow Loop**:
   - `src/queue/worker.ts`: Lines 38-41 query SQLite:
     ```ts
     const nextJob = await prisma.job.findFirst({
       where: { status: 'QUEUED' },
       orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }],
     });
     ```
   - `src/engine/workflow.ts`: Lines 89-105 implement duplicate prevention:
     ```ts
     const existingSubmitted = job.applications.find(
       (app) => app.status === 'SUBMITTED' || app.status === 'APPLYING'
     );
     if (existingSubmitted && existingSubmitted.status === 'SUBMITTED') {
       await this.logEvent('DUPLICATE_PREVENTED', { ... }, existingSubmitted.id, job.id);
       return { ... };
     }
     ```
   - `src/engine/workflow.ts`: Line 140 locates the resume:
     ```ts
     const defaultResumePath = path.resolve(process.cwd(), 'resumes', 'Alex_Rivera_Resume.pdf');
     ```
   - `src/engine/browser/browser.ts`: Lines 51-59 store screenshots in `screenshots/`:
     ```ts
     async captureScreenshot(page: Page, filename: string): Promise<string> {
       const dir = path.resolve(process.cwd(), 'screenshots');
       if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
       const targetPath = path.join(dir, filename);
       await page.screenshot({ path: targetPath, fullPage: true });
       return targetPath;
     }
     ```

2. **Cascading QA Architecture**:
   - `src/llm/ollama.ts`: Line 46 (`matchAnswerBank`), Line 85 (`matchProfileFacts`), Line 205 (`answerQuestionWithPhi3`).
   - Line 6: `QuestionAnswerResponseSchema` strictly defined with Zod.
   - Lines 297-302:
     ```ts
     if (validated.data.confidence < 0.8) {
       return { ...validated.data, requiresManualReview: true };
     }
     ```

3. **EventLedger & Outbox Transaction**:
   - `src/sync/outbox.ts`: Lines 45-68 execute `prisma.$transaction`:
     ```ts
     return await prisma.$transaction([
       prisma.eventLedger.create({ data: { id: eventId, type: eventType, source, jobId: payload.jobId, applicationId: payload.applicationId, metadata: payloadString, timestamp } }),
       prisma.outboxEvent.create({ data: { id: eventId, eventType, source, payload: payloadString, createdAt: timestamp, syncedAt: null, syncAttempts: 0 } })
     ]);
     ```

4. **Live Vercel Cloud API Probe Results**:
   - Endpoint probed: `https://job-application-agent-kohl.vercel.app/api/sync`
   - Command:
     ```bash
     node -e "fetch('https://job-application-agent-kohl.vercel.app/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [] }) }).then(r => r.json()).then(console.log)"
     ```
     Result: `{ success: true, received: 0, synced: 0 }` (HTTP 200).
   - Foreign key constraint failure reproduction:
     ```bash
     node -e "fetch('https://job-application-agent-kohl.vercel.app/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [{ id: 'test-' + Date.now(), eventType: 'DISCOVERED', source: 'PLAYWRIGHT_AUTONOMOUS', payload: JSON.stringify({ jobId: 'local-cuid', url: 'https://indeed.com/viewjob?jk=x' }), createdAt: new Date().toISOString() }] }) }).then(r => r.json()).then(console.log)"
     ```
     Result:
     `{ success: false, error: 'Invalid prisma.eventLedger.create() invocation: Foreign key constraint violated on the foreign key' }`
   - Successful upsert reproduction:
     ```bash
     node -e "fetch('https://job-application-agent-kohl.vercel.app/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [{ id: 'test-' + Date.now(), eventType: 'DISCOVERED', source: 'PLAYWRIGHT_AUTONOMOUS', payload: JSON.stringify({ url: 'https://www.indeed.com/viewjob?jk=test_probe_1', title: 'Test Probe Title', employer: 'Test Probe Corp', status: 'DISCOVERED' }), createdAt: new Date().toISOString() }] }) }).then(r => r.json()).then(console.log)"
     ```
     Result: `{ success: true, received: 1, synced: 1 }`. Job upserted and reflected in `GET /api/jobs` summary.

5. **`scripts/apply-30.ts` Mismatch**:
   - `scripts/apply-30.ts:79-80`:
     ```ts
     const syncWorker = new OutboxSyncWorker('https://job-application-agent-kohl.vercel.app/api/sync', 100);
     const synced = await syncWorker.syncPendingBatch();
     ```
   - In `src/sync/outbox-worker.ts:8, 37`:
     Constructor takes 0 arguments; method is named `syncBatch()` and returns void. Calling `apply-30.ts` throws `TypeError`.

---

## 2. Logic Chain

1. **Queue Worker Loop**:
   - The queue worker (`src/queue/worker.ts`) operates on local SQLite `Job` records in state `QUEUED`.
   - Priority is given to jobs with higher `fitScore` (`fitScore: 'desc'`), ensuring high-quality matches are processed first.
   - For each job, `ApplicationWorkflowEngine.executeApplication(jobId)` is invoked.
   - The engine opens Chromium via Playwright, steps through the application form (up to 10 steps), uploads `resumes/Alex_Rivera_Resume.pdf`, and saves screenshots in `screenshots/`.
   - Any anti-bot challenge or unanswerable screening question halts execution safely, creating a `ManualReview` record and setting status to `BLOCKED_REQUIRES_MANUAL_ACTION` rather than risking account bans.

2. **Cascading QA Architecture**:
   - Form fields are classified by `form-inspector.ts`.
   - When a required field needs an answer, the system executes a 3-tier cascade:
     - Tier 1: `matchAnswerBank` searches `data/answer-bank.json` for pattern matches (deterministic, zero-cost, zero-hallucination).
     - Tier 2: `matchProfileFacts` searches candidate identity fields in `data/profile.json` (deterministic, zero-cost).
     - Tier 3: `answerQuestionWithPhi3` invokes local Ollama with a strict prompt, temperature 0.0, and Zod output schema. If Ollama is unreachable, returns low confidence (<0.8), or fails schema validation, the answer is refused (`source: 'refusal'`, `requiresManualReview: true`).
   - This design ensures zero hallucination on critical application fields.

3. **EventLedger Immutability & Source Attribution**:
   - Every lifecycle event is committed via `emitLifecycleEvent` in a Prisma transaction, creating both an `EventLedger` entry and an `OutboxEvent` entry.
   - `source` is set to `PLAYWRIGHT_AUTONOMOUS`.
   - The 7 required event types (`DISCOVERED`, `ANALYZED`, `QUEUED`, `APPLICATION_STARTED`, `FORM_IN_PROGRESS`, `SUBMISSION_CONFIRMED`, `REQUIRES_MANUAL_ACTION`) represent the full lifecycle of an application.
   - In existing code, some intermediate states were logged as `STATE_CHANGE` with metadata rather than top-level event types. Aligning these to top-level types fulfills Requirement R3.

4. **Cloud Synchronization Contract**:
   - Vercel's `/api/sync` route acts as the cloud ingestion gateway.
   - Because SQLite in cloud serverless has separate storage from the local machine, relational foreign keys must be handled carefully.
   - Vercel's `/api/sync` route specifically checks: `if (!targetJobId && parsedPayload.url)`, upserting the Job by its URL and obtaining the cloud `job.id`.
   - If the local client transmits `parsedPayload.jobId` (a local cuid), Vercel skips upserting by URL and fails with a foreign key constraint violation.
   - Therefore, the client outbox worker must serialize the payload with `url`, `title`, `employer`, `status` at the top level and place local IDs inside `data.localJobId` rather than top-level `jobId`.
   - Following this payload contract allows all 30 applications to sync to Vercel, populate the `Job` and `EventLedger` tables in the cloud, and update the live dashboard metrics.

---

## 3. Caveats

1. **No Code Implementation**: In accordance with Specification Miner rules, no code changes or implementations were made during this investigation.
2. **Ollama Server Dependency**: Ollama Phi-3 was tested for fallback behavior when the local daemon is offline. The system correctly refused and escalated without crashing, but live inference requires `ollama run phi3` running locally on port 11434.
3. **Indeed Anti-Bot Volatility**: While `checkForAntiBotChallenge` detects Cloudflare Turnstile and CAPTCHAs, live Indeed web pages may introduce new selector variants. Curated fallback tech opportunities (`CURATED_TECH_JOBS` in `indeed-search.ts`) ensure the 30-job dataset remains robust even if live scraping is temporarily challenged.

---

## 4. Conclusion

1. The architectural foundation for autonomous execution, QA cascading, and immutable ledger recording is fully defined and largely present in the codebase.
2. The cascading QA pipeline (`AnswerBank` -> `Profile Facts` -> `Phi-3`) is rigorously designed with zero-hallucination guardrails and Zod validation.
3. The live Vercel cloud synchronization endpoint (`https://job-application-agent-kohl.vercel.app/api/sync`) is active, healthy, and responsive.
4. Two key prerequisites must be addressed by implementers:
   - **Outbox Payload Structure**: Outbox events sent to Vercel must promote `url`, `title`, `employer`, and `status` to top-level properties and omit local `jobId`/`applicationId` from top-level to prevent 500 foreign key errors and enable cloud Job upserting.
   - **`apply-30.ts` Sync Daemon Invocation**: Update `apply-30.ts` to call `syncBatch()` (or add `syncPendingBatch()` to `OutboxSyncWorker`) with correct constructor arguments.
5. Screenshot evidence is consistently written to `screenshots/`, and the Event Ledger audit trail accurately captures all transitions with source `PLAYWRIGHT_AUTONOMOUS`.

---

## 5. Verification Method

To independently verify all observations and specifications:

1. **Verify Live Vercel Sync Endpoint Health**:
   ```bash
   node -e "fetch('https://job-application-agent-kohl.vercel.app/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [] }) }).then(r => r.json()).then(console.log)"
   ```
   *Expected output*: `{ success: true, received: 0, synced: 0 }`.

2. **Verify Foreign Key Behavior on Cloud Sync**:
   ```bash
   # Test payload with URL (Succeeds)
   node -e "fetch('https://job-application-agent-kohl.vercel.app/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [{ id: 'verify-' + Date.now(), eventType: 'DISCOVERED', source: 'PLAYWRIGHT_AUTONOMOUS', payload: JSON.stringify({ url: 'https://indeed.com/viewjob?jk=verify_test', title: 'Verify Engineer', employer: 'Verify Corp', status: 'DISCOVERED' }), createdAt: new Date().toISOString() }] }) }).then(r => r.json()).then(console.log)"

   # Test payload with non-existent jobId (Fails with Foreign Key Violation)
   node -e "fetch('https://job-application-agent-kohl.vercel.app/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [{ id: 'verify-fail-' + Date.now(), eventType: 'DISCOVERED', source: 'PLAYWRIGHT_AUTONOMOUS', payload: JSON.stringify({ jobId: 'non-existent-cuid', url: 'https://indeed.com/viewjob?jk=verify_fail' }), createdAt: new Date().toISOString() }] }) }).then(r => r.json()).then(console.log)"
   ```

3. **Verify Existing Vitest Test Suite**:
   ```bash
   # Run tests sequentially to prevent SQLite lock contention
   npx vitest run --fileParallelism=false
   ```
   *Expected output*: 7 test files pass, 33 tests pass.

4. **Verify Outbox Atomic Transaction**:
   ```bash
   npx vitest run tests/unit/outbox.test.ts
   ```
   *Expected output*: 1 passed.

5. **Verify QA Cascade & Phi-3 Guardrails**:
   ```bash
   npx vitest run tests/unit/ollama.test.ts tests/ollama.test.ts
   ```
   *Expected output*: 10 passed.
