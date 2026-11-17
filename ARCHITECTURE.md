# AST Slayer — Architecture & Workflow

> **Zero-config background token optimization mirror for Antigravity IDE / VS Code.**

---

## 1. System Architecture

```mermaid
flowchart TD
    A["Workspace Events<br/>(Open / Save / Tab Switch)"] --> B["Debounce & Language Check<br/>(.ts, .tsx, .js, .dart, .sol, .json, .md)"]
    B --> C["AST Parsing Engine<br/>(Strip comments & collapse whitespace)"]
    C --> D["Token Estimator<br/>(~4 chars / token)"]
    D -->|saved > 0| E[("Local Ledger<br/>~/.antigravity-ast-slayer-stats.jsonl")]
    D --> F["Live UI Feedback<br/>• Status Bar (Neon Emerald $(zap) + Count)<br/>• 800ms Emerald Glow Pulse<br/>• Explorer ⚡ Badges<br/>• Output Channel Logs"]
```

---

## 2. Core Components

| Component | File | Responsibilities |
|---|---|---|
| **Extension Host** | `src/extension.ts` | Listens to workspace events, drives status bar items, animates the Neon Emerald glow pulse, and registers explorer badges. |
| **AST Engine** | `src/index.ts` | Language detection, comment stripping (preserving string literals), whitespace collapsing, and token calculations. |
| **Local Ledger** | `~/.antigravity-ast-slayer-stats.jsonl` | Append-only JSON Lines store for cumulative telemetry and token savings. Zero network calls. |

---

## 3. Execution Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant Ext as extension.ts
    participant Engine as index.ts
    participant Ledger as Local Ledger
    participant UI as Status Bar

    Dev->>Ext: Opens / Saves code file
    Ext->>UI: Triggers 800ms Neon Emerald glow pulse: $(sparkle) $(zap~spin)
    Ext->>Engine: optimizeSource(code, path)
    Engine->>Engine: Strip comments & collapse whitespace
    Engine-->>Ext: Returns tokens saved & reduction %
    Ext->>Ledger: Appends telemetry record (if saved > 0)
    Ext->>UI: Updates token counter & reverts $(zap) to steady state
```

---

## 4. Key Engineering Decisions

* **Dual Status Bar Anchoring:** Uses adjacent priorities (`99.1` for icon, `99.0` for text) strictly below built-in editor indicators (`100.1`–`100.5`) to keep the icon and counter locked side-by-side.
* **Codicon vs. Emoji:** Uses native VS Code `$(zap)` codicon instead of Unicode emoji `⚡` to allow `#00E676` (Neon Emerald) color rendering on Windows.
* **Non-Blocking Visual Pulse:** Minimum 800ms animation guarantee ensuring the background optimization is clearly visible without blocking the main editor thread.

---

## 5. Specifications & Benchmarks

* **VSIX Package Size:** ~11.6 KB (zero runtime dependencies)
* **Optimization Latency:** < 2.5 ms / file
* **Supported Languages:** TypeScript, TSX, JavaScript, Dart, Solidity, JSON, Markdown
* **Runtime Target:** Node 18+ ESM, bundled with `esbuild`
