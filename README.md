# AST Token Slayer

A lightweight, zero-config background extension for Antigravity IDE that tracks and optimizes token overhead as you code.

I built this because native token-slashing tools aren't always available out of the box in Antigravity IDE, and setting up manual MCP configs or constantly prompting an agent to "compress this file" gets tedious fast. AST Token Slayer runs quietly in the background, analyzing your files on open and save so you can see exactly how much structural bloat can be stripped away.

## What It Does

* **Runs Automatically:** No `mcp_config.json`, no manual setup, and no chat commands. Install the `.vsix` and get back to coding.
* **Universal Source Analysis:** Pre-warms the workspace and analyzes supported web, mobile, backend, systems, configuration, and markup files on open/save. Sensitive files and content are excluded before compression.
* **Interactive Dashboard:** Click the live status bar counter (`⚡ X tokens saved`) to open the Overview, Monthly, and Health tabs, with charts, recent activity, excluded-file alerts, and export controls.
* **Output Channel Logs:** Streams real-time, timestamped reduction metrics per file to the **AST Token Slayer** output channel so you can inspect every pass.
* **Explorer Badges:** Marks supported source files with a green `⚡` badge in the file tree.

## Telemetry & Privacy

Everything stays local on your machine. Optimization metrics and high-severity exclusion events are appended to `~/.antigravity-ast-slayer-stats.jsonl` so your cumulative savings persist across sessions without sending source code or secret values to external servers.

## Commands

* **AST Slayer: Open Dashboard** (`ast-slayer.openDashboard`) — Opens the interactive telemetry dashboard.