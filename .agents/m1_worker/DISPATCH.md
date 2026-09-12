# Dispatch for M1 Worker: Indeed Job Discovery & Auto-Ingestion

## Mission
Implement Milestone 1: Indeed Job Discovery & Auto-Ingestion Crawler per ORIGINAL_REQUEST.md (R1) and PROJECT.md.
Read:
- `D:\programming\job-application-agent\.agents\ORIGINAL_REQUEST.md`
- `D:\programming\job-application-agent\PROJECT.md`
- `D:\programming\job-application-agent\.agents\survey_explorer_2\handoff.md`

## File Ownership
You exclusively own:
- `src/engine/discovery/indeed-search.ts`
- `tests/unit/indeed-search.test.ts`
Do NOT edit any other implementation files.

## Specific Tasks
1. Fix ESLint error in `src/engine/discovery/indeed-search.ts:369` (`discoveredCards` is never reassigned -> use `const`).
2. Ensure `CURATED_TECH_JOBS` is properly exported for testing.
3. Verify that `IndeedSearchCrawler.discoverAndQueue()` correctly:
   - Queries Indeed roles ("Full Stack Engineer", "Software Engineer", "TypeScript", Remote).
   - Extracts metadata (title, employer, location, salary, description, job key/URL).
   - Runs deterministic qualification scoring via `calculateFitScore(job, profile)`.
   - Ingests jobs meeting threshold (`fitScore >= 50 && !isExcluded`) with status `QUEUED`.
   - Ingests non-qualifying jobs with status `DISCOVERED`.
   - Guarantees idempotent deduplication via `Job.url` check before insertion.
   - Emits `DISCOVERED` and `QUEUED` events atomically with `source: 'PLAYWRIGHT_AUTONOMOUS'`.
4. Create comprehensive unit tests in `tests/unit/indeed-search.test.ts` covering:
   - Metadata extraction and URL canonicalization
   - Fit score calculation and >=50 queue filtering
   - Deduplication on identical URL
   - Clean handling of bot challenge pages
5. Run the tests using `npx vitest run tests/unit/indeed-search.test.ts --fileParallelism=false` and run `npm run lint` to verify clean pass.
6. Write your handoff report to `D:\programming\job-application-agent\.agents\m1_worker\handoff.md`.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## 2026-09-12T05:53:34Z
You are the Milestone 1 Worker for Indeed Job Discovery & Auto-Ingestion.
Your working directory is: D:\programming\job-application-agent\.agents\m1_worker
Codebase root: D:\programming\job-application-agent

MANDATORY: Read D:\programming\job-application-agent\.agents\ORIGINAL_REQUEST.md, D:\programming\job-application-agent\PROJECT.md, and D:\programming\job-application-agent\.agents\m1_worker\DISPATCH.md before starting.
Also review the survey findings at D:\programming\job-application-agent\.agents\survey_explorer_2\handoff.md.

File Ownership:
You exclusively own:
- src/engine/discovery/indeed-search.ts
- tests/unit/indeed-search.test.ts
DO NOT touch other files.

Specific Tasks:
1. Fix ESLint error in src/engine/discovery/indeed-search.ts:369 ('discoveredCards' is never reassigned -> use const).
2. Ensure CURATED_TECH_JOBS is exported.
3. Verify that IndeedSearchCrawler.discoverAndQueue() correctly:
   - Discovers jobs and extracts metadata (title, employer, location, salary, description, job key/URL).
   - Runs deterministic qualification scoring via calculateFitScore.
   - Automatically ingests jobs meeting qualification threshold (fitScore >= 50 && !isExcluded) into QUEUED state.
   - Non-qualifying jobs go to DISCOVERED state.
   - Enforces idempotent deduplication by checking Job.url before insertion.
   - Emits DISCOVERED and QUEUED events atomically to EventLedger and OutboxEvent with source: 'PLAYWRIGHT_AUTONOMOUS'.
4. Write comprehensive unit tests in tests/unit/indeed-search.test.ts covering card extraction, scoring filtering, deduplication, and challenge handling.
5. Execute verification commands:
   - npx vitest run tests/unit/indeed-search.test.ts --fileParallelism=false
   - npm run lint
6. Write handoff report to D:\programming\job-application-agent\.agents\m1_worker\handoff.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

