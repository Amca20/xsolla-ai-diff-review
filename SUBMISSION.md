# AI Diff Review Service - Submission

## Architecture Overview
- **Runtime:** Node.js + Express.js
- **Processing Model:** Asynchronous Background Worker with In-Memory Job Queue (`jobsDb`).
- **Real-Time Streaming:** Server-Sent Events (SSE) streaming (`event: status`, `event: finding`, `event: done`) with full replay functionality for completed jobs.
- **Cross-Cutting Features:** In-memory Caching (`cacheHit`), Idempotency Guard (`Idempotency-Key` header with SHA-256 body hashing), Rate Limiting (30 req/min), and Chunking (>64 KiB file boundary parsing).

## Provider Design
- **`mock`:** Fully deterministic implementation executing the exact rule definitions (`MOCK-001` through `MOCK-INJ`) with standardized severity, category, sorting (`path` -> `line` -> `ruleId`), and deduplication.
- **`llm`:** Integrated Google Gemini API (`gemini-3.1-flash-lite`). Configured gracefully so that if model credentials fail or limits are hit, the job transitions safely to `"status": "failed"` without crashing the HTTP server.

## Verification
- Verified all endpoints using PowerShell & `curl` CLI scripts.
- Tested `401 Unauthorized` auth guards across `/v1/*`.
- Tested `Idempotency-Key` reuse and `409 idempotency_conflict` handling.
- Verified SSE event streaming and replay capability on finished jobs.
- Tested `maxFindings` truncation and `usage` payload reporting.

## AI Tools Used
- Leveraged LLMs for rapid drafting of regex patterns, async job queue scaffolding, and SSE handler structure.
- **Rejected AI Suggestion:** AI suggested auto-falling back to `mock` when `llm` fails. Rejected this because the contract explicitly requires `llm` failures to result in a `failed` status rather than hiding errors via silent fallback.

## Future Improvements
- Implement persistent database storage (e.g., Redis / PostgreSQL) for job queues, caching, and idempotency states across server restarts.
- Add distributed worker pools for heavy diff processing.