---
trigger: always_on
description: "Enforces AST skeleton inspection via ast-token-slayer before reading raw source files."
---

# AST Token Slayer Compression Policy

1. **Structural First:** Before reading full source files over 50 lines, call `get_structural_summary` to inspect imports, classes, and method signatures.
2. **Lazy Body Expansion:** Use `expand_symbol` to read only the specific method, widget, or contract function you are modifying.
3. **Surgical Edits & Dependencies:** Use `get_call_graph` to trace imports across directories and `apply_ast_patch` for targeted symbol updates.
4. **Telemetry:** Report token reduction metrics using `get_token_stats` when requested.