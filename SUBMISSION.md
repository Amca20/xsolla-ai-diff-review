# Candidate Task Submission — AI Diff Review Service

## 1. System Architecture
* **Framework & Runtime:** Asynchronous Express REST API built on Node.js and hosted on Render for automated single-pass code review analysis.
* **Authentication Layer:** Exposes public endpoints (`/health`, `/spec`) while enforcing strict Bearer Token middleware across all protected `/v1/*` routes.
* **Asynchronous Job Model:** Submissions instantly acknowledge with HTTP 202 (`queued`), delegating diff processing line-by-line to a background worker to prevent event loop blocking.
* **In-Memory Store:** Uses native `Map()` instances to manage state for active jobs (`queued`, `running`, `done`, `failed`), stream events, and cached findings.
* **Pluggable Analysis Engine:** Decouples analysis execution between a deterministic local Regex engine (`mock`) and an external Google Gemini API integration (`llm`).
* **Cross-Cutting Middlewares:** Employs custom Express error handlers to enforce payload size limits (HTTP 413) and intercept malformed JSON bodies (HTTP 400).
* **Traffic Control:** Enforces sliding-window IP rate limiting (30 req/min) on submission routes, returning HTTP 429 with dynamic `Retry-After` headers.
* **Idempotency & Caching:** Utilizes SHA-256 payload hashing to handle duplicate submission keys (HTTP 409) and serve instant cached results (`cacheHit: true`).
* **Real-time Event Streaming:** Integrates Server-Sent Events (SSE) via `text/event-stream` for live job progress updates and historical replay.
---

## 2. Provider Design
The service decouples analysis via two distinct provider interfaces:
* **Mock Provider (`provider: "mock"`):** Fully deterministic, regex-based security and code quality engine. Scans added lines (`+`) against exact trigger rules (`MOCK-001` through `MOCK-008` & `MOCK-INJ`), generating structured findings sorted by `path` -> `line` -> `ruleId`.
* **LLM Provider (`provider: "llm"`):** Integrates directly with the Google Gemini API (`gemini-3.1-flash-lite`) using server-side credentials (`GEMINI_API_KEY`).

---

## 3. Verification of Cross-Cutting Behaviors
* **Rate Limiting (Strict 30 req/min):** Implemented an in-memory sliding window rate limiter on `POST /v1/reviews`. Up to 30 submissions per minute succeed normally. The 31st request onwards within the 60-second window is rejected with HTTP 429 (`rate_limited`) and includes a dynamic `Retry-After` header. Read-only GET routes remain unthrottled per specification.
* **Chunking:** Diffs over 64 KiB are split on exact file boundaries (`diff --git` / `---`), preserving line numbering, deduplication, and findings accuracy across chunks.
* **Caching:** Byte-identical `{diff, options}` payloads are cached via SHA-256 hashes. Cached requests return immediately with `"cacheHit": true` and full usage metadata preserved.
* **Idempotency:** Header `Idempotency-Key` enforces idempotency. Byte-identical requests yield the same `jobId`, while re-using a key with a modified payload triggers HTTP 409 (`idempotency_conflict`).
* **SSE & Replay (`/v1/reviews/:id/stream`):** Implements a `text/event-stream` endpoint. Live connections receive real-time `status`, `finding`, and `done` events. Connecting to a finished job replays all stored events identically.

---

## 4. AI Tools Used
* **Gemini 3.1 Flash Lite:** Configured as the live production LLM engine within the application service for intelligent code review.
* **Gemini Chat / Assistant:** Used during development for API contract verification, debugging Express middlewares, and refining regex patterns for unified diff parsing.

---

## 5. AI Suggestion Rejected & Why
* **AI Suggestion Rejected:** When configuring the `provider: "llm"` error handling, the AI initially suggested silently falling back to the local `mock` provider and returning a `done` state whenever the Gemini API key was missing or hit a rate limit.
* **Why I Rejected It:** I rejected this suggestion because I checked my Google AI Studio dashboard, observed zero API calls, and realized that returning mock findings under an LLM request was misleading. More importantly, it violated Xsolla's explicit contract, which requires unreachable LLM providers to emit a clear `failed` job status rather than masking errors. I corrected the implementation so that unhandled LLM errors cleanly set `job.status = 'failed'` without crashing the HTTP server.

---

## 6. What I Would Do Next With More Time
* **Persistent Database (SQLite/MongoDB):** Save review job states and findings into a database so historical results aren't lost when the server restarts.
* **Web UI Dashboard:** Build a simple frontend interface (e.g., in React or HTML/Tailwind) where users can easily paste diffs, click "Review", and view highlighted security findings visually.
* **Automated Unit Testing:** Add unit and integration tests using Jest or Vitest to automatically test endpoints, rate limiting, and edge-case unified diff parsing.
* **Expanded Mock Rule Library:** Add more security detection patterns (such as XSS vulnerability regex, hardcoded IP addresses, and insecure HTTP calls) to increase static mock review coverage.
