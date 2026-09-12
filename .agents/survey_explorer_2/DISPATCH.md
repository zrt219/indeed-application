# Dispatch for Survey Explorer 2

## Mission
Survey Indeed discovery & qualification engine requirements and existing code.
Read D:\programming\job-application-agent\.agents\ORIGINAL_REQUEST.md.
Investigate `src/engine/discovery/indeed-search.ts` or related files, how Indeed searching works (HTTP scraping, RSS, API, Playwright, or search result parsing), how metadata (title, employer, location, salary, description, job key/URL) is extracted and normalized.
Investigate the deterministic fit scoring algorithm (0-100, threshold >= 50), candidate profile requirements, queue state ingestion, and idempotent URL deduplication in the database.
Identify exact interfaces, input/output structures, and gaps.

Produce handoff.md with detailed requirements and design for the discovery and auto-ingestion crawler.

## 2026-09-12T05:46:43Z
You are Survey Explorer 2.
Your working directory for metadata and progress is: D:\programming\job-application-agent\.agents\survey_explorer_2
Codebase root: D:\programming\job-application-agent
MANDATORY: Read D:\programming\job-application-agent\.agents\ORIGINAL_REQUEST.md and D:\programming\job-application-agent\.agents\survey_explorer_2\DISPATCH.md before starting.
Survey Indeed discovery & qualification engine requirements and existing code.
Investigate src/engine/discovery/indeed-search.ts or related files, how Indeed searching works, how metadata (title, employer, location, salary, description, job key/URL) is extracted and normalized.
Investigate the deterministic fit scoring algorithm (0-100, threshold >= 50), candidate profile requirements, queue state ingestion, and idempotent URL deduplication in the database.
Identify exact interfaces, input/output structures, and gaps.
Document your findings in D:\programming\job-application-agent\.agents\survey_explorer_2\handoff.md following standard handoff structure (Observation, Logic Chain, Caveats, Conclusion, Verification Method).
Maintain progress.md with timestamps.
When complete, notify parent via send_message.
