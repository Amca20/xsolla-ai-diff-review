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

// Accurate Chunking: Splits diffs over 64 KiB on file boundaries
function calculateChunks(diffText) {
  const inputBytes = Buffer.byteLength(diffText, 'utf8');
  if (inputBytes <= 65536) return 1;

  const fileDiffs = diffText.split(/(?=^diff --git )|(?=^--- )/m).filter(Boolean);
  let chunkCount = 0;
  let currentChunkBytes = 0;

  for (const fileDiff of fileDiffs) {
    const fileBytes = Buffer.byteLength(fileDiff, 'utf8');
    if (currentChunkBytes + fileBytes > 65536 && currentChunkBytes > 0) {
      chunkCount++;
      currentChunkBytes = fileBytes;
    } else {
      currentChunkBytes += fileBytes;
    }
  }
  if (currentChunkBytes > 0) chunkCount++;

  return Math.max(1, chunkCount);
}

// 100% Compliant Mock Analysis according to Xsolla Table Specs
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

    // Rules apply ONLY to added lines ('+' excluding header '+++')
    if (line.startsWith('+') && !line.startsWith('+++')) {
      newLineNum++;
      const addedContent = line.substring(1);

      // MOCK-001
      if (addedContent.includes('eval(')) {
        findings.push(createFinding('MOCK-001', currentFile, newLineNum, 'critical', 'security', 'eval usage', addedContent));
      }
      // MOCK-002
      if (/(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i.test(addedContent)) {
        findings.push(createFinding('MOCK-002', currentFile, newLineNum, 'critical', 'security', 'hardcoded credential', addedContent));
      }
      // MOCK-003
      if (/(SELECT|INSERT|UPDATE|DELETE)/i.test(addedContent) && addedContent.includes('+')) {
        findings.push(createFinding('MOCK-003', currentFile, newLineNum, 'high', 'security', 'SQL string concatenation', addedContent));
      }
      // MOCK-004
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(addedContent) || (addedContent.includes('catch') && addedContent.includes('{}'))) {
        findings.push(createFinding('MOCK-004', currentFile, newLineNum, 'high', 'correctness', 'swallowed exception', addedContent));
      }
      // MOCK-005
      if (addedContent.includes('== null') || addedContent.includes('!= null')) {
        findings.push(createFinding('MOCK-005', currentFile, newLineNum, 'medium', 'correctness', 'loose null comparison', addedContent));
      }
      // MOCK-006
      if (addedContent.includes('JSON.parse(JSON.stringify(')) {
        findings.push(createFinding('MOCK-006', currentFile, newLineNum, 'medium', 'performance', 'deep-clone via JSON', addedContent));
      }
      // MOCK-007
      if (addedContent.includes('console.log(')) {
        findings.push(createFinding('MOCK-007', currentFile, newLineNum, 'low', 'style', 'console.log left in', addedContent));
      }
      // MOCK-008
      if (addedContent.includes('TODO') || addedContent.includes('FIXME')) {
        findings.push(createFinding('MOCK-008', currentFile, newLineNum, 'low', 'style', 'unresolved marker', addedContent));
      }
      // MOCK-INJ (Inert prompt injection detection)
      if (/(ignore previous instructions|disregard all prior|you are now)/i.test(addedContent)) {
        findings.push(createFinding('MOCK-INJ', currentFile, newLineNum, 'critical', 'security', 'prompt-injection content', addedContent));
      }
    }
  }

  // Exact sorting spec: path (lexicographic) -> line (ascending) -> ruleId
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

// Asynchronous Job Processor
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
      // Direct Spec Rule: LLM must cleanly fail if unreachable or unconfigured
      if (!genAI) {
        throw new Error('LLM provider is not configured on the server (missing GEMINI_API_KEY).');
      }

      try {
        // [Bug Fix 1] Updated Model Name
        const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });
        const prompt = `You are a code review tool. Analyze this unified diff and respond strictly with a valid JSON array of security/quality findings. Each item must have: id, ruleId, path, line, severity, category, title, evidence.\n\nDiff:\n${diff}`;
        
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonStart = text.indexOf('[');
        const jsonEnd = text.lastIndexOf(']');
        
        if (jsonStart !== -1 && jsonEnd !== -1) {
          findings = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
        } else {
          throw new Error('LLM response format was not a valid JSON array.');
        }
      } catch (e) {
        throw new Error(`LLM provider error: ${e.message}`);
      }
    }

    job.findings = findings.slice(0, maxFindings);
    job.status = 'done';

    // [Bug Fix 2] Save to Cache with full usage payload
    if (job.cacheKey) {
      cacheDb.set(job.cacheKey, { 
        diff, 
        options, 
        findings: job.findings, 
        usage: { ...job.usage, cacheHit: false } 
      });
    }

    // Stream findings line by line
    for (const f of job.findings) {
      emitSSE(job, 'finding', f);
      await new Promise(r => setTimeout(r, 5)); // Simulate stream delay
    }

    emitSSE(job, 'status', { status: 'done' });
    emitSSE(job, 'done', { total: job.findings.length, usage: job.usage });

  } catch (err) {
    // Graceful Job Failure (Never crash the Express server)
    job.status = 'failed';
    job.error = err.message;
    emitSSE(job, 'status', { status: 'failed', error: job.error });
  } finally {
    // Close active listener connections
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
  // Rate Limiting (30 submissions per minute max)
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

  // [Bug Fix 3] Payload & Unified Diff Verification
  const { diff, options } = req.body || {};
  const isHeaderValid = typeof diff === 'string' && diff.trim().length > 0;
  const isUnifiedDiff = isHeaderValid && (
    diff.includes('@@') || 
    diff.includes('--- ') || 
    diff.includes('+++ ') || 
    diff.includes('diff --git')
  );

  if (!isUnifiedDiff) {
    return sendError(res, 422, 'invalid_diff', 'Unified diff is missing, empty, or not parseable as a unified diff');
  }

  // Hash payload for cache and idempotency checks
  const bodyHash = crypto.createHash('sha256').update(req.rawBody || JSON.stringify(req.body)).digest('hex');
  const idempotencyKey = req.headers['idempotency-key'];

  // Idempotency execution
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

  // Caching execution
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

  // Fire-and-forget async processing
  setImmediate(() => processJobInBackground(jobId, diff, options));

  return res.status(202).json({ jobId, status: 'queued' });
});

// GET /v1/reviews/:id (Polling Endpoint)
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

// GET /v1/reviews/:id/stream (SSE Endpoint)
app.get('/v1/reviews/:id/stream', (req, res) => {
  const { id } = req.params;
  const job = jobsDb.get(id);

  if (!job) return sendError(res, 404, 'not_found', 'Job not found');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Replay all events if job is already finished/failed
  if (job.status === 'done' || job.status === 'failed') {
    job.events.forEach(eventData => res.write(eventData));
    return res.end();
  }

  // Register live listener
  res.write(`event: status\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
  job.listeners.push(res);

  req.on('close', () => {
    job.listeners = job.listeners.filter(l => l !== res);
  });
});

// Global 404 Handler
app.use((req, res) => {
  sendError(res, 404, 'not_found', 'Route not found');
});

// Global Error Handler for Invalid JSON & Payload Size Limits
app.use((err, req, res, next) => {
  // 1. Handle Payload > 1 MiB (HTTP 413)
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return sendError(res, 413, 'payload_too_large', 'Payload exceeds maximum allowed size of 1 MiB');
  }

  // 2. Handle Invalid JSON Body (HTTP 400)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return sendError(res, 400, 'invalid_json', 'Invalid JSON payload');
  }

  return sendError(res, 500, 'internal', err.message || 'Internal server error');
});

app.listen(PORT, () => {
  console.log(`🚀 Xsolla AI Review Server active on port ${PORT}`);
});
