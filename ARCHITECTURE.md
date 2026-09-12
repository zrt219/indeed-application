# Job Application Automation System - Architecture

## 1. Core Technology Stack
*   **Web Framework & API:** Next.js (App Router)
*   **Database:** SQLite
*   **ORM:** Prisma
*   **Browser Automation:** Playwright
*   **Local AI:** Ollama running **Phi-3** (3.8B) for lightweight local inference
*   **Validation:** Zod
*   **Job Queue/Execution:** Background Worker Process (Node.js script or BullMQ)
*   **Primary ATS Target (MVP):** Indeed

## 2. Folder Structure
```text
/
├── prisma/
│   └── schema.prisma           # Database models
├── data/
│   ├── profile.json            # Master job-seeker profile
│   └── answer-bank.json        # Pre-verified standard screening answers
├── src/
│   ├── app/                    # Next.js Dashboard UI and API Routes
│   ├── engine/                 # Application Engine
│   │   ├── browser/            # Playwright lifecycle management
│   │   ├── adapters/           # Site-specific adapters (e.g., indeed.ts)
│   │   └── workflow.ts         # Main state machine
│   ├── llm/                    # Ollama Phi-3 integrations & Zod parsers
│   ├── db/                     # Prisma client & data access layers
│   ├── queue/                  # Background worker queue management
│   └── qualification/          # Resume matching and FIT score logic
├── resumes/                    # Stored resume PDFs & metadata
└── tests/
    ├── synthetic/              # Local test application for form filling
    └── unit/                   # Fit score & state machine tests
```

## 3. Database Model (Prisma)
*   **Job**: `id`, `externalId`, `title`, `employer`, `url`, `fitScore`, `status`
*   **Application**: `id`, `jobId`, `resumeId`, `status`, `submittedAt`, `confirmationText`
*   **EventLedger**: `id`, `applicationId`, `type`, `timestamp`, `metadata`
*   **Resume**: `id`, `path`, `targetRoles`, `seniority`, `technologies`

## 4. Major Components
1.  **Dashboard (Next.js)**: Local UI for viewing queues, manual review interventions, and job-search reporting.
2.  **Job Queue & Worker**: Receives jobs from dashboard/API and safely executes long-running Playwright tasks in the background.
3.  **Qualification Engine**: Deterministic first-pass filter scoring jobs (0-100) based on title, skills, experience, and hard exclusions.
4.  **Playwright Application Engine**: Handles form navigation, field classification, adapter delegation, and submission verification.
5.  **Ollama QA Engine (Phi-3)**: Safely parses unknown form questions and answers them strictly using `profile.json` and `answer-bank.json`.

## 5. Data Flow
1.  User imports job URL(s) into the **Next.js Dashboard**.
2.  API Route triggers **Qualification Engine** to check duplication and calculate Fit Score.
3.  If eligible, job is pushed to the **Background Worker Queue**.
4.  Worker launches **Playwright Engine** using the appropriate adapter (Indeed).
5.  Engine extracts unknown form fields and sends structured JSON to **Ollama QA Engine**.
6.  Ollama returns Zod-validated answers; Engine types them into the browser.
7.  All state changes are written to the **EventLedger** via Prisma.

## 6. Browser Automation Flow (State Machine)
`NEW` → `ANALYZED` → `QUEUED` → `APPLYING` → `OPEN_APPLICATION` → `INSPECT_FORM` → `ANSWER_FIELDS` (with Ollama fallback) → `UPLOAD_FILES` → `VALIDATE_FORM` → `NEXT_STEP` (repeat) → `FINAL_VALIDATION` → `SUBMIT` → `CONFIRMATION_DETECTION` → `SUBMITTED` (or `REQUIRES_MANUAL_ACTION`)

## 7. Failure States & Handling
*   **`BLOCKED_REQUIRES_MANUAL_ACTION`**: Captchas, 2FA, missing profile data, or Ollama unable to answer with confidence. Halts automation safely and notifies Dashboard.
*   **`SUBMISSION_FAILED`**: Form errors, site crashes, or network timeouts. Logs exact point of failure in Ledger.
*   **`TIMEOUT`**: Worker kills Playwright instance if a page hangs, marking job for retry or manual review.

## 8. Test Strategy
*   **Synthetic Local Testing**: Local Express/Next.js page containing various form inputs (text, radio, file uploads, multi-step) to test Playwright adapters without hitting live sites.
*   **LLM Hallucination Tests**: Intentional prompts designed to make Phi-3 invent experience; tests must verify these fail safely and trigger manual review.
*   **Ledger Immutability**: Verification that no job is applied to twice and every state change is logged.
