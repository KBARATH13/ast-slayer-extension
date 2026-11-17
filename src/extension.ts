import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  SUPPORTED_EXTENSIONS,
  STATS_FILE,
  appendTelemetryRecord,
  clearStatsLedger,
  detectSensitiveContent,
  getStatsSummary,
  isSensitiveFilePath,
  isSupportedFile,
  optimizeSource,
  readTelemetryRecords,
  type OptimizationResult,
  type TelemetryRecord,
  type TelemetrySummary,
} from './index.js';

interface DashboardData {
  records: TelemetryRecord[];
  summary: TelemetrySummary;
  runtime: {
    workspaceFiles: number;
    analyzedFiles: number;
    excludedFiles: number;
    cacheEntries: number;
    prewarmComplete: boolean;
    supportedExtensions: number;
  };
  ledgerPath: string;
  ledgerSizeBytes: number;
}

interface DashboardMessage {
  type?: unknown;
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('AST Token Slayer');
  outputChannel.show(true);
  context.subscriptions.push(outputChannel);

  const timestamp = () => new Date().toISOString();
  const safeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

  outputChannel.appendLine(`[${timestamp()}] [INFO] AST Token Slayer activating...`);

  const statusBarIconItem = vscode.window.createStatusBarItem(
    'ast-token-slayer.icon',
    vscode.StatusBarAlignment.Right,
    99.1
  );
  statusBarIconItem.command = 'ast-slayer.openDashboard';
  statusBarIconItem.color = '#00E676';
  statusBarIconItem.name = 'AST Token Slayer Icon';
  context.subscriptions.push(statusBarIconItem);

  const statusBarTextItem = vscode.window.createStatusBarItem(
    'ast-token-slayer.status',
    vscode.StatusBarAlignment.Right,
    99.0
  );
  statusBarTextItem.command = 'ast-slayer.openDashboard';
  statusBarTextItem.name = 'AST Token Slayer Savings';
  context.subscriptions.push(statusBarTextItem);

  const GLOW_FRAMES = [
    '$(sparkle) $(zap) $(sparkle)',
    '$(sparkle) $(zap~spin) $(sparkle)',
    '$(symbol-event) $(zap) $(symbol-event)',
    '$(sparkle) $(zap~spin) $(sparkle)',
    '$(pulse) $(zap) $(pulse)',
  ];
  const cache = new Map<string, { signature: string; result: OptimizationResult }>();
  const excludedSignatures = new Map<string, string>();
  const workspaceAnalyzed = new Set<string>();
  const workspaceExcluded = new Set<string>();
  let workspaceFiles = 0;
  let prewarmComplete = false;
  let activeAnalyses = 0;
  let glowTimer: NodeJS.Timeout | undefined;
  let glowFrame = 0;
  let dashboardPanel: vscode.WebviewPanel | undefined;

  function startGlowAnimation() {
    if (glowTimer) return;
    glowFrame = 0;
    statusBarIconItem.text = GLOW_FRAMES[0];
    glowTimer = setInterval(() => {
      glowFrame = (glowFrame + 1) % GLOW_FRAMES.length;
      statusBarIconItem.text = GLOW_FRAMES[glowFrame];
    }, 120);
  }

  function stopGlowAnimation() {
    if (glowTimer) {
      clearInterval(glowTimer);
      glowTimer = undefined;
    }
    statusBarIconItem.text = '$(zap)';
  }

  function updateStatusBar() {
    try {
      const summary = getStatsSummary();
      if (activeAnalyses > 0) {
        startGlowAnimation();
      } else {
        stopGlowAnimation();
      }

      const tooltip = 'AST Slayer — Click to open dashboard';
      statusBarIconItem.tooltip = tooltip;
      statusBarTextItem.text = `${summary.totalSavedTokens.toLocaleString()} tokens saved`;
      statusBarTextItem.tooltip = tooltip;
      statusBarIconItem.show();
      statusBarTextItem.show();
    } catch (error) {
      outputChannel.appendLine(
        `[${timestamp()}] [ERROR] Unable to refresh status bar telemetry: ${safeError(error)}`
      );
    }
  }

  function appendRecord(record: TelemetryRecord) {
    try {
      appendTelemetryRecord(record);
    } catch (error) {
      outputChannel.appendLine(
        `[${timestamp()}] [ERROR] Unable to write telemetry to the local ledger: ${safeError(error)}`
      );
    }
  }

  function fingerprint(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  function processSource(filePath: string, text: string, animate: boolean) {
    const rule = detectSensitiveContent(filePath, text);
    if (rule) {
      cache.delete(filePath);
      workspaceExcluded.add(filePath);
      const signature = `${rule}:${fingerprint(text)}`;
      if (excludedSignatures.get(filePath) !== signature) {
        excludedSignatures.set(filePath, signature);
        appendRecord({
          timestamp: timestamp(),
          file: filePath,
          excluded: true,
          severity: 'HIGH',
          rule,
        });
        outputChannel.appendLine(
          `[${timestamp()}] [HIGH] Excluded ${path.basename(filePath)}: ${rule}`
        );
      }
      updateStatusBar();
      return;
    }

    if (!isSupportedFile(filePath)) return;

    workspaceAnalyzed.add(filePath);
    const signature = fingerprint(text);
    const cached = cache.get(filePath);
    if (cached?.signature === signature) {
      appendRecord({
        timestamp: timestamp(),
        file: filePath,
        language: cached.result.language,
        rawTokens: cached.result.rawTokens,
        optimizedTokens: cached.result.optimizedTokens,
        saved: 0,
        cacheHit: true,
      });
      return;
    }

    if (animate) {
      activeAnalyses++;
      updateStatusBar();
      setTimeout(() => {
        activeAnalyses = Math.max(0, activeAnalyses - 1);
        updateStatusBar();
      }, 800);
    }

    const result = optimizeSource(text, filePath);
    cache.set(filePath, { signature, result });
    const record: TelemetryRecord = {
      timestamp: timestamp(),
      file: filePath,
      language: result.language,
      rawTokens: result.rawTokens,
      optimizedTokens: result.optimizedTokens,
      saved: result.saved,
    };
    appendRecord(record);

    outputChannel.appendLine(
      `[${timestamp()}] [INFO] Analyzed ${path.basename(filePath)}: ` +
        `${result.rawTokens} → ${result.optimizedTokens} tokens (${result.reductionPct} reduction)`
    );
    updateStatusBar();
  }

  function dashboardData(): DashboardData {
    const records = readTelemetryRecords();
    const summary = getStatsSummary(records);
    let ledgerSizeBytes = 0;
    try {
      ledgerSizeBytes = fs.statSync(STATS_FILE).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return {
      records,
      summary,
      runtime: {
        workspaceFiles,
        analyzedFiles: workspaceAnalyzed.size,
        excludedFiles: workspaceExcluded.size,
        cacheEntries: cache.size,
        prewarmComplete,
        supportedExtensions: SUPPORTED_EXTENSIONS.size,
      },
      ledgerPath: STATS_FILE,
      ledgerSizeBytes,
    };
  }

  function refreshDashboard(panel: vscode.WebviewPanel) {
    try {
      void panel.webview.postMessage({ type: 'stats', data: dashboardData() });
    } catch (error) {
      outputChannel.appendLine(
        `[${timestamp()}] [ERROR] Unable to refresh dashboard data: ${safeError(error)}`
      );
    }
  }

  function csvCell(value: string | number | boolean): string {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  async function exportTelemetry(preferredFormat?: 'csv') {
    const extension = preferredFormat ?? 'json';
    const destination = await vscode.window.showSaveDialog({
      title: 'Export AST Slayer telemetry',
      defaultUri: vscode.Uri.file(
        path.join(
          path.dirname(STATS_FILE),
          `ast-slayer-telemetry-${new Date().toISOString().slice(0, 10)}.${extension}`
        )
      ),
      filters:
        preferredFormat === 'csv'
          ? { 'CSV report': ['csv'] }
          : { 'JSON report': ['json'], 'CSV report': ['csv'] },
    });
    if (!destination) return;

    const data = dashboardData();
    const isCsv = preferredFormat === 'csv' || destination.fsPath.toLowerCase().endsWith('.csv');
    const content = isCsv
      ? [
          ['timestamp', 'file', 'language', 'rawTokens', 'optimizedTokens', 'saved', 'cacheHit', 'excluded', 'severity', 'rule']
            .map(csvCell)
            .join(','),
          ...data.records.map((record) =>
            [
              record.timestamp,
              record.file,
              record.language ?? '',
              record.rawTokens ?? '',
              record.optimizedTokens ?? '',
              record.saved ?? '',
              record.cacheHit ?? false,
              record.excluded ?? false,
              record.severity ?? '',
              record.rule ?? '',
            ]
              .map(csvCell)
              .join(',')
          ),
        ].join('\r\n')
      : JSON.stringify(data, null, 2);

    await fs.promises.writeFile(destination.fsPath, content, 'utf8');
    vscode.window.showInformationMessage(`AST Slayer telemetry exported to ${destination.fsPath}`);
  }

  function dashboardHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>AST Slayer Dashboard</title>
  <style>
    :root{color-scheme:dark;--bg:#0d1117;--card:#121A16;--border:#1f2937;--green:#00E676;--muted:#91a39a;--red:#ff6677;--text:#e6edf3}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.5 var(--vscode-font-family,Arial,sans-serif);padding:24px 24px 92px}
    .wrap{max-width:1180px;margin:auto}.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.brand{display:flex;align-items:center;gap:12px}.brand-icon{font-size:30px;color:var(--green);filter:drop-shadow(0 0 9px #00e67688)}h1{font-size:20px;margin:0}.subtitle,.muted{color:var(--muted)}
    .tabs{display:flex;gap:8px;border-bottom:1px solid var(--border);margin-bottom:20px}.tab{background:none;border:0;color:var(--muted);padding:10px 16px;cursor:pointer;border-bottom:2px solid transparent;font:inherit}.tab.active{color:var(--green);border-color:var(--green)}.page{display:none}.page.active{display:block}
    .hero{background:linear-gradient(120deg,#121A16,#0e1813);border:1px solid #185535;border-radius:14px;padding:24px;display:flex;align-items:center;gap:20px;margin-bottom:18px}.hero-icon{font-size:48px;color:var(--green);line-height:1;text-shadow:0 0 16px #00e67688}.eyebrow,.label{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}.hero-number{font-size:32px;font-weight:800;color:var(--green);line-height:1.2}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}.card{background:var(--card);border:1px solid var(--border);border-radius:11px;padding:16px;min-width:0}.kpi-value{font-size:21px;font-weight:700;margin-top:8px;overflow-wrap:anywhere}.kpi-sub{color:var(--muted);font-size:11px;margin-top:3px}
    .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}.section-title{font-size:14px;margin:0 0 13px}.chart-card{min-height:180px}.rings{display:flex;align-items:center;justify-content:space-around;gap:14px;flex-wrap:wrap}.ring{width:130px;text-align:center}.ring svg{width:108px;height:108px;transform:rotate(-90deg)}.ring circle{fill:none;stroke-width:11}.ring-center{font-size:15px;font-weight:700;fill:var(--text);transform:rotate(90deg);transform-origin:50% 50%}.ring-caption{font-size:11px;color:var(--muted);margin-top:5px}.legend{font-size:11px;color:var(--muted);display:flex;justify-content:center;gap:10px;margin-top:4px}.dot{display:inline-block;width:8px;height:8px;border-radius:9px;margin-right:4px}
    .bars{display:grid;gap:9px}.bar-row{display:grid;grid-template-columns:55px 1fr 76px;align-items:center;gap:9px;font-size:11px}.track{height:8px;background:#1f2937;border-radius:8px;overflow:hidden}.fill{height:100%;background:var(--green);border-radius:8px}.bar-value{text-align:right;color:var(--muted)}
    .spark{width:100%;height:130px}.spark-empty{color:var(--muted);padding:32px;text-align:center}.leader,.activity,.excluded-item{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #1f293788}.leader:last-child,.activity:last-child,.excluded-item:last-child{border-bottom:0}.rank{font-size:18px;width:28px}.file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.saved{font-weight:700;color:var(--green);white-space:nowrap}.scroll-list{max-height:300px;overflow:auto}.pill{font-size:10px;border-radius:12px;padding:2px 8px;background:#123522;color:var(--green);white-space:nowrap}.relative{color:var(--muted);font-size:11px;white-space:nowrap}
    details.security{border:1px solid #6b2730;border-radius:10px;background:#201316;margin-top:14px}details.security summary{cursor:pointer;padding:14px;color:#ff8793;font-weight:700}.security-body{padding:0 14px 12px}.excluded-item{align-items:flex-start}.excluded-name{font-weight:600;overflow-wrap:anywhere}.rule{color:#ff8793;font-size:11px}.badge-high{color:#ff8793;border:1px solid #7c2d38;border-radius:10px;padding:1px 6px;font-size:10px}
    .table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:10px;border-bottom:1px solid var(--border)}th{color:var(--muted);font-size:11px;text-transform:uppercase}td.number{text-align:right}.monthly-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}.health-list{display:grid;grid-template-columns:1fr 1fr;gap:12px}.health-value{font-size:14px;font-weight:700;margin-top:8px;overflow-wrap:anywhere}.health-good{color:var(--green)}.diag{padding:8px 0;border-bottom:1px solid var(--border)}
    .footer{position:fixed;bottom:0;left:0;right:0;background:#0d1117ee;backdrop-filter:blur(8px);border-top:1px solid var(--border);padding:12px 24px;display:flex;justify-content:flex-end;gap:9px;z-index:5}.button{background:#121A16;color:var(--text);border:1px solid var(--border);border-radius:7px;padding:8px 14px;cursor:pointer;font:inherit}.button:hover{border-color:var(--green);color:var(--green)}.button.primary{background:#00E676;color:#04130a;border-color:var(--green);font-weight:700}.button.danger:hover{border-color:var(--red);color:var(--red)}.error{color:#ff8793;margin:10px 0}
    @media(max-width:850px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){body{padding:16px 14px 82px}.grid2,.health-list{grid-template-columns:1fr}.monthly-cards{grid-template-columns:1fr}.hero-number{font-size:25px}.hero{padding:18px}.footer{padding:10px;justify-content:center}.button{padding:8px 10px}}
  </style>
</head>
<body>
  <main class="wrap">
    <header class="header"><div class="brand"><div class="brand-icon">ϟ</div><div><h1>AST Slayer</h1><div class="subtitle">Local code compaction · Neon Emerald telemetry</div></div></div><div id="updated" class="muted">Loading telemetry…</div></header>
    <nav class="tabs" aria-label="Dashboard tabs"><button class="tab active" data-tab="overview">Overview</button><button class="tab" data-tab="monthly">Monthly</button><button class="tab" data-tab="health">Health</button></nav>
    <section class="page active" id="overview">
      <div class="hero"><div class="hero-icon">ϟ</div><div><div class="eyebrow">Total tokens saved</div><div class="hero-number" id="heroSaved">0 TOKENS SAVED</div></div></div>
      <div class="kpis" id="kpis"></div>
      <div class="grid2">
        <article class="card chart-card"><h2 class="section-title">Workspace Coverage</h2><div class="rings" id="coverageRing"></div></article>
        <article class="card chart-card"><h2 class="section-title">Token Compaction</h2><div class="rings" id="compactionRing"></div></article>
      </div>
      <div class="grid2">
        <article class="card"><h2 class="section-title">Language Breakdown</h2><div class="bars" id="languageBars"></div></article>
        <article class="card"><h2 class="section-title">Session Timeline</h2><div id="timeline"></div></article>
      </div>
      <div class="grid2">
        <article class="card"><h2 class="section-title">Top Savers</h2><div id="leaderboard" class="scroll-list"></div></article>
        <article class="card"><h2 class="section-title">Recent Activity</h2><div id="activity" class="scroll-list"></div></article>
      </div>
      <details class="security" id="excludedAccordion"><summary>Excluded Files · Security Guard <span id="excludedCount"></span></summary><div id="excludedFiles" class="security-body"></div></details>
    </section>
    <section class="page" id="monthly">
      <div class="monthly-cards" id="monthlyCards"></div>
      <article class="card"><div class="header"><h2 class="section-title">Monthly Breakdown</h2><button class="button" id="exportCsv">Export CSV</button></div><div class="table-wrap" id="monthlyTable"></div></article>
    </section>
    <section class="page" id="health">
      <div class="health-list" id="healthCards"></div>
      <article class="card" style="margin-top:14px"><h2 class="section-title">Quick Diagnostics</h2><div id="diagnostics"></div></article>
    </section>
  </main>
  <footer class="footer"><button class="button" id="refresh">Refresh</button><button class="button primary" id="export">Export</button><button class="button danger" id="clear">Clear</button></footer>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentData = null;
    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const fmt = (value) => Number(value || 0).toLocaleString();
    const baseName = (file) => String(file || '').split(/[\\\\/]/).pop() || file || '';
    const records = () => currentData ? currentData.records || [] : [];
    const analyses = () => records().filter((row) => !row.excluded && !row.cacheHit);
    const relativeTime = (value) => {
      const age = Math.max(0, Date.now() - new Date(value).getTime());
      const minutes = Math.floor(age / 60000);
      if (minutes < 1) return 'just now';
      if (minutes < 60) return minutes + 'm ago';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + 'h ago';
      return Math.floor(hours / 24) + 'd ago';
    };
    const donut = (first, second, firstColor, secondColor, label, caption) => {
      const radius = 43, circumference = 2 * Math.PI * radius;
      const one = Math.max(0, Math.min(1, first));
      const two = Math.max(0, Math.min(1 - one, second));
      const firstLength = circumference * one, secondLength = circumference * two;
      return '<div class="ring"><svg viewBox="0 0 108 108" role="img" aria-label="' + esc(caption) + '">' +
        '<circle cx="54" cy="54" r="' + radius + '" stroke="#1f2937"></circle>' +
        '<circle cx="54" cy="54" r="' + radius + '" stroke="' + firstColor + '" stroke-dasharray="' + firstLength + ' ' + circumference + '"></circle>' +
        '<circle cx="54" cy="54" r="' + radius + '" stroke="' + secondColor + '" stroke-dasharray="' + secondLength + ' ' + circumference + '" stroke-dashoffset="-' + firstLength + '"></circle>' +
        '<text x="54" y="59" text-anchor="middle" class="ring-center">' + esc(label) + '</text></svg><div class="ring-caption">' + esc(caption) + '</div></div>';
    };
    const empty = (message) => '<div class="muted">' + esc(message) + '</div>';
    function renderKpis(data) {
      const s = data.summary, r = data.runtime, saved = s.totalSavedTokens || 0;
      const average = s.fileCount ? Math.round(saved / s.fileCount) : 0;
      const cost = saved * 0.003 / 1000;
      const items = [
        ['Overall Reduction', s.averageReductionPct, 'of estimated input tokens'],
        ['Total Files Analyzed', fmt(s.fileCount), 'unique files'],
        ['Cache Hit Rate', s.cacheHitPct, fmt(s.cacheHitCount) + ' cache hits'],
        ['Cached Entries', fmt(r.cacheEntries), 'in-memory source entries'],
        ['Tokens Processed', fmt(s.totalRawTokens), 'estimated raw tokens'],
        ['Estimated USD Saved', '$' + cost.toFixed(4), '~$0.003 per 1K tokens'],
        ['Average Saved / File', fmt(average), 'estimated tokens'],
        ['Analyses Run', fmt(s.totalOptimizations), 'cache misses analyzed']
      ];
      $('kpis').innerHTML = items.map((item) => '<article class="card"><div class="label">' + esc(item[0]) + '</div><div class="kpi-value">' + esc(item[1]) + '</div><div class="kpi-sub">' + esc(item[2]) + '</div></article>').join('');
    }
    function renderCoverage(data) {
      const r = data.runtime, total = r.workspaceFiles || 0;
      const analyzed = Math.min(total, r.analyzedFiles || 0);
      const excluded = Math.min(Math.max(0, total - analyzed), r.excludedFiles || 0);
      const pct = total ? analyzed / total : 0;
      const excludedPct = total ? excluded / total : 0;
      $('coverageRing').innerHTML = donut(pct, excludedPct, '#00E676', '#ff6677', Math.round(pct * 100) + '%', fmt(analyzed) + ' analyzed · ' + fmt(excluded) + ' excluded') +
        '<div class="muted">Workspace candidates: ' + fmt(total) + '<br>Pre-warm: ' + (r.prewarmComplete ? 'complete' : 'in progress') + '</div>';
      const raw = data.summary.totalRawTokens || 0, compacted = data.summary.totalOptimizedTokens || 0;
      const compactedPct = raw ? Math.min(1, compacted / raw) : 0;
      const savedPct = Math.max(0, 1 - compactedPct);
      $('compactionRing').innerHTML = donut(compactedPct, savedPct, '#00E676', '#44534b', Math.round(compactedPct * 100) + '%', fmt(compacted) + ' compacted · ' + fmt(data.summary.totalSavedTokens) + ' saved');
    }
    function renderLanguages() {
      const totals = new Map();
      for (const row of analyses()) {
        const ext = (String(row.file || '').match(/\\.[^.\\\\/]+$/) || ['unknown'])[0].toLowerCase();
        totals.set(ext, (totals.get(ext) || 0) + (row.saved || 0));
      }
      const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!rows.length) { $('languageBars').innerHTML = empty('No language activity yet.'); return; }
      const max = Math.max(...rows.map((entry) => entry[1]), 1);
      $('languageBars').innerHTML = rows.map(([ext, value]) => '<div class="bar-row"><span>' + esc(ext) + '</span><div class="track"><div class="fill" style="width:' + Math.max(value ? 2 : 0, value / max * 100) + '%"></div></div><span class="bar-value">' + fmt(value) + '</span></div>').join('');
    }
    function renderTimeline() {
      const rows = analyses().slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).slice(-24);
      if (rows.length < 2) { $('timeline').innerHTML = '<div class="spark-empty">More activity is needed to draw the timeline.</div>'; return; }
      const values = rows.map((row) => row.saved || 0), max = Math.max(...values, 1), w = 600, h = 120, pad = 8;
      const points = values.map((value, index) => ({x: pad + index * (w - pad * 2) / (values.length - 1), y: h - pad - value / max * (h - pad * 2)}));
      let line = 'M ' + points[0].x + ' ' + points[0].y;
      for (let i = 1; i < points.length; i++) {
        const mid = (points[i - 1].x + points[i].x) / 2;
        line += ' Q ' + mid + ' ' + points[i - 1].y + ' ' + points[i].x + ' ' + points[i].y;
      }
      const area = line + ' L ' + points[points.length - 1].x + ' ' + h + ' L ' + points[0].x + ' ' + h + ' Z';
      $('timeline').innerHTML = '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><defs><linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#00E676" stop-opacity=".34"></stop><stop offset="100%" stop-color="#00E676" stop-opacity="0"></stop></linearGradient></defs><path d="' + area + '" fill="url(#sparkFill)"></path><path d="' + line + '" fill="none" stroke="#00E676" stroke-width="3" stroke-linecap="round"></path></svg>';
    }
    function renderLeaders() {
      const totals = new Map();
      for (const row of analyses()) totals.set(row.file, (totals.get(row.file) || 0) + (row.saved || 0));
      const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      const medals = ['🥇', '🥈', '🥉', '4', '5'];
      $('leaderboard').innerHTML = rows.length ? rows.map(([file, value], index) => '<div class="leader"><span class="rank">' + medals[index] + '</span><span class="file-name" title="' + esc(file) + '">' + esc(baseName(file)) + '</span><span class="saved">' + fmt(value) + ' saved</span></div>').join('') : empty('No savings recorded yet.');
    }
    function renderActivity() {
      const rows = records().filter((row) => !row.excluded).slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 12);
      $('activity').innerHTML = rows.length ? rows.map((row) => {
        const reduction = row.rawTokens ? ((row.saved || 0) / row.rawTokens * 100).toFixed(1) : '0.0';
        const label = row.cacheHit ? 'cached' : fmt(row.rawTokens) + ' → ' + fmt(row.optimizedTokens);
        return '<div class="activity"><span class="file-name" title="' + esc(row.file) + '">' + esc(baseName(row.file)) + '</span><span class="muted">' + label + '</span><span class="pill">' + (row.cacheHit ? 'CACHE' : reduction + '%') + '</span><span class="relative">' + relativeTime(row.timestamp) + '</span></div>';
      }).join('') : empty('No file activity yet.');
    }
    function renderExcluded() {
      const rows = records().filter((row) => row.excluded).slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      $('excludedCount').textContent = '(' + rows.length + ')';
      $('excludedFiles').innerHTML = rows.length ? rows.map((row) => '<div class="excluded-item"><div style="flex:1"><div class="excluded-name" title="' + esc(row.file) + '">' + esc(baseName(row.file)) + '</div><div class="rule">' + esc(row.rule || 'Sensitive content') + ' · ' + esc(relativeTime(row.timestamp)) + '</div></div><span class="badge-high">' + esc(row.severity || 'HIGH') + '</span></div>').join('') : empty('No sensitive files have been excluded.');
    }
    function renderMonthly() {
      const months = new Map();
      for (const row of analyses()) {
        const month = String(row.timestamp || '').slice(0, 7) || 'Unknown';
        if (!months.has(month)) months.set(month, {saved: 0, analyses: 0, files: new Set()});
        const item = months.get(month);
        item.saved += row.saved || 0;
        item.analyses++;
        item.files.add(row.file);
      }
      const rows = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));
      const currentMonth = new Date().toISOString().slice(0, 7);
      const latest = months.get(currentMonth) || {saved: 0, analyses: 0, files: new Set()};
      $('monthlyCards').innerHTML = [['Tokens Saved', fmt(latest.saved)], ['Analyses Run', fmt(latest.analyses)], ['Files Touched', fmt(latest.files.size)]].map((item) => '<article class="card"><div class="label">This month · ' + esc(item[0]) + '</div><div class="kpi-value">' + esc(item[1]) + '</div></article>').join('');
      $('monthlyTable').innerHTML = rows.length ? '<table><thead><tr><th>Month</th><th class="number">Tokens Saved</th><th class="number">Analyses Run</th><th class="number">Files Touched</th></tr></thead><tbody>' + rows.map(([month, item]) => '<tr><td>' + esc(month) + '</td><td class="number">' + fmt(item.saved) + '</td><td class="number">' + fmt(item.analyses) + '</td><td class="number">' + fmt(item.files.size) + '</td></tr>').join('') + '</tbody></table>' : empty('No monthly telemetry yet.');
    }
    function renderHealth(data) {
      const cards = [
        ['Extension Host', '<span class="health-good">Active</span>'],
        ['Ledger File', esc(data.ledgerPath)],
        ['Ledger Disk Size', fmt(data.ledgerSizeBytes) + ' bytes'],
        ['Supported Extensions', fmt(data.runtime.supportedExtensions)]
      ];
      $('healthCards').innerHTML = cards.map((item) => '<article class="card"><div class="label">' + item[0] + '</div><div class="health-value">' + item[1] + '</div></article>').join('');
      const diagnostics = [
        ['Workspace scan', data.runtime.prewarmComplete ? 'Complete' : 'In progress'],
        ['Files analyzed this session', fmt(data.runtime.analyzedFiles)],
        ['Excluded sensitive files this session', fmt(data.runtime.excludedFiles)],
        ['In-memory cache entries', fmt(data.runtime.cacheEntries)],
        ['Ledger records loaded', fmt(data.records.length)]
      ];
      $('diagnostics').innerHTML = diagnostics.map((item) => '<div class="diag"><span>' + item[0] + '</span><span style="float:right" class="muted">' + item[1] + '</span></div>').join('');
    }
    function render(data) {
      currentData = data;
      $('heroSaved').textContent = fmt(data.summary.totalSavedTokens) + ' TOKENS SAVED';
      renderKpis(data); renderCoverage(data); renderLanguages(); renderTimeline();
      renderLeaders(); renderActivity(); renderExcluded(); renderMonthly(); renderHealth(data);
      $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    }
    document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === button.dataset.tab));
    }));
    $('refresh').addEventListener('click', () => vscode.postMessage({type:'refresh'}));
    $('export').addEventListener('click', () => vscode.postMessage({type:'export'}));
    $('exportCsv').addEventListener('click', () => vscode.postMessage({type:'exportCsv'}));
    $('clear').addEventListener('click', () => vscode.postMessage({type:'clear'}));
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'stats') render(message.data);
      if (message.type === 'error') {
        $('updated').innerHTML = '<span class="error">' + esc(message.message) + '</span>';
      }
    });
    vscode.postMessage({type:'ready'});
  </script>
</body>
</html>`;
  }

  function openDashboard() {
    if (dashboardPanel) {
      dashboardPanel.reveal(vscode.ViewColumn.One);
      refreshDashboard(dashboardPanel);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'astSlayerDashboard',
      'AST Slayer Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    dashboardPanel = panel;
    const nonce = randomBytes(16).toString('hex');
    panel.webview.html = dashboardHtml(nonce);
    context.subscriptions.push(
      panel.onDidDispose(() => {
        dashboardPanel = undefined;
      }),
      panel.webview.onDidReceiveMessage(async (message: DashboardMessage) => {
        if (typeof message.type !== 'string') return;

        try {
          switch (message.type) {
            case 'ready':
            case 'refresh':
              refreshDashboard(panel);
              break;
            case 'export':
              await exportTelemetry();
              break;
            case 'exportCsv':
              await exportTelemetry('csv');
              break;
            case 'clear': {
              const confirmation = await vscode.window.showWarningMessage(
                'Clear the AST Slayer telemetry ledger? This cannot be undone.',
                { modal: true },
                'Clear Ledger'
              );
              if (confirmation === 'Clear Ledger') {
                clearStatsLedger();
                updateStatusBar();
                refreshDashboard(panel);
              }
              break;
            }
          }
        } catch (error) {
          const messageText = `AST Slayer dashboard action failed: ${safeError(error)}`;
          outputChannel.appendLine(`[${timestamp()}] [ERROR] ${messageText}`);
          vscode.window.showErrorMessage(messageText);
          void panel.webview.postMessage({ type: 'error', message: messageText });
        }
      })
    );
    refreshDashboard(panel);
  }

  updateStatusBar();
  const pollTimer = setInterval(updateStatusBar, 4000);
  context.subscriptions.push(
    { dispose: () => clearInterval(pollTimer) },
    { dispose: () => stopGlowAnimation() }
  );

  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider({
      provideFileDecoration(uri: vscode.Uri) {
        if (uri.scheme !== 'file' || !isSupportedFile(uri.fsPath)) return undefined;
        return {
          badge: '⚡',
          tooltip: 'Optimized by AST Token Slayer',
          color: new vscode.ThemeColor('charts.green'),
        };
      },
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme === 'file' && (isSupportedFile(doc.fileName) || isSensitiveFilePath(doc.fileName))) {
        processSource(doc.fileName, doc.getText(), true);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === 'file' && (isSupportedFile(doc.fileName) || isSensitiveFilePath(doc.fileName))) {
        processSource(doc.fileName, doc.getText(), true);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const doc = editor?.document;
      if (doc?.uri.scheme === 'file' && (isSupportedFile(doc.fileName) || isSensitiveFilePath(doc.fileName))) {
        processSource(doc.fileName, doc.getText(), true);
      }
    })
  );

  context.subscriptions.push(vscode.commands.registerCommand('ast-slayer.openDashboard', openDashboard));

  const ignoredFolders = '**/{node_modules,.git,build,dist,.next,.dart_tool,target,__pycache__}/**';
  async function prewarmWorkspace() {
    const files = await vscode.workspace.findFiles('**/*', ignoredFolders);
    const candidates = files.filter(
      (uri) => isSupportedFile(uri.fsPath) || isSensitiveFilePath(uri.fsPath)
    );
    workspaceFiles = candidates.length;
    const openDocuments = new Map(
      vscode.workspace.textDocuments
        .filter((doc) => doc.uri.scheme === 'file')
        .map((doc) => [doc.uri.fsPath, doc])
    );

    for (let i = 0; i < candidates.length; i += 32) {
      const batch = candidates.slice(i, i + 32);
      await Promise.all(
        batch.map(async (uri) => {
          try {
            const openDocument = openDocuments.get(uri.fsPath);
            const text = openDocument
              ? openDocument.getText()
              : await fs.promises.readFile(uri.fsPath, 'utf8');
            processSource(uri.fsPath, text, false);
          } catch (error) {
            const code =
              error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
            outputChannel.appendLine(
              `[${timestamp()}] [WARN] Unable to read a workspace candidate during pre-warming (${code}).`
            );
          }
        })
      );
    }

    prewarmComplete = true;
    outputChannel.appendLine(
      `[${timestamp()}] [INFO] Workspace pre-warm complete: ${workspaceAnalyzed.size} analyzed, ` +
        `${workspaceExcluded.size} excluded, ${cache.size} cached entries`
    );
    updateStatusBar();
    if (dashboardPanel) refreshDashboard(dashboardPanel);
  }

  void prewarmWorkspace().catch((error: unknown) => {
    outputChannel.appendLine(
      `[${timestamp()}] [ERROR] Workspace pre-warming failed: ${safeError(error)}`
    );
    prewarmComplete = true;
    if (dashboardPanel) refreshDashboard(dashboardPanel);
  });
}

export function deactivate() {}
