# Original User Request

## 2026-09-12T05:45:17Z

An autonomous end-to-end job application agent that discovers 30+ qualified software engineering positions on Indeed, screens them against candidate qualifications, executes the application submissions via Playwright, records immutable ledger events, and synchronizes results with the production cloud dashboard.

Working directory: D:\programming\job-application-agent
GitHub Repository: https://github.com/zrt219/indeed-application
Integrity mode: development

## Requirements

### R1. Indeed Job Discovery & Auto-Ingestion Crawler
- Implement an automated job search and discovery engine for Indeed (`src/engine/discovery/indeed-search.ts`) querying target roles (e.g. "Full Stack Engineer", "Software Engineer", "TypeScript", Remote/Hybrid).
- Extract job metadata (title, employer, location, salary, job description, job key/URL) from search result cards and pagination.
- Run deterministic qualification scoring (Fit Score 0–100) and automatically ingest jobs meeting the qualification threshold (Fit Score >= 50%) into the `QUEUED` state.

### R2. Automated 30-Job Application Execution Loop
- Run the Playwright background queue worker through the ingested jobs until 30 job applications have been executed and processed.
- Support persistent browser context / user session to seamlessly handle Indeed authentication and minimize anti-bot challenges.
- Cascade question answering: AnswerBank -> Candidate Profile Facts -> Phi-3 LLM with strict Zod structured output.
- For each job: upload resume, fill form fields, submit application, capture timestamped screenshot evidence, and record completion status.

### R3. Immutable Ledger Logging & Outbox Cloud Synchronization
- Log every single event (`DISCOVERED`, `ANALYZED`, `QUEUED`, `APPLICATION_STARTED`, `FORM_IN_PROGRESS`, `SUBMISSION_CONFIRMED` or `REQUIRES_MANUAL_ACTION`) to `EventLedger` with source attribution (`PLAYWRIGHT_AUTONOMOUS`).
- Atomically enqueue corresponding `OutboxEvent` records.
- Run the outbox sync daemon to stream all 30 application records to the live Vercel cloud dashboard (`https://job-application-agent-kohl.vercel.app/api/sync`).

### R4. Verification & Audit Trail
- Output a comprehensive audit report showing all 30 processed jobs, employers, titles, Fit Scores, final application statuses, and confirmation screenshots.
- Ensure the production Vercel dashboard metrics (`Total Evaluated`, `In Queue`, `Submitted`, `Action Needed`) reflect the synchronized activity.

## Acceptance Criteria

### Discovery & Queue Ingestion
- [ ] At least 30 distinct job opportunities matching candidate profile discovered and ingested into local database.
- [ ] All ingested jobs evaluated with deterministic Fit Scores.
- [ ] Zero duplicate jobs ingested (idempotent URL checks).

### Application Execution
- [ ] Automated execution attempted across the 30 queued jobs.
- [ ] Screenshot evidence stored in `screenshots/` for each submitted or escalated application.
- [ ] Anti-bot detection cleanly halts and escalates rather than triggering account bans if blocked.

### Audit & Synchronization
- [ ] 30 application lifecycles recorded in `EventLedger` and verified in SQLite.
- [ ] Outbox daemon synchronizes events to `https://job-application-agent-kohl.vercel.app`.
- [ ] Live Vercel dashboard displays all 30 applications in the Event Ledger table.
