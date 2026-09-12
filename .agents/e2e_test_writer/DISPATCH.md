# Dispatch for E2E Test Writer

## Mission
Create the comprehensive E2E opaque-box test suite across Tiers 1-4 for the autonomous job application agent.
Read:
- `D:\programming\job-application-agent\.agents\ORIGINAL_REQUEST.md`
- `D:\programming\job-application-agent\PROJECT.md`
- `D:\programming\job-application-agent\.agents\survey_spec_miner_3\handoff.md`

## File Ownership
You exclusively own:
- `TEST_INFRA.md`
- `TEST_READY.md`
- `tests/e2e/**`
Do NOT modify application source code in `src/`.

## Test Suite Architecture & Methodology
Design test cases across 4 tiers:
- Tier 1: Feature Coverage (>=5 test cases per feature for core features: discovery, qualification, browser session/form filling, cascading QA, ledger/outbox logging, cloud sync).
- Tier 2: Boundary & Corner Cases (>=5 test cases per feature: extreme fit scores, missing required fields, bot challenge pages, invalid URLs, empty resumes, timeout handling).
- Tier 3: Cross-Feature Combinations (pairwise interactions: discovery -> qualification -> queue; queue -> form filling -> ledger; outbox emission -> payload validation -> cloud sync).
- Tier 4: Real-World Application Scenarios (end-to-end multi-job workflow, session resumption, manual review escalation, cloud sync batching).

Document architecture in `TEST_INFRA.md`.
Run tests via `npx vitest run tests/e2e --fileParallelism=false`.
When the test suite is ready and verified, publish `TEST_READY.md` at project root with coverage counts and runner instructions.
Write your handoff report to `D:\programming\job-application-agent\.agents\e2e_test_writer\handoff.md`.

## 2026-09-12T05:53:34Z
You are the E2E Test Writer for the Autonomous Job Application Agent project.
Your working directory is: D:\programming\job-application-agent\.agents\e2e_test_writer
Codebase root: D:\programming\job-application-agent

MANDATORY: Read D:\programming\job-application-agent\.agents\ORIGINAL_REQUEST.md, D:\programming\job-application-agent\PROJECT.md, and D:\programming\job-application-agent\.agents\e2e_test_writer\DISPATCH.md before starting.
Also review the findings at D:\programming\job-application-agent\.agents\survey_spec_miner_3\handoff.md.

File Ownership:
You exclusively own:
- TEST_INFRA.md (at project root)
- TEST_READY.md (at project root)
- tests/e2e/**
DO NOT modify application source code in src/.

Tasks:
1. Design and write comprehensive requirement-driven, opaque-box E2E test suite across 4 tiers:
   - Tier 1: Feature Coverage (>=5 test cases per feature for core features: discovery, qualification, browser session/form filling, cascading QA, ledger/outbox logging, cloud sync).
   - Tier 2: Boundary & Corner Cases (>=5 test cases per feature: extreme fit scores, missing required fields, bot challenge pages, invalid URLs, empty resumes, timeout handling).
   - Tier 3: Cross-Feature Combinations (pairwise interactions: discovery -> qualification -> queue; queue -> form filling -> ledger; outbox emission -> payload validation -> cloud sync).
   - Tier 4: Real-World Application Scenarios (end-to-end multi-job workflow, session resumption, manual review escalation, cloud sync batching).
2. Create TEST_INFRA.md at project root D:\programming\job-application-agent\TEST_INFRA.md documenting methodology, feature inventory, test runner commands, and coverage goals.
3. Verify tests using: npx vitest run tests/e2e --fileParallelism=false
4. When tests are in place, publish TEST_READY.md at project root D:\programming\job-application-agent\TEST_READY.md.
5. Write handoff report to D:\programming\job-application-agent\.agents\e2e_test_writer\handoff.md.

When complete, notify parent via send_message.
