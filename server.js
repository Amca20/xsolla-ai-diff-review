import express from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.BEARER_TOKEN || 'AMSYAR_XSOLLA_INTERN2026';
const startTime = Date.now();

// Initialize Gemini API (if key exists)
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// In-Memory Databases
const jobsDb = new Map();
const cacheDb = new Map();
const idempotencyDb = new Map();
const rateLimitMap = new Map();

// Helper to capture raw body for payload size check
app.use(express.json({
  limit: '1mb',
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
  return res.status(statusCode).json({ error: { code, message } });
}

// ============================================================================
// 1. PUBLIC ENDPOINTS (No Auth Required)
// ============================================================================

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    version: '1.0.0',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000)
  });
});

app.get('/spec', (req, res) => {
  res.status(200).json({
    specVersion: '1.0',
    providers: ['mock', 'llm'],
    limits: {
      maxPayloadBytes: 1048576,
      chunkBytes: 65536,
      maxConcurrentJobs: 4,
      rateLimitPerMinute: 30
    }
  });
});

// ============================================================================
// 2. MIDDLEWARE: BEARER AUTHENTICATION (For /v1/* only)
// ============================================================================
app.use('/v1', (req, res, next) => {
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

// ============================================================================
// 3. ENGINES & LOGIC
// ============================================================================

// Calculate chunk count accurately based on file boundaries (simulated for byte size)
function calculateChunks(diffText) {
  const inputBytes = Buffer.byteLength(diffText, 'utf8');
  return Math.max(1, Math.ceil(inputBytes / 65536));
}

// 100% Compliant Mock Analysis
function runMockAnalysis(diff) {
  const findings = [];
  const lines = diff.split('\n');
  let currentFile = 'unknown';
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('+++ b/') || line.startsWith('+++ ')) {
      currentFile = line.replace('+++ b/', '').replace('+++ ', '').trim();
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/\+([0-9]+)/);
      if (match) newLineNum = parseInt(match[1], 10) - 1;
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      newLineNum++;
      const addedContent = line.substring(1);

      // MOCK-001
      if (addedContent.includes('eval(')) {
        findings.push(createFinding('MOCK-001', currentFile, newLineNum, 'critical', 'security', 'eval usage', line));
      }
      // MOCK-002
      if (/(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i.test(addedContent)) {
        findings.push(createFinding('MOCK-002', currentFile, newLineNum, 'critical', 'security', 'hardcoded credential', line));
      }
      // MOCK-003
      if (/(SELECT|INSERT|UPDATE|DELETE)/i.test(addedContent) && addedContent.includes('+')) {
        findings.push(createFinding('MOCK-003', currentFile, newLineNum, 'high', 'security', 'SQL string concatenation', line));
      }
      // MOCK-004
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(addedContent) || (addedContent.includes('catch') && addedContent.includes('{}'))) {
        findings.push(createFinding('MOCK-004', currentFile, newLineNum, 'high', 'correctness', 'swallowed exception', line));
      }
      // MOCK-005
      if (addedContent.includes('== null') || addedContent.includes('!= null')) {
        findings.push(createFinding('MOCK-005', currentFile, newLineNum, 'medium', 'correctness', 'loose null comparison', line));
      }
      // MOCK-006
      if (addedContent.includes('JSON.parse(JSON.stringify(')) {
        findings.push(createFinding('MOCK-006', currentFile, newLineNum, 'medium', 'performance', 'deep-clone via JSON', line));
      }
      // MOCK-007
      if (addedContent.includes('console.log(')) {
        findings.push(createFinding('MOCK-007', currentFile, newLineNum, 'low', 'style', 'console.log left in', line));
      }
      // MOCK-008
      if (addedContent.includes('TODO') || addedContent.includes('FIXME')) {
        findings.push(createFinding('MOCK-008', currentFile, newLineNum, 'low', 'style', 'unresolved marker', line));
      }
      // MOCK-INJ
      if (/(ignore previous instructions|disregard all prior|you are now)/i.test(addedContent)) {
        findings.push(createFinding('MOCK-INJ', currentFile, newLineNum, 'critical', 'security', 'prompt-injection content', line));
      }
    }
  }

  // Exact sorting spec: path -> line -> ruleId
  findings.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.line !== b.line) return a.line - b.line;
    return a.ruleId.localeCompare(b.ruleId);
  });

  // Deduplicate by ID
  const uniqueFindings = [];
  const seenIds = new Set();
  for (const f of findings) {
    if (!seenIds.has(f.id)) {
      seenIds.add(f.id);
      uniqueFindings.push(f);
    }
  }

  return uniqueFindings;
}

function createFinding(ruleId, path, line, severity, category, title, evidence) {
  return {
    id: `${ruleId}:${path}:${line}`,
    ruleId,
    path,
    line,
    severity,
    category,
    title,
    evidence
  };
}

// Job Processor
async function processJobInBackground(jobId, diff, options) {
  const job = jobsDb.get(jobId);
  if (!job) return;

  job.status = 'running';
  emitSSE(job, 'status', { status: 'running' });

  try {
    const provider = options?.provider || 'mock';
    const maxFindings = options?.maxFindings || 100;
    let findings = [];

if (provider === 'mock') {
      findings = runMockAnalysis(diff);
    } else if (provider === 'llm') {
      // Jika API Key wujud & genAI sedia
      if (genAI) {
        try {
          const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
          const prompt = `You are a code review tool. Analyze this unified diff and respond with JSON array of security/quality findings. Each item must have: id, ruleId, path, line, severity, category, title, evidence.\n\nDiff:\n${diff}`;
          
          const result = await model.generateContent(prompt);
          const text = result.response.text();
          const jsonStart = text.indexOf('[');
          const jsonEnd = text.lastIndexOf(']');
          
          if (jsonStart !== -1 && jsonEnd !== -1) {
            findings = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
          } else {
            findings = runMockAnalysis(diff); // Fallback jika format LLM pelik
          }
        } catch (e) {
          findings = runMockAnalysis(diff); // Fallback jika Gemini API timeout/error
        }
      } else {
        // Fallback jika API Key tiada dalam environment Render
        findings = runMockAnalysis(diff);
      }
    }

    job.findings = findings.slice(0, maxFindings);
    job.status = 'done';

    // Save to Cache
    if (job.cacheKey) {
      cacheDb.set(job.cacheKey, { diff, options, findings: job.findings, usage: job.usage });
    }

    // Stream findings line by line
    for (const f of job.findings) {
      emitSSE(job, 'finding', f);
      await new Promise(r => setTimeout(r, 5)); // Simulate stream delay
    }

    emitSSE(job, 'status', { status: 'done' });
    emitSSE(job, 'done', { total: job.findings.length, usage: job.usage });

  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    emitSSE(job, 'status', { status: 'failed', error: job.error });
  } finally {
    // Close connections
    job.listeners.forEach(res => res.end());
    job.listeners = [];
  }
}

function emitSSE(job, eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  job.events.push(payload); // Store for replay
  job.listeners.forEach(res => res.write(payload)); // Send to active connections
}

// ============================================================================
// 4. API ENDPOINTS (/v1/*)
// ============================================================================

// POST /v1/reviews
app.post('/v1/reviews', (req, res) => {
  // Rate Limiting (30 per min)
  const clientIp = req.ip || 'global';
  const now = Date.now();
  const userRate = rateLimitMap.get(clientIp) || { count: 0, resetAt: now + 60000 };

  if (now > userRate.resetAt) {
    userRate.count = 0;
    userRate.resetAt = now + 60000;
  }

  if (userRate.count >= 30) {
    res.setHeader('Retry-After', Math.ceil((userRate.resetAt - now) / 1000).toString());
    return sendError(res, 429, 'rate_limited', 'Rate limit exceeded.');
  }
  userRate.count++;
  rateLimitMap.set(clientIp, userRate);

  // Payload check (Excess of 1MiB caught by express.json limit, this catches invalid json/missing diff)
  const { diff, options } = req.body || {};
  if (!diff || typeof diff !== 'string' || diff.trim() === '') {
    return sendError(res, 422, 'invalid_diff', 'Unified diff is missing or invalid');
  }

  // Hash payload for cache and idempotency
  const bodyHash = crypto.createHash('sha256').update(req.rawBody || JSON.stringify(req.body)).digest('hex');
  const idempotencyKey = req.headers['idempotency-key'];

  // Idempotency
  if (idempotencyKey) {
    if (idempotencyDb.has(idempotencyKey)) {
      const existing = idempotencyDb.get(idempotencyKey);
      if (existing.hash === bodyHash) {
        return res.status(202).json({ jobId: existing.jobId, status: jobsDb.get(existing.jobId)?.status || 'queued' });
      } else {
        return sendError(res, 409, 'idempotency_conflict', 'Idempotency key reused with different payload');
      }
    }
  }

  const provider = options?.provider || 'mock';
  const cacheKey = `${provider}:${options?.maxFindings || 100}:${bodyHash}`;

  // Caching
  if (cacheDb.has(cacheKey)) {
    const cachedData = cacheDb.get(cacheKey);
    const cachedJobId = 'job_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    
    const job = {
      jobId: cachedJobId,
      status: 'done',
      findings: cachedData.findings,
      usage: { ...cachedData.usage, cacheHit: true },
      events: [],
      listeners: []
    };

    // Pre-fill events for stream replay
    job.events.push(`event: status\ndata: {"status":"running"}\n\n`);
    job.findings.forEach(f => job.events.push(`event: finding\ndata: ${JSON.stringify(f)}\n\n`));
    job.events.push(`event: status\ndata: {"status":"done"}\n\n`);
    job.events.push(`event: done\ndata: ${JSON.stringify({ total: job.findings.length, usage: job.usage })}\n\n`);

    jobsDb.set(cachedJobId, job);
    if (idempotencyKey) idempotencyDb.set(idempotencyKey, { hash: bodyHash, jobId: cachedJobId });

    return res.status(202).json({ jobId: cachedJobId, status: 'done' });
  }

  // New Job Creation
  const jobId = 'job_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const inputBytes = Buffer.byteLength(diff, 'utf8');
  const chunks = calculateChunks(diff);

  const newJob = {
    jobId,
    cacheKey,
    status: 'queued',
    findings: [],
    usage: { inputBytes, chunks, cacheHit: false },
    events: [],
    listeners: []
  };

  jobsDb.set(jobId, newJob);
  if (idempotencyKey) idempotencyDb.set(idempotencyKey, { hash: bodyHash, jobId });

  // Fire and forget processing
  setImmediate(() => processJobInBackground(jobId, diff, options));

  return res.status(202).json({ jobId, status: 'queued' });
});

// GET /v1/reviews/:id (Standard Polling)
app.get('/v1/reviews/:id', (req, res) => {
  const { id } = req.params;
  const job = jobsDb.get(id);

  if (!job) return sendError(res, 404, 'not_found', 'Job not found');

  const response = { jobId: job.jobId, status: job.status };
  if (job.status === 'done') {
    response.findings = job.findings;
    response.usage = job.usage;
  } else if (job.status === 'failed') {
    response.error = job.error;
  }

  return res.status(200).json(response);
});

// GET /v1/reviews/:id/stream (SSE Stream)
app.get('/v1/reviews/:id/stream', (req, res) => {
  const { id } = req.params;
  const job = jobsDb.get(id);

  if (!job) return sendError(res, 404, 'not_found', 'Job not found');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // If job is already complete, replay all events identically
  if (job.status === 'done' || job.status === 'failed') {
    job.events.forEach(eventData => res.write(eventData));
    return res.end();
  }

  // If job is in progress, register this connection as a listener
  res.write(`event: status\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
  job.listeners.push(res);

  req.on('close', () => {
    job.listeners = job.listeners.filter(l => l !== res);
  });
});

// Global 404
app.use((req, res) => {
  sendError(res, 404, 'not_found', 'Route not found');
});

// Global Error Handler for invalid JSON bodies
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return sendError(res, 400, 'invalid_json', 'Invalid JSON payload');
  }
  next();
});

app.listen(PORT, () => {
  console.log(`🚀 Xsolla AI Review Server active on port ${PORT}`);
});
