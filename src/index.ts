import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Path to the centralized AST Slayer telemetry ledger file in the user's home directory.
 */
export const STATS_FILE: string = path.join(
  os.homedir() || process.env.USERPROFILE || process.env.HOME || '.',
  '.antigravity-ast-slayer-stats.jsonl'
);

/**
 * Set of supported file extensions analyzed by AST Slayer.
 */
export const SUPPORTED_EXTENSIONS = new Set<string>([
  '.ts',
  '.tsx',
  '.js',
  '.dart',
  '.sol',
  '.json',
  '.md',
]);

export interface TelemetryRecord {
  timestamp: string;
  file: string;
  language: string;
  rawTokens: number;
  optimizedTokens: number;
  saved: number;
}

export interface OptimizationResult {
  filePath: string;
  language: string;
  rawTokens: number;
  optimizedTokens: number;
  saved: number;
  reductionPct: string;
  optimizedCode: string;
}

export interface TelemetrySummary {
  totalOptimizations: number;
  totalRawTokens: number;
  totalOptimizedTokens: number;
  totalSavedTokens: number;
  averageReductionPct: string;
  fileCount: number;
}

/**
 * Checks whether a given file path is supported by AST Slayer based on its extension.
 */
export function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Detects the language family for appropriate AST comment stripping and compaction.
 */
export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'typescriptreact';
    case '.js':
      return 'javascript';
    case '.dart':
      return 'dart';
    case '.sol':
      return 'solidity';
    case '.json':
      return 'json';
    case '.md':
      return 'markdown';
    default:
      return 'plaintext';
  }
}

/**
 * Computes an estimated token count (~4 characters per token).
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/**
 * Strips comments from C-style and similar syntax (JS, TS, Dart, Solidity),
 * safely preserving string literals ('...', "...", `...`).
 */
function stripCStyleComments(content: string): string {
  let result = '';
  let i = 0;
  const len = content.length;

  while (i < len) {
    const char = content[i];
    const nextChar = i + 1 < len ? content[i + 1] : '';

    // Handle single-line strings '...'
    if (char === "'") {
      result += char;
      i++;
      while (i < len) {
        const c = content[i];
        result += c;
        if (c === '\\' && i + 1 < len) {
          result += content[i + 1];
          i += 2;
          continue;
        }
        if (c === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Handle double-line strings "..."
    if (char === '"') {
      result += char;
      i++;
      while (i < len) {
        const c = content[i];
        result += c;
        if (c === '\\' && i + 1 < len) {
          result += content[i + 1];
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Handle template literals `...`
    if (char === '`') {
      result += char;
      i++;
      while (i < len) {
        const c = content[i];
        result += c;
        if (c === '\\' && i + 1 < len) {
          result += content[i + 1];
          i += 2;
          continue;
        }
        if (c === '`') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Handle single-line comment //
    if (char === '/' && nextChar === '/') {
      i += 2;
      while (i < len && content[i] !== '\n' && content[i] !== '\r') {
        i++;
      }
      continue;
    }

    // Handle multi-line comment /* ... */
    if (char === '/' && nextChar === '*') {
      i += 2;
      while (i < len && !(content[i] === '*' && i + 1 < len && content[i + 1] === '/')) {
        i++;
      }
      i += 2; // skip * and /
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Optimizes structural AST representation for the code file by stripping
 * comments and collapsing redundant whitespace.
 */
export function optimizeSource(content: string, filePath: string): OptimizationResult {
  const language = detectLanguage(filePath);
  let processed = content;

  if (['typescript', 'typescriptreact', 'javascript', 'dart', 'solidity'].includes(language)) {
    processed = stripCStyleComments(processed);
    // Collapse consecutive whitespace on lines while keeping code structure readable
    processed = processed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
  } else if (language === 'json') {
    try {
      const parsed = JSON.parse(stripCStyleComments(processed));
      processed = JSON.stringify(parsed);
    } catch {
      processed = stripCStyleComments(processed)
        .replace(/\s+/g, ' ')
        .trim();
    }
  } else if (language === 'markdown') {
    // Strip HTML comments <!-- ... --> and collapse excess whitespace
    processed = processed.replace(/<!--[\s\S]*?-->/g, '');
    processed = processed.replace(/\n{3,}/g, '\n\n').trim();
  } else {
    // Generic whitespace collapsing
    processed = processed.replace(/\s+/g, ' ').trim();
  }

  const rawTokens = estimateTokens(content);
  const optimizedTokens = estimateTokens(processed);
  const saved = Math.max(0, rawTokens - optimizedTokens);
  const reductionPct = rawTokens > 0 ? ((saved / rawTokens) * 100).toFixed(1) + '%' : '0.0%';

  return {
    filePath,
    language,
    rawTokens,
    optimizedTokens,
    saved,
    reductionPct,
    optimizedCode: processed,
  };
}

/**
 * Appends a single optimization telemetry record to the JSONL stats ledger.
 */
export function appendTelemetryRecord(record: TelemetryRecord): void {
  try {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(STATS_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (error) {
    console.error('AST Slayer: Failed to append telemetry record to stats ledger', error);
  }
}

/**
 * Reads and aggregates the full telemetry summary from the JSONL stats ledger.
 */
export function getStatsSummary(): TelemetrySummary {
  if (!fs.existsSync(STATS_FILE)) {
    return {
      totalOptimizations: 0,
      totalRawTokens: 0,
      totalOptimizedTokens: 0,
      totalSavedTokens: 0,
      averageReductionPct: '0.0%',
      fileCount: 0,
    };
  }

  try {
    const raw = fs.readFileSync(STATS_FILE, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const files = new Set<string>();

    let totalRaw = 0;
    let totalOptimized = 0;
    let totalSaved = 0;

    for (const line of lines) {
      try {
        const item = JSON.parse(line) as TelemetryRecord;
        totalRaw += item.rawTokens || 0;
        totalOptimized += item.optimizedTokens || 0;
        totalSaved += item.saved || 0;
        if (item.file) {
          files.add(item.file);
        }
      } catch {
        // Skip malformed records
      }
    }

    const pct = totalRaw > 0 ? ((totalSaved / totalRaw) * 100).toFixed(1) + '%' : '0.0%';

    return {
      totalOptimizations: lines.length,
      totalRawTokens: totalRaw,
      totalOptimizedTokens: totalOptimized,
      totalSavedTokens: totalSaved,
      averageReductionPct: pct,
      fileCount: files.size,
    };
  } catch (error) {
    console.error('AST Slayer: Error reading telemetry stats', error);
    return {
      totalOptimizations: 0,
      totalRawTokens: 0,
      totalOptimizedTokens: 0,
      totalSavedTokens: 0,
      averageReductionPct: '0.0%',
      fileCount: 0,
    };
  }
}

// Standalone CLI support for background inspection & debugging
if (process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts'))) {
  if (process.argv.includes('--stats')) {
    const summary = getStatsSummary();
    console.log('=== AST Slayer Telemetry Summary ===');
    console.log(`Total Optimizations: ${summary.totalOptimizations}`);
    console.log(`Unique Files Monitored: ${summary.fileCount}`);
    console.log(`Raw Tokens Processed: ${summary.totalRawTokens.toLocaleString()}`);
    console.log(`Optimized Tokens: ${summary.totalOptimizedTokens.toLocaleString()}`);
    console.log(`Tokens Saved: ${summary.totalSavedTokens.toLocaleString()}`);
    console.log(`Reduction: ${summary.averageReductionPct}`);
    console.log(`Ledger Path: ${STATS_FILE}`);
  }
}
