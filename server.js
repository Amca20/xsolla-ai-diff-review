import express from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.BEARER_TOKEN || 'AMSYAR_XSOLLA_INTERN2026';

// Initialize Gemini API (if key exists)
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// In-Memory Databases
const jobsDb = new Map();
const cacheDb = new Map();
const idempotencyDb = new Map();
const rateLimitMap = new Map();

// Helper to capture raw body for payload size calculation
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// CORS Headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Utility Helper for Structured Errors
function sendError(res, statusCode, code, message) {
  return res.status(statusCode).json({
    error: { code, message }
  });
}

// -------------------------------------------------------------
// Middleware: Bearer Authentication
// -------------------------------------------------------------
app.use((req, res, next) => {
  if (req.path === '/health') return next();

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'unauthorized', 'Missing or invalid authorization token');
  }

  const token = authHeader.split(' ')[1];
  if (token !== AUTH_TOKEN) {
    return sendError(res, 401, 'unauthorized', 'Invalid authorization token');
  }

  next();
});

// -------------------------------------------------------------
// GET /health
// -------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Helper: Calculate diff chunks
function calculateChunks(diffText) {
  const lines = diffText.split('\n');
  let chunks = 0;
  for (const line of lines) {
    if (line.startsWith('@@')) chunks++;
  }
  return chunks || 1;
}

// Mock Engine Scanning Logic
function runMockAnalysis(diff) {
  const findings = [];
  const lines = diff.split('\n');
  
  lines.forEach((line, idx) => {
    if (line.startsWith('+') && line.includes('eval(')) {
      findings.push({
        id: `MOCK-${String(findings.length + 1).padStart(3, '0')}:app.js:${idx + 1}`,
        ruleId: 'MOCK-001',
        path: 'app.js',
        line: idx + 1,
        severity: 'critical',
        category: 'security',
        title: 'eval usage',
        evidence: line
      });
    }
  });

  return findings;
}

// Background Processing Function
async function processJobInBackground(jobId) {
  const job = jobsDb.get(jobId);
  if (!job) return;

  job.status = 'running';

  try {
    if (job.provider === 'mock') {
      job.findings = runMockAnalysis(job.diff);
    } else if (job.provider === 'llm' && genAI) {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `You are a code review tool. Analyze this unified diff and respond with JSON array of security/quality findings. Each item must have: id, ruleId, path, line, severity, category, title, evidence.\n\nDiff:\n${job.diff}`;
      
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      
      try {
        const jsonStart = text.indexOf('[');
        const jsonEnd = text.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          job.findings = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
        }
      } catch (e) {
        job.findings = [];
      }
    }
    
    job.status = 'done';

    // SIMPAN KE CACHE BILA PROSES DAH BETUL-BETUL DONE
    if (job.cacheKey) {
      cacheDb.set(job.cacheKey, job);
    }
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
  }
}

// -------------------------------------------------------------
// POST /v1/reviews
// -------------------------------------------------------------
app.post('/v1/reviews', (req, res) => {
  // Rate Limiter Check
  const clientIp = req.ip;
  const now = Date.now();
  const userRate = rateLimitMap.get(clientIp) || { count: 0, resetAt: now + 60000 };

  if (now > userRate.resetAt) {
    userRate.count = 0;
    userRate.resetAt = now + 60000;
  }

  if (userRate.count >= 30) {
    res.setHeader('Retry-After', '60');
    return sendError(res, 429, 'rate_limited', 'Rate limit exceeded. Try again later.');
  }
  userRate.count++;
  rateLimitMap.set(clientIp, userRate);

  // Payload Size Check
  const payloadBytes = req.rawBody ? req.rawBody.length : Buffer.byteLength(JSON.stringify(req.body));
  if (payloadBytes > 1048576) {
    return sendError(res, 413, 'payload_too_large', 'Payload exceeds 1 MiB limit');
  }

  const { diff, options } = req.body;
  if (!diff || typeof diff !== 'string' || diff.trim() === '') {
    return sendError(res, 422, 'invalid_diff', 'Unified diff is missing or invalid');
  }

  const provider = options?.provider || 'mock';
  const maxFindings = options?.maxFindings || 100;

  if (provider !== 'mock' && provider !== 'llm') {
    return sendError(res, 422, 'invalid_diff', 'Invalid provider value');
  }

  // Idempotency Check
  const idempotencyKey = req.headers['idempotency-key'];
  const bodyHash = crypto.createHash('sha256').update(req.rawBody || JSON.stringify(req.body)).digest('hex');

  if (idempotencyKey) {
    if (idempotencyDb.has(idempotencyKey)) {
      const existing = idempotencyDb.get(idempotencyKey);
      if (existing.hash === bodyHash) {
        return res.status(202).json({ jobId: existing.jobId, status: existing.status });
      } else {
        return sendError(res, 409, 'idempotency_conflict', 'Idempotency key reused with different payload');
      }
    }
  }

  // Cache Check (Bila Jumpa Cache)
  const cacheKey = `${provider}:${maxFindings}:${bodyHash}`;
  if (cacheDb.has(cacheKey)) {
    const existingJob = cacheDb.get(cacheKey);
    const cachedJobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    
    // Salin data job asal dan set cacheHit: true secara khusus untuk stream replay
    const cachedJob = {
      ...existingJob,
      jobId: cachedJobId,
      status: 'done',
      usage: { ...existingJob.usage, cacheHit: true }
    };

    jobsDb.set(cachedJobId, cachedJob);
    return res.status(202).json({ jobId: cachedJobId, status: 'done' });
  }

  // First Run (Bukan Cache)
  const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const inputBytes = Buffer.byteLength(diff);
  const chunks = calculateChunks(diff);

  const newJob = {
    jobId,
    cacheKey,
    status: 'queued',
    diff,
    provider,
    maxFindings,
    findings: [],
    usage: { inputBytes, chunks, cacheHit: false }, // FIRST RUN SENTIASA FALSE
    createdAt: new Date()
  };

  jobsDb.set(jobId, newJob);

  if (idempotencyKey) {
    idempotencyDb.set(idempotencyKey, { hash: bodyHash, jobId, status: 'queued' });
  }

  setImmediate(() => processJobInBackground(jobId));

  return res.status(202).json({ jobId, status: 'queued' });
});

// -------------------------------------------------------------
// GET /v1/reviews/:id/stream (SSE Endpoint)
// -------------------------------------------------------------
app.get('/v1/reviews/:id/stream', (req, res) => {
  const { id } = req.params;
  const job = jobsDb.get(id);

  if (!job) {
    return sendError(res, 404, 'not_found', 'Job not found');
  }

  // SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Jika Job Dah Selesai (Sama ada First Run yang pantas atau Stream Replay)
  if (job.status === 'done') {
    sendEvent('status', { status: 'running' });
    job.findings.forEach(f => sendEvent('finding', f));
    sendEvent('done', { total: job.findings.length, usage: job.usage });
    return res.end();
  }

  if (job.status === 'failed') {
    sendEvent('status', { status: 'failed', error: job.error });
    return res.end();
  }

  // Jika Job Masih Bertakung/Sedang Berjalan (Real-time Stream polling)
  sendEvent('status', { status: 'running' });

  const interval = setInterval(() => {
    const currentJob = jobsDb.get(id);
    if (!currentJob) {
      clearInterval(interval);
      return res.end();
    }

    if (currentJob.status === 'done') {
      clearInterval(interval);
      currentJob.findings.forEach(f => sendEvent('finding', f));
      sendEvent('done', { total: currentJob.findings.length, usage: currentJob.usage });
      res.end();
    } else if (currentJob.status === 'failed') {
      clearInterval(interval);
      sendEvent('status', { status: 'failed', error: currentJob.error });
      res.end();
    }
  }, 300);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Xsolla AI Review Server active on port ${PORT}`);
});