/**
 * Utility untuk parse Unified Diff & jalankan Mock Rules
 * Mengikut spesifikasi rasmi Xsolla Candidate Task
 */

const MOCK_RULES = [
  {
    ruleId: 'MOCK-001',
    severity: 'critical',
    category: 'security',
    title: 'eval usage',
    regex: /\beval\s*\(/
  },
  {
    ruleId: 'MOCK-002',
    severity: 'critical',
    category: 'security',
    title: 'hardcoded credential',
    regex: /(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i
  },
  {
    ruleId: 'MOCK-003',
    severity: 'high',
    category: 'security',
    title: 'SQL string concatenation',
    regex: /(?:SELECT|INSERT|UPDATE|DELETE)\s+.*?\+\s*/i
  },
  {
    ruleId: 'MOCK-004',
    severity: 'high',
    category: 'correctness',
    title: 'swallowed exception',
    regex: /catch\s*\([^)]*\)\s*\{\s*\}/
  },
  {
    ruleId: 'MOCK-005',
    severity: 'medium',
    category: 'correctness',
    title: 'loose null comparison',
    regex: /==\s*null|!=\s*null/
  },
  {
    ruleId: 'MOCK-006',
    severity: 'medium',
    category: 'performance',
    title: 'deep-clone via JSON',
    regex: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/
  },
  {
    ruleId: 'MOCK-007',
    severity: 'low',
    category: 'style',
    title: 'console.log left in',
    regex: /\bconsole\.log\s*\(/
  },
  {
    ruleId: 'MOCK-008',
    severity: 'low',
    category: 'style',
    title: 'unresolved marker',
    regex: /\/\/\s*(?:TODO|FIXME)/i
  },
  {
    ruleId: 'MOCK-INJ',
    severity: 'critical',
    category: 'security',
    title: 'prompt-injection content',
    regex: /ignore previous instructions|disregard all prior|you are now/i
  }
];

function parseDiffAndScan(diffText, maxFindings = 100) {
  if (!diffText || typeof diffText !== 'string') return [];

  const lines = diffText.split('\n');
  const findings = [];
  const seenIds = new Set();

  let currentFile = 'unknown';
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('+++ ')) {
      const match = line.match(/^\+\+\+\s+(?:b\/)?(.+)/);
      if (match) currentFile = match[1].trim();
      continue;
    }

    if (line.startsWith('@@ ')) {
      const match = line.match(/@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) newLineNum = parseInt(match[1], 10) - 1;
      continue;
    }

    if (line.startsWith('--- ')) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      newLineNum++;
      const codeContent = line.substring(1);

      for (const rule of MOCK_RULES) {
        if (rule.regex.test(codeContent)) {
          const id = `${rule.ruleId}:${currentFile}:${newLineNum}`;
          
          if (!seenIds.has(id)) {
            seenIds.add(id);
            findings.push({
              id: id,
              ruleId: rule.ruleId,
              path: currentFile,
              line: newLineNum,
              severity: rule.severity,
              category: rule.category,
              title: rule.title,
              evidence: line.trim()
            });
          }
        }
      }
    } else if (!line.startsWith('-')) {
      newLineNum++;
    }
  }

  // Sorting mengikut spec Xsolla: path -> line -> ruleId
  findings.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.line !== b.line) return a.line - b.line;
    return a.ruleId.localeCompare(b.ruleId);
  });

  return findings.slice(0, maxFindings);
}

module.exports = { parseDiffAndScan };