# canvas (placeholder name)

An agent-native design canvas. Desktop app — Tauri + React + TypeScript + Vite, Mac + Windows.

The canvas renders as **real DOM elements + real CSS**, not `<canvas>`/WebGL. The layer tree is
a live view over actual parent/child DOM nesting. See `claude.md` for the full product plan and
phase breakdown.

## Current phase

**Phase 1 — canvas editor only.** Local, offline, single-player. No agent, MCP, terminal,
multiplayer, backend, or export.

## Develop

```sh
npm install
npm run tauri dev
```

Requires Node 22+ and a stable Rust toolchain.

## Layout sizing

All panel dimensions resolve through CSS variables in `src/styles/tokens.css`. Current values
are provisional, measured from the reference UI; replacing them there updates the whole shell.
