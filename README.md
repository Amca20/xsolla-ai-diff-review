# 🛡️ AI-Powered Code Reviewer Service

A lightweight, high-performance Node.js backend service built for the Xsolla Technical Assessment. It provides asynchronous code diff scanning with both deterministic static analysis (Mock Rules) and AI-driven security evaluation (Google Gemini API).

---

## ✨ Features

- **Dual Engine Reviewer:**
  - `mock`: Fast, deterministic static rule checks (`MOCK-001` through `MOCK-INJ`) with precise line and code detection.
  - `llm`: Smart dynamic code auditing powered by Google Gemini AI.
- **Real-Time SSE Streaming:** Live progress updates via Server-Sent Events (`event: status`, `event: finding`, `event: done`) with full event-replay support for completed jobs.
- **Idempotency Guard:** `Idempotency-Key` header validation with SHA-256 payload hashing to prevent duplicate jobs and return `409 Conflict` on payload mismatches.
- **Performance Caching:** Instant response (`cacheHit: true`) for repeated identical diff requests.
- **Robust Security & Rate Limiting:** Enforces strict Bearer Token Authentication across all `/v1/*` routes and protects endpoints against spam (30 requests/minute).
- **Smart Chunking:** Gracefully handles large diffs (>64 KiB) by splitting along file boundaries.

---

## 🛠️ Prerequisites & Installation

### Requirements
- **Node.js**: `v18.x` or higher
- **npm**: `v9.x` or higher

### 1. Clone the Repository
```bash
git clone [https://github.com/Amca20/xsolla-ai-diff-review.git](https://github.com/Amca20/xsolla-ai-diff-review.git)
cd xsolla-ai-diff-review
```

## 🛠️ Setup & Running

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Setup:**
   Buat fail `.env` dalam root folder dan masukkan:
   ```env
   PORT=3000
   BEARER_TOKEN=AMSYAR_XSOLLA_INTERN2026
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **Run Server:**
   ```bash
   node server.js
   ```
