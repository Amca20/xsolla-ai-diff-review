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

When using `"provider": "mock"`, the engine scans added diff lines (`+`) against predefined deterministic static analysis rules:

| Rule ID | Category | Severity | Detection Pattern | Description / Title |
| :--- | :--- | :--- | :--- | :--- |
| `MOCK-001` | `security` | `critical` | `eval(...)` | Unsafe dynamic code execution (`eval usage`) |
| `MOCK-002` | `security` | `high` | `exec(...)` / `execSync(...)` | Potential Command Injection risk via child process execution |
| `MOCK-003` | `security` | `medium` | `.innerHTML =` | Cross-Site Scripting (XSS) vulnerability |
| `MOCK-004` | `security` | `high` | `password\s*=` / `secret\s*=` | Hardcoded credential or secret detected |
| `MOCK-005` | `style` | `low` | `console.log(...)` | Leftover debugging statement |

---

## 🛠️ API Reference

### 1. Submit Code Review Job
`POST /v1/reviews`

#### Headers
| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `Authorization` | String | **Yes** | `Bearer AMSYAR_XSOLLA_INTERN2026` |
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
| `Authorization` | String | **Yes** | `Bearer AMSYAR_XSOLLA_INTERN2026` |

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
   BEARER_TOKEN=AMSYAR_XSOLLA_INTERN2026
   GEMINI_API_KEY=your_optional_gemini_api_key
   ```

4. **Start the server:**
   ```bash
   npm start
   ```
