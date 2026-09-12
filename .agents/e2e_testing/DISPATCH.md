# Dispatch for E2E Testing Track

## Mission
Design, implement, and verify the comprehensive requirement-driven, opaque-box E2E test suite for the autonomous job application agent.
Read:
- `D:\programming\job-application-agent\.agents\ORIGINAL_REQUEST.md`
- `D:\programming\job-application-agent\PROJECT.md`

## Requirements
Follow the 4-tier test case methodology:
- Tier 1: Feature Coverage (>=5 test cases per feature for each of the core features in PROJECT.md)
- Tier 2: Boundary & Corner Cases (>=5 test cases per feature: empty inputs, extreme fit scores, missing fields, malformed URLs, bot challenge triggers)
- Tier 3: Cross-Feature Combinations (pairwise interaction between discovery, scoring, queue ingestion, QA cascade, ledger logging, and outbox sync)
- Tier 4: Real-World Application Scenarios (end-to-end multi-job workflow, session resumption, manual review escalation, cloud sync batching)

Create:
1. `TEST_INFRA.md` at project root documenting architecture, thresholds, and runner.
2. Test files in `tests/e2e/`.
3. When all tests are created and passing (or ready for execution), publish `TEST_READY.md` at project root.
