# Project: Autonomous End-to-End Job Application Agent

## Architecture
The system is an autonomous job application pipeline comprising five core modules:
1. **Discovery & Qualification Engine (`src/engine/discovery/`, `src/qualification/`)**:
   - `IndeedSearchCrawler`: Scrapes live Indeed search results or seamlessly supplements from 32 curated software engineering positions when anti-bot challenges occur.
   - `calculateFitScore`: Deterministic 0–100 scoring evaluating candidate profile (`data/profile.json`) across 4 categories (Title, Skills, Experience, Location) with 5 hard exclusion filters.
   - Ingestion: Jobs with Fit Score >= 50% are idempotently ingested into SQLite with status `QUEUED`.
2. **Browser Automation & Session Management (`src/engine/browser/`, `src/engine/adapters/`)**:
   - `BrowserManager`: Playwright-driven Chromium automation with persistent user session/context support and anti-bot challenge detection.
   - `FormInspector`: DOM analyzer identifying form fields, buttons, labels, and file upload inputs.
   - `IndeedAdapter` / `GenericAdapter`: Site-specific form filling, resume attachment (`resumes/Alex_Rivera_Resume.pdf`), and multi-step advancement.
3. **Cascading QA Engine (`src/llm/ollama.ts`)**:
   - Layer 1: Fast-path deterministic regex matching against `data/answer-bank.json`.
   - Layer 2: Master candidate profile fact extraction (`data/profile.json`).
   - Layer 3: Local Ollama Phi-3 LLM with strict Zod structured output (`QuestionAnswerResponseSchema`, temperature 0.0, confidence threshold >= 0.8).
   - Safe Fallback: Unknown/low-confidence questions escalate to `ManualReview` and transition application to `BLOCKED_REQUIRES_MANUAL_ACTION`.
4. **Immutable Ledger & Outbox Cloud Synchronization (`src/sync/`, `src/app/api/sync/`)**:
   - Dual-write transaction: Every lifecycle event (`DISCOVERED`, `ANALYZED`, `QUEUED`, `APPLICATION_STARTED`, `FORM_IN_PROGRESS`, `SUBMISSION_CONFIRMED`, `REQUIRES_MANUAL_ACTION`) is recorded atomically in `EventLedger` and `OutboxEvent` with `source: 'PLAYWRIGHT_AUTONOMOUS'`.
   - Payload Contract: Outbox payload promotes `url`, `title`, `employer`, `status` to top-level to allow cloud SQLite to upsert `Job` by unique URL without foreign key errors.
   - `OutboxSyncWorker`: Streams batches of events to production Vercel dashboard (`https://job-application-agent-kohl.vercel.app/api/sync`).
5. **Execution Runner & Audit Trail (`scripts/`, `screenshots/`)**:
   - `scripts/apply-30.ts`: Coordinates batch execution of 30 queued jobs.
   - Evidence: Timestamped full-page screenshots saved to `screenshots/`.
   - Dashboard: Production Vercel dashboard reflects all 30 jobs, event ledger entries, and summary metrics.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Indeed Live & Curated Search | Scrapes Indeed search cards or falls back to 32 curated tech jobs | M1 | Survey |
| 2 | Job Metadata Extraction | Extracts title, employer, location, salary, description, job key/URL | M1 | Survey |
| 3 | Hard Exclusion Filtering | Rejects security clearance, sponsorship needs, unpaid, title mismatch, non-local on-site | M1 | Survey |
| 4 | Deterministic Fit Scoring | Calculates 0–100 score against candidate profile (threshold >= 50%) | M1 | Survey |
| 5 | Idempotent DB Ingestion | Ingests unique jobs by URL into SQLite with status `QUEUED` | M1 | Survey |
| 6 | Linter & Export Cleanliness | Fixes ESLint `prefer-const` and exports `CURATED_TECH_JOBS` | M1 | Survey |
| 7 | Persistent Browser Context | Implements persistent user session / cookies to minimize anti-bot challenges | M2 | Survey |
| 8 | Anti-Bot Challenge Detection | Detects Cloudflare/CAPTCHA challenges and cleanly halts/escalates | M2 | Survey |
| 9 | Form Field Inspection | Analyzes DOM inputs, selects, radios, checkboxes, and file uploads | M2 | Survey |
| 10 | Resume File Upload | Attaches candidate PDF resume (`resumes/Alex_Rivera_Resume.pdf`) | M2 | Survey |
| 11 | 3-Tier Cascading QA | AnswerBank -> Candidate Profile Facts -> Phi-3 LLM with strict Zod schema | M2 | Survey |
| 12 | Safe Escalation & Refusal | Refuses low-confidence answers and transitions to `BLOCKED_REQUIRES_MANUAL_ACTION` | M2 | Survey |
| 13 | Screenshot Evidence | Saves timestamped full-page screenshots in `screenshots/` | M2 | Survey |
| 14 | Atomic Event Emission | Commits `EventLedger` and `OutboxEvent` in single Prisma transaction | M3 | Survey |
| 15 | Source Attribution | Tags all lifecycle events with source `PLAYWRIGHT_AUTONOMOUS` | M3 | Survey |
| 16 | Top-Level Outbox Payload | Promotes `url`, `title`, `employer`, `status` to top-level to prevent FK 500 error | M3 | Survey |
| 17 | Outbox Sync Worker Daemon | Batches and POSTs outbox events to live Vercel cloud `/api/sync` endpoint | M3 | Survey |
| 18 | `apply-30.ts` Fixes | Fixes TS2304 `synced` variable and aligns with `OutboxSyncWorker` methods | M3 | Survey |
| 19 | 30-Job Execution Loop | Runs 30 applications end-to-end through Playwright workflow engine | M4 | Survey |
| 20 | Complete Lifecycle Event Logging | Records all 7 required event types for 30 jobs in SQLite | M4 | Survey |
| 21 | Production Cloud Sync | Streams 30 application lifecycles to live Vercel dashboard | M4 | Survey |
| 22 | Comprehensive Audit Report | Produces audit report with 30 jobs, statuses, fit scores, and screenshots | M4 | Survey |
| 23 | Live Dashboard Verification | Confirms production Vercel metrics (`Total Evaluated`, `In Queue`, `Submitted`, `Action Needed`) | M4 | Survey |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Suite | Requirement-driven opaque-box test suite across Tiers 1-4 | none | IN_PROGRESS |
| M1 | Indeed Job Discovery & Auto-Ingestion | `indeed-search.ts`, fit scoring, idempotent DB queue ingestion, unit tests | none | PLANNED |
| M2 | Persistent Browser Session & Playwright Execution Loop | Persistent context, anti-bot detection, form inspection, resume upload, 3-tier QA cascade, screenshots | M1 | PLANNED |
| M3 | Immutable Ledger & Outbox Cloud Sync | Transactional ledger, source `PLAYWRIGHT_AUTONOMOUS`, top-level outbox payload, `OutboxSyncWorker`, fix `apply-30.ts` | M2 | PLANNED |
| M4 | 30-Job Autonomous Execution & Cloud Verification | Execute 30 applications, stream to Vercel `/api/sync`, verify dashboard metrics, comprehensive audit report | M3, E2E | PLANNED |

---

## Interface Contracts

### 1. Discovery ↔ Database
- `IndeedSearchCrawler.discoverAndQueue(options?: DiscoveryOptions): Promise<{ discoveredCount: number; queuedCount: number; jobs: Job[] }>`
- Ingestion checks: `prisma.job.findUnique({ where: { url: card.url } })`.
- Fit Score condition: If `fitScore >= 50 && !isExcluded`, `status = 'QUEUED'`; else `status = 'DISCOVERED'`.
- Duplicate guarantee: Zero duplicate insertions on identical URL.

### 2. Form Automation ↔ Cascading QA
- `FormInspector.inspectForm(page: Page): Promise<FormInspectionReport>`
- `CascadingQA.answerQuestion(questionText: string, options?: string[]): Promise<QuestionAnswerResponse>`
  - Confidence >= 0.8 required for automated answer.
  - Zod schema: `{ canAnswer: boolean, answer: string, confidence: number, source: string, requiresManualReview?: boolean }`.
  - Fallback: creates `ManualReview` record and transitions application to `BLOCKED_REQUIRES_MANUAL_ACTION`.

### 3. Local Engine ↔ Outbox Cloud Sync (`/api/sync`)
- Event payload structure transmitted to `POST https://job-application-agent-kohl.vercel.app/api/sync`:
  ```json
  {
    "events": [
      {
        "id": "uuid",
        "eventType": "DISCOVERED | QUEUED | APPLICATION_STARTED | FORM_IN_PROGRESS | SUBMISSION_CONFIRMED | REQUIRES_MANUAL_ACTION",
        "source": "PLAYWRIGHT_AUTONOMOUS",
        "payload": "{\"url\":\"https://...\",\"title\":\"...\",\"employer\":\"...\",\"status\":\"...\",\"fitScore\":78,\"data\":{...}}",
        "createdAt": "2026-09-12T05:50:00.000Z"
      }
    ]
  }
  ```
- Top-level `payload` fields MUST contain: `url`, `title`, `employer`, `status`.
- Top-level `payload` fields MUST NOT contain local SQLite `jobId` or `applicationId` to prevent HTTP 500 Foreign Key constraint violations on the Vercel database.

---

## Code Layout
- `src/engine/discovery/`: Indeed search crawler, query builder, curated job fallback.
- `src/engine/browser/`: Browser manager (persistent context, screenshots, anti-bot detection), form inspector.
- `src/engine/adapters/`: Indeed adapter, generic adapter, synthetic test adapter.
- `src/engine/workflow.ts`: Main application state machine workflow engine.
- `src/qualification/`: Deterministic qualification scoring engine, candidate profile types.
- `src/llm/`: Ollama Phi-3 client, prompt templates, Zod schemas, cascading QA.
- `src/sync/`: Outbox event emission, atomic ledger transactions, outbox sync worker daemon.
- `src/db/`: Prisma client singleton and database helpers.
- `scripts/`: Batch execution scripts (`apply-30.ts`, `discover.ts`).
- `data/`: Candidate master profile (`profile.json`), verified answer bank (`answer-bank.json`).
- `resumes/`: Candidate resume PDF (`Alex_Rivera_Resume.pdf`).
- `screenshots/`: Timestamped evidence screenshots of application submissions and escalations.
- `tests/`: Unit tests, synthetic tests, E2E tests.
