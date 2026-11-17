import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const STATS_FILE: string = path.join(
  os.homedir() || process.env.USERPROFILE || process.env.HOME || '.',
  '.antigravity-ast-slayer-stats.jsonl'
);

export const SUPPORTED_EXTENSIONS = new Set<string>([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
  '.kt',
  '.kts',
  '.dart',
  '.sol',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.swift',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.sql',
  '.graphql',
  '.gql',
  '.md',
  '.mdx',
  '.sh',
  '.bash',
  '.ps1',
  '.bat',
]);

export interface TelemetryRecord {
  timestamp: string;
  file: string;
  language?: string;
  rawTokens?: number;
  optimizedTokens?: number;
  saved?: number;
  cacheHit?: boolean;
  excluded?: boolean;
  severity?: 'HIGH';
  rule?: string;
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
  cacheHitCount: number;
  cacheHitPct: string;
  excludedFiles: number;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.dart': 'dart',
  '.sol': 'solidity',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.ps1': 'powershell',
  '.bat': 'bat',
};

const C_STYLE_LANGUAGES = new Set([
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
  'java',
  'kotlin',
  'dart',
  'solidity',
  'go',
  'rust',
  'c',
  'cpp',
  'csharp',
  'php',
  'swift',
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'graphql',
]);
const HASH_COMMENT_LANGUAGES = new Set([
  'python',
  'ruby',
  'shellscript',
  'powershell',
  'yaml',
  'toml',
]);
const INDENTATION_SENSITIVE_LANGUAGES = new Set([
  'python',
  'ruby',
  'shellscript',
  'powershell',
  'yaml',
  'toml',
]);

export function isSupportedFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isSensitiveFilePath(filePath: string): boolean {
  return /^\.env(?:\..*)?$/i.test(path.basename(filePath));
}

export function detectSensitiveContent(filePath: string, content: string): string | undefined {
  if (isSensitiveFilePath(filePath)) {
    return 'Environment file (.env)';
  }

  const rules: Array<[RegExp, string]> = [
    [/\bAPI[_ -]?KEY\b/i, 'API key pattern'],
    [/\bJWT\b/i, 'JWT pattern'],
    [/\bSECRET\b/i, 'Secret pattern'],
    [/\bPASSWORD\b/i, 'Password pattern'],
    [/\bPRIVATE[_ -]?KEY\b/i, 'Private key pattern'],
    [/\b(?:mongodb(?:\+srv)?|postgres(?:ql)?)\s*:\s*\/\//i, 'Database connection string'],
  ];

  for (const [pattern, description] of rules) {
    if (pattern.test(content)) {
      return description;
    }
  }

  return undefined;
}

export function detectLanguage(filePath: string): string {
  return LANGUAGE_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'plaintext';
}

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

function stripComments(content: string, language: string): string {
  if (language === 'markdown' || language === 'mdx') {
    return content.replace(/<!--[\s\S]*?-->/g, '');
  }

  const htmlComments = ['html', 'xml', 'vue', 'svelte'].includes(language);
  const hashComments = HASH_COMMENT_LANGUAGES.has(language);
  const lineCommentMarkers =
    language === 'sql'
      ? ['--']
      : hashComments
        ? ['#']
        : language === 'php'
          ? ['//', '#']
          : C_STYLE_LANGUAGES.has(language) || language === 'json' || language === 'jsonc'
            ? ['//']
            : [];
  const hashRequiresSpace = language === 'yaml' || language === 'toml';
  const hasLineComments =
    lineCommentMarkers.length > 0;
  const hasCStyleComments =
    C_STYLE_LANGUAGES.has(language) || language === 'json' || language === 'jsonc' || language === 'sql';
  let result = '';
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1] ?? '';

    if (language === 'rust' && char === 'r') {
      const rawStringStart = /^(?:br|r)(#{0,255})"/.exec(content.slice(i));
      if (rawStringStart) {
        const ending = `"${rawStringStart[1]}`;
        const end = content.indexOf(ending, i + rawStringStart[0].length);
        const endIndex = end === -1 ? content.length : end + ending.length;
        result += content.slice(i, endIndex);
        i = endIndex;
        continue;
      }
    }

    if (language === 'csharp' && char === '@' && next === '"') {
      result += '@"';
      i += 2;
      while (i < content.length) {
        if (content.startsWith('""', i)) {
          result += '""';
          i += 2;
          continue;
        }
        result += content[i];
        if (content[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (htmlComments && content.startsWith('<!--', i)) {
      const end = content.indexOf('-->', i + 4);
      if (end === -1) {
        break;
      }
      const comment = content.slice(i, end + 3);
      result += '\n'.repeat((comment.match(/\n/g) ?? []).length);
      i = end + 3;
      continue;
    }

    if (
      hasCStyleComments &&
      char === '/' &&
      next === '*'
    ) {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) {
        break;
      }
      const comment = content.slice(i, end + 2);
      result += '\n'.repeat((comment.match(/\n/g) ?? []).length);
      i = end + 2;
      continue;
    }

    const activeLineComment = lineCommentMarkers.find((marker) => content.startsWith(marker, i));
    if (
      hasLineComments &&
      activeLineComment &&
      (activeLineComment !== '#' ||
        !hashRequiresSpace ||
        i === 0 ||
        /\s/.test(content[i - 1]))
    ) {
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') {
        i++;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      const tripleQuoted =
        ['python', 'ruby', 'swift', 'kotlin', 'java', 'csharp'].includes(language) &&
        (char === "'" || char === '"') &&
        content.startsWith(char.repeat(3), i);
      const delimiter = tripleQuoted ? char.repeat(3) : char;
      result += delimiter;
      i += delimiter.length;

      while (i < content.length) {
        if (content[i] === '\\' && i + 1 < content.length) {
          result += content.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (content.startsWith(delimiter, i)) {
          result += delimiter;
          i += delimiter.length;
          break;
        }
        result += content[i];
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

export function optimizeSource(content: string, filePath: string): OptimizationResult {
  const language = detectLanguage(filePath);
  let processed = stripComments(content, language);

  if (language === 'json' || language === 'jsonc') {
    try {
      processed = JSON.stringify(JSON.parse(processed));
    } catch {
      processed = processed.replace(/\s+/g, ' ').trim();
    }
  } else if (language === 'markdown' || language === 'mdx' || language === 'html' || language === 'xml') {
    processed = processed.replace(/\n{3,}/g, '\n\n').trim();
  } else if (INDENTATION_SENSITIVE_LANGUAGES.has(language)) {
    processed = processed.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  } else {
    processed = processed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
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

export function appendTelemetryRecord(record: TelemetryRecord): void {
  const dir = path.dirname(STATS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(STATS_FILE, JSON.stringify(record) + '\n', 'utf8');
}

export function readTelemetryRecords(): TelemetryRecord[] {
  if (!fs.existsSync(STATS_FILE)) {
    return [];
  }

  return fs
    .readFileSync(STATS_FILE, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line): TelemetryRecord[] => {
      try {
        const record = JSON.parse(line) as TelemetryRecord;
        return record && typeof record.file === 'string' && typeof record.timestamp === 'string'
          ? [record]
          : [];
      } catch {
        return [];
      }
    });
}

export function clearStatsLedger(): void {
  const dir = path.dirname(STATS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(STATS_FILE, '', 'utf8');
}

export function getStatsSummary(records = readTelemetryRecords()): TelemetrySummary {
  const excluded = records.filter((record) => record.excluded);
  const analyzed = records.filter((record) => !record.excluded && !record.cacheHit);
  const cacheHits = records.filter((record) => !record.excluded && record.cacheHit);
  const files = new Set(analyzed.map((record) => record.file));
  const excludedFiles = new Set(excluded.map((record) => record.file));
  const totalRaw = analyzed.reduce((sum, record) => sum + (record.rawTokens ?? 0), 0);
  const totalOptimized = analyzed.reduce(
    (sum, record) => sum + (record.optimizedTokens ?? 0),
    0
  );
  const totalSaved = analyzed.reduce((sum, record) => sum + (record.saved ?? 0), 0);
  const totalLookups = analyzed.length + cacheHits.length;

  return {
    totalOptimizations: analyzed.length,
    totalRawTokens: totalRaw,
    totalOptimizedTokens: totalOptimized,
    totalSavedTokens: totalSaved,
    averageReductionPct: totalRaw > 0 ? ((totalSaved / totalRaw) * 100).toFixed(1) + '%' : '0.0%',
    fileCount: files.size,
    cacheHitCount: cacheHits.length,
    cacheHitPct: totalLookups > 0 ? ((cacheHits.length / totalLookups) * 100).toFixed(1) + '%' : '0.0%',
    excludedFiles: excludedFiles.size,
  };
}

if (process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts'))) {
  if (process.argv.includes('--stats')) {
    const summary = getStatsSummary();
    console.log('=== AST Token Slayer Telemetry Summary ===');
    console.log(`Total Optimizations: ${summary.totalOptimizations}`);
    console.log(`Unique Files Monitored: ${summary.fileCount}`);
    console.log(`Raw Tokens Processed: ${summary.totalRawTokens.toLocaleString()}`);
    console.log(`Optimized Tokens: ${summary.totalOptimizedTokens.toLocaleString()}`);
    console.log(`Tokens Saved: ${summary.totalSavedTokens.toLocaleString()}`);
    console.log(`Reduction: ${summary.averageReductionPct}`);
    console.log(`Ledger Path: ${STATS_FILE}`);
  }
}
