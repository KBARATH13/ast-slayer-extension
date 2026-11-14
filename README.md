# AST Slayer

A lightweight, zero-config background extension for Antigravity IDE that tracks and optimizes token overhead as you code.

I built this because native token-slashing tools aren't always available out of the box in Antigravity IDE, and setting up manual MCP configs or constantly prompting an agent to "compress this file" gets tedious fast. AST Slayer runs quietly in the background, analyzing your files on open and save so you can see exactly how much structural bloat can be stripped away.

## What It Does

* **Runs Automatically:** No `mcp_config.json`, no manual setup, and no chat commands. Install the `.vsix` and get back to coding.
* **Background File Analysis:** Hooks into workspace events to evaluate `.ts`, `.tsx`, `.js`, `.dart`, `.sol`, `.json`, and `.md` files whenever you open or save them.
* **Live Status Bar & Activity Pulse:** Shows a spinning sync indicator while crunching AST reductions, then settles into a live counter (`⚡ X tokens saved`) in the bottom-right status bar. Click it anytime for a full breakdown.
* **Output Channel Logs:** Streams real-time, timestamped reduction metrics per file to the **AST Slayer** output channel so you can inspect every pass.
* **Explorer Badges:** Marks supported source files with a green `⚡` badge in the file tree.

## Telemetry & Privacy

Everything stays local on your machine. Optimization metrics are appended to `~/.antigravity-ast-slayer-stats.jsonl` so your cumulative savings persist across sessions without sending a single byte of code to external servers.

## Commands

* **AST Slayer: View Telemetry & Token Savings** (`ast-slayer.showStats`) — Displays total files analyzed, cumulative tokens saved, and overall reduction percentage.