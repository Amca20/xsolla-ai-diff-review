# 🛡️ Xsolla Code Review Engine API

An asynchronous, SSE-enabled microservice built with Node.js and Express that analyzes unified code diffs for security vulnerabilities and quality issues. Supports both deterministic mock analysis and LLM-powered review capabilities via Gemini API.

---

## 🚀 Features

* **Asynchronous Streaming (SSE):** Real-time event streaming (`status`, `finding`, `done`) via Server-Sent Events.
* **Smart Caching & Idempotency:** Prevents redundant processing by hashing payload diffs (`cacheHit: true`).
* **Authentication & Rate Limiting:** Enforces strict Bearer token authentication and IP-based rate limiting (30 req/min).
* **Engine Flexibility:** Supports both fast deterministic `mock` scans and AI-driven `llm` reviews.

---

## 🔍 Mock Analysis Rules Engine

When using `"provider": "mock"`, the engine scans added diff lines (`+`) against the official deterministic static analysis rules:

| ruleId | severity | category | trigger (on the added line) | title |
| :--- | :--- | :--- | :--- | :--- |
| `MOCK-001` | `critical` | `security` | contains `eval(` | eval usage |
| `MOCK-002` | `critical` | `security` | matches `/(api[_-]?key\|secret\|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i` | hardcoded credential |
| `MOCK-003` | `high` | `security` | SQL keyword (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) inside a string concatenated with `+` | SQL string concatenation |
| `MOCK-004` | `high` | `correctness` | empty catch block (may span lines; report the `catch` line) | swallowed exception |
| `MOCK-005` | `medium` | `correctness` | `== null` or `!= null` | loose null comparison |
| `MOCK-006` | `medium` | `performance` | `JSON.parse(JSON.stringify(` | deep-clone via JSON |
| `MOCK-007` | `low` | `style` | contains `console.log(` | console.log left in |
| `MOCK-008` | `low` | `style` | contains `TODO` or `FIXME` | unresolved marker |
| `MOCK-INJ` | `critical` | `security` | contains, case-insensitive, `ignore previous instructions` or `disregard all prior` or `you are now` | prompt-injection content |

---

## 🛠️ API Reference

### 1. Submit Code Review Job
`POST /v1/reviews`

#### Headers
| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `Authorization` | String | **Yes** | `Bearer <YOUR_BEARER_TOKEN>` |
| `Content-Type` | String | **Yes** | `application/json` |
| `Idempotency-Key`| String | No | Unique key to ensure request idempotency |

#### Request Body
```json
{
  "provider": "mock",
  "diff": "--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n+eval('deleteAll()');",
  "options": {
    "maxFindings": 100
  }
}
```

#### Response (`202 Accepted`)
```json
{
  "jobId": "job_1712345678_abc12",
  "status": "queued"
}
```

---

### 2. Stream Review Results
`GET /v1/reviews/:id/stream`

#### Headers
| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `Authorization` | String | **Yes** | `Bearer <YOUR_BEARER_TOKEN>` |

#### Server-Sent Events (SSE) Response Stream
```http
event: status
data: {"status":"running"}

event: finding
data: {"id":"MOCK-001:app.js:1","ruleId":"MOCK-001","path":"app.js","line":1,"severity":"critical","category":"security","title":"eval usage","evidence":"+eval('deleteAll()');"}

event: done
data: {"total":1,"usage":{"inputBytes":76,"chunks":1,"cacheHit":false}}
```

---

## ⚠️ Error Handling & Status Codes

| Status Code | Error Code | Description |
| :--- | :--- | :--- |
| `401` | `unauthorized` | Missing or invalid Bearer authorization token. |
| `409` | `idempotency_conflict` | Idempotency key reused with a different payload. |
| `413` | `payload_too_large` | Diff payload exceeds the 1 MiB size limit. |
| `422` | `invalid_diff` | Diff is missing, empty, or improperly formatted. |
| `429` | `rate_limited` | Exceeded 30 requests per minute limit. |

---

## ⚡ Getting Started Locally

### Prerequisites
* **Node.js:** v18+ 
* **npm:** v9+

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/Amca20/xsolla-diff-review.git](https://github.com/Amca20/xsolla-diff-review.git)
   cd xsolla-diff-review
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables (`.env`):**
   ```env
   PORT=3000
   BEARER_TOKEN=YOUR_SECRET_BEARER_TOKEN
   GEMINI_API_KEY=your_optional_gemini_api_key
   ```

4. **Start the server:**
   ```bash
   node server.js
   ```
