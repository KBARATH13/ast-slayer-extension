import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isSupportedFile,
  optimizeSource,
  appendTelemetryRecord,
  getStatsSummary,
  STATS_FILE,
  type TelemetryRecord,
} from './index.js';

export function activate(context: vscode.ExtensionContext) {
  // 1. Dedicated Output Channel Setup
  const outputChannel = vscode.window.createOutputChannel('AST Slayer');
  outputChannel.show(true);
  context.subscriptions.push(outputChannel);

  const timestamp = () => new Date().toISOString();

  outputChannel.appendLine(`[${timestamp()}] [INFO] AST Slayer activating...`);
  outputChannel.appendLine(`[${timestamp()}] [INFO] Registered background document interceptors ✓`);
  outputChannel.appendLine(`[${timestamp()}] [INFO] AST Slayer activated successfully ✓`);

  // 2. Configure Status Bar with Neon Emerald accent
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'ast-slayer.showStats';
  statusBarItem.color = '#00E676'; // Neon Emerald
  context.subscriptions.push(statusBarItem);

  let isCalculating = false;

  function updateStatusBar(currentFile?: string) {
    let totalSaved = 0;
    let totalCalls = 0;
    if (fs.existsSync(STATS_FILE)) {
      try {
        const rows = fs
          .readFileSync(STATS_FILE, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line: string) => JSON.parse(line));
        totalSaved = rows.reduce((acc: number, r: any) => acc + (r.saved || 0), 0);
        totalCalls = rows.length;
      } catch {}
    }

    if (isCalculating) {
      // Active calculation visual effect
      statusBarItem.text = `$(sync~spin) Slaying AST${currentFile ? `: ${path.basename(currentFile)}` : '...'}`;
      statusBarItem.tooltip = 'AST Slayer is actively compressing tokens...';
    } else {
      // Idle state
      statusBarItem.text = `⚡ ${totalSaved.toLocaleString()} tokens saved`;
      statusBarItem.tooltip = `AST Slayer: ${totalCalls} files optimized (Click for stats)`;
    }
    statusBarItem.show();
  }

  updateStatusBar();

  // Periodic polling to keep stats synced with any external or background processes
  const pollTimer = setInterval(updateStatusBar, 4000);
  context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });

  // FileSystemWatcher for instant ledger file updates
  try {
    const statsUri = vscode.Uri.file(STATS_FILE);
    const watcher = vscode.workspace.createFileSystemWatcher(statsUri.fsPath);
    watcher.onDidChange(() => updateStatusBar());
    watcher.onDidCreate(() => updateStatusBar());
    context.subscriptions.push(watcher);
  } catch {
    // Fall back smoothly to polling if watcher cannot attach to the path
  }

  // 3. Update Explorer File Decorations to Neon Emerald (charts.green)
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider({
      provideFileDecoration(uri: vscode.Uri) {
        if (uri.scheme !== 'file') return undefined;
        const ext = path.extname(uri.fsPath).toLowerCase();
        if (['.dart', '.ts', '.tsx', '.js', '.sol', '.json', '.md'].includes(ext)) {
          return {
            badge: '⚡',
            tooltip: 'Optimized by AST Slayer',
            color: new vscode.ThemeColor('charts.green'),
          };
        }
        return undefined;
      },
    })
  );

  // 4. Wrap processDocument with the active animation state
  const processedTimestamps = new Map<string, number>();

  async function processDocument(doc: vscode.TextDocument) {
    if (doc.uri.scheme !== 'file') {
      return;
    }

    const filePath = doc.fileName;
    if (!isSupportedFile(filePath)) {
      return;
    }

    // Debounce processing within 500ms per file
    const now = Date.now();
    const lastRun = processedTimestamps.get(filePath) || 0;
    if (now - lastRun < 500) {
      return;
    }
    processedTimestamps.set(filePath, now);

    const text = doc.getText();
    if (!text || text.length < 50) return;

    // Trigger live spinning animation
    isCalculating = true;
    updateStatusBar(doc.fileName);

    // Brief non-blocking tick so the visual pulse is visible to the human eye
    await new Promise((resolve) => setTimeout(resolve, 350));

    try {
      const result = optimizeSource(text, filePath);
      const reductionPct =
        result.rawTokens > 0
          ? ((result.saved / result.rawTokens) * 100).toFixed(1)
          : '0.0';

      outputChannel.appendLine(
        `[${timestamp()}] [INFO] Analyzed ${filePath}: ${result.rawTokens} → ${result.optimizedTokens} tokens (${reductionPct}% reduction)`
      );

      if (result.saved > 0) {
        const record: TelemetryRecord = {
          timestamp: new Date().toISOString(),
          file: filePath,
          language: result.language,
          rawTokens: result.rawTokens,
          optimizedTokens: result.optimizedTokens,
          saved: result.saved,
        };

        appendTelemetryRecord(record);
      }
    } finally {
      // Return to idle lightning bolt state
      isCalculating = false;
      updateStatusBar();
    }
  }

  // Hook workspace document open and save events
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => processDocument(doc)),
    vscode.workspace.onDidSaveTextDocument((doc) => processDocument(doc))
  );

  // 5. Pre-warm Workspace Documents & Log Batch Completion
  outputChannel.appendLine(`[${timestamp()}] [INFO] Pre-warming workspace documents...`);
  let prewarmedCount = 0;
  const initialDocs = new Set<vscode.TextDocument>(vscode.workspace.textDocuments);
  if (vscode.window.activeTextEditor) {
    initialDocs.add(vscode.window.activeTextEditor.document);
  }

  for (const doc of initialDocs) {
    if (doc.uri.scheme === 'file' && isSupportedFile(doc.fileName)) {
      processDocument(doc);
      prewarmedCount++;
    }
  }

  outputChannel.appendLine(
    `[${timestamp()}] [INFO] Workspace pre-warm complete: ${prewarmedCount} active documents processed ✓`
  );

  // 6. Command: Show Telemetry Details
  context.subscriptions.push(
    vscode.commands.registerCommand('ast-slayer.showStats', async () => {
      outputChannel.appendLine(`[${timestamp()}] [INFO] Telemetry summary requested by user.`);
      const summary = getStatsSummary();

      if (summary.totalOptimizations === 0) {
        vscode.window.showInformationMessage(
          'AST Slayer: Background optimization is active. No tokens saved yet in ledger.'
        );
        return;
      }

      const action = await vscode.window.showInformationMessage(
        `⚡ AST Slayer Telemetry Summary\n\n` +
          `• Total Optimizations: ${summary.totalOptimizations}\n` +
          `• Monitored Files: ${summary.fileCount}\n` +
          `• Raw Tokens: ${summary.totalRawTokens.toLocaleString()}\n` +
          `• Optimized Tokens: ${summary.totalOptimizedTokens.toLocaleString()}\n` +
          `• Total Saved: ${summary.totalSavedTokens.toLocaleString()} (${summary.averageReductionPct} reduction)\n` +
          `• Ledger: ${STATS_FILE}`,
        'Open Ledger',
        'Dismiss'
      );

      if (action === 'Open Ledger') {
        if (fs.existsSync(STATS_FILE)) {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(STATS_FILE));
          await vscode.window.showTextDocument(doc);
        } else {
          vscode.window.showWarningMessage('AST Slayer: Stats ledger file does not exist yet.');
        }
      }
    })
  );
}

export function deactivate() {}
