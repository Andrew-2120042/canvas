# Project: [Your Product Name] — Full Product Plan

## The actual idea

An agent-native design canvas tool — a standalone competitor to Paper.design and Subframe, not
built on top of either. Desktop app, Tauri + React + TypeScript + Vite, Mac + Windows.

**The core bet:** the canvas is real DOM elements + real CSS, not `<canvas>`/WebGL/a
proprietary format. Every frame is an actual DOM container; the layer tree is a live view over
real parent/child DOM nesting. This is deliberate — it's what makes agent-generated output
accurate later instead of guessed, same rendering philosophy as Paper.

**Full v1 scope (not just Phase 1 below):** an inch-to-inch clone of Paper's feature set —
canvas, frames, shapes, text, vector/pen tool, tokens, multiplayer, MCP integration — plus two
differentiators nobody else in the category has combined:

1. **Embedded, custom-styled terminal panel** inside the app itself, running whatever coding
   agent the user already uses (Claude Code, Codex, etc.) — not a separate desktop app, no
   alt-tabbing. The terminal UI is restyled, not a raw terminal look. The app auto-writes each
   agent's MCP config into the session before the terminal opens, so the agent already sees the
   canvas as available tools the moment the user runs it — zero manual setup.
2. **Canva-style simple editing mode** — slider/picker controls (corner radius, gradients,
   spacing, fonts) alongside the precise/pro panel, so both non-designers and Figma-level users
   can work in the same tool.

Multiplayer, live-streaming agent builds (watch the canvas update as the agent works, broadcast
to everyone in the room), and the MCP server are all core v1 features — not later add-ons —
because retrofitting real-time sync and agent-editable state into an app built assuming
single-user local state is genuinely painful. The document/state model has to support
concurrent edits and agent-tool-calls from day one.

## Full stack (all phases)

- **Shell:** Tauri (Rust core + native webview) — Mac + Windows from one codebase
- **Frontend:** React + TypeScript + Vite, Zustand for state
- **Canvas rendering:** real DOM + CSS, no WebGL/canvas tag
- **Multiplayer sync:** Yjs (CRDT) — self-hosted, no per-connection metered cost
- **Backend:** Node.js + Fastify — REST + WebSocket rooms, write-through persistence
- **Database:** Neon (serverless Postgres) or self-hosted Postgres — NOT Supabase (per-MAU
  auth pricing + bundled compute cost scales badly against agent-heavy traffic patterns)
- **ORM:** Drizzle
- **Auth:** Better Auth — self-hosted, open-source, zero per-MAU fees
- **File/asset storage:** Cloudflare R2 — S3-compatible, zero egress fees (needed once
  multiplayer + AI image gen mean two people need to see the same generated asset)
- **Local MCP server:** Node.js `@modelcontextprotocol/sdk`, run as a Tauri sidecar bound to
  localhost, auto-starts when a file is open
- **Embedded terminal:** xterm.js (frontend) + Rust `portable-pty` — real pty, custom-themed,
  not a raw terminal look
- **AI image gen (later phase):** direct API integration — Flux (Replicate/BFL), OpenAI Images,
  Gemini/Nano Banana — no abstraction layer needed at this scale
- **CI/CD:** GitHub Actions, matrix build (windows-latest + macos-latest), Tauri's native
  GitHub Actions support for signed builds on both platforms

## Full feature checklist (from Paper's actual shipped surface — see docs.paper.design)

**Canvas core:** infinite canvas, move/pan/frame/rectangle/pen/text/shader/eyedropper tools,
zoom controls, pixel grid + snap, layout guides, multiplayer cursor toggle, minimal UI mode,
desktop tabs (multiple files open, agents can work across files including background tabs)

**Selection/layers:** deep vs. shallow select, layer tree cross-cursor inspection, siblings
cycling, show/hide/lock/rename, reorder (front/back/step), align/distribute, nudge/resize via
keyboard, group/ungroup, clip content, resize-to-fit/fill, marquee selection

**Layout engine:** real CSS flex, flex wrapping, constraints panel, absolute-position override,
CSS Grid (Paper hasn't shipped this either — track it, don't block on it), negative gap spacing,
on-canvas gap/padding handles

**Vector/SVG editing:** paste SVGs as editable layers, AI SVG generation, path editing (add/
delete/move nodes, curvature, fill/stroke), vectorize raster-to-vector, pixel snapping on path
points. Roadmap-tier (later): shape-from-scratch, crop/scale SVGs, boolean ops, mirroring,
repeating, vector networks, anchoring, shape builder

**Shaders (post-v1 track, deep subsystem):** Mesh Gradient, Fluted Glass, Liquid Metal,
Halftone, Grain/Paper Texture, Swirl, Water, Image Dithering, Heatmap, Pulsing Border — each
with its own parameter panel

**Typography:** font search (Google + local), variable fonts + custom axes, full styling
hotkeys, OpenType features, optical sizing, text formatting (casing/wrap/truncation), text
gradient fill, text stroke

**Fill/color/effects:** fill/stroke swap, opacity hotkeys, on-canvas gradient editing,
selection-colors bulk panel, filters (blur/saturation/grayscale/brightness/sepia/invert/hue),
backdrop filters, per-corner radius, P3/OkLCH color picker

**Design tokens:** Color, Radius, Spacing, Container, Breakpoint, Font family/weight/size, Line
height, Letter spacing — add via UI or MCP (from canvas design or from a codebase's CSS vars),
propagating updates, detach, copy/paste between files and into a codebase

**AI/image gen:** multiple raster models, SVG generation, aspect-ratio-preserving edits,
canvas-aware agent assistant reducing boilerplate

**Import/paste/capture:** paste from Figma, paste HTML as editable layers, browser-extension
"snapshot" to capture any live webpage into the canvas as editable layers (needs target dev
server CORS allowlisting — documented per-framework)

**Export:** copy as React/Tailwind, PNG/WebP/AVIF, video export (MP4) from shaders/frames,
multi-frame PDF export

**Collaboration:** real-time multiplayer cursors + presence, agent presence visible to
teammates live, comments (resolve/search/filter/sort), follow-teammate-cursor, cursor chat,
Editor/Admin/Viewer roles (viewer seats always free), view-only mode, folders/subfolders

**MCP server:** auto-starts with an open file, 24-tool surface — read (basic info, selection,
node info, children, tree summary, JSX-with-Tailwind export, screenshots) and write (create
frames, edit HTML/styles, duplicate/delete/reparent/reorder nodes, change pages, create/open
files) — supports 10+ agent clients out of the box (Cursor, Claude Code, VS Code Copilot,
Windsurf, Cline, Continue, OpenCode, Antigravity, and more)

**Live streaming agent builds:** agent streams HTML in small chunks rather than dumping a
finished design at once; server re-broadcasts at a steady rate so even a one-shot generation
plays back as a smooth build; mid-stream HTML must be "healed" before render (drop trailing
half-written tags, cut unclosed `<script>`, auto-close unclosed `<style>`) so the frame paints
instead of going blank mid-build; visual feedback = pulsing border + status chip. Broadcasts
over the same multiplayer WebSocket room, so teammates watch the build live too, not just the
person who triggered it.

## Confirmed gaps in Paper (real opportunities, worth targeting deliberately)

No responsive/breakpoint-specific design workflow · no interactive/clickable prototyping · no
plugin marketplace · CSS Grid unshipped · reusable component system with slots/props still
"coming soon"

## What NOT to build — permanently, not just Phase 1

Plugin marketplace (no user demand found for this, deprioritize indefinitely)

## Build order — phases, gated, sequential. Don't start the next phase until the current one is demonstrated working.

### Phase 1 — Canvas editor only (full detail below)
100% local, offline, single-player. No agent, no MCP, no embedded terminal, no multiplayer, no
backend/database/auth, no AI image gen, no shaders (functional), no export. Pen/shader/
component/token tools exist as visible, clickable, inert stubs in the toolbar only.

### Phase 2 — MCP server + embedded terminal (single-player agent editing)
Local MCP sidecar server wired to the Phase 1 canvas. Embedded, custom-styled terminal panel
(xterm.js + portable-pty) that auto-writes each supported agent's MCP config before opening, so
`claude`/`codex`/etc. already see canvas tools with zero manual setup. Still single-player, still
no backend — this is local agent control of local canvas state.

### Phase 3 — Live streaming agent builds
Layer the incremental-HTML-streaming + healing + pulsing-border UX on top of Phase 2, since the
agent is already writing to canvas state at that point.

### Phase 4 — Multiplayer + backend + auth
Turn the single-player tool into the shared one: Yjs sync, Fastify + WebSocket backend, Neon/
Postgres + Drizzle, Better Auth, Cloudflare R2 for shared assets. Live streaming (Phase 3)
starts broadcasting to the whole room, not just the local session, once this lands.

### Phase 5 — Vector/pen tool, full SVG editing
Path editing, node curvature, vectorize, pixel snapping — replace the Phase 1 stub with real
functionality.

### Phase 6 — Design tokens
Color/radius/spacing/container/breakpoint/typography tokens, MCP-driven token generation from
canvas or codebase, propagation, copy/paste between files.

### Phase 7 — Canva-style simple mode
Slider/picker editing layer (corner radius, gradients, spacing, fonts) alongside the precise
panel — the second core differentiator, built once the precise/pro editing model (Phase 1) is
solid enough to have a simplified view mapped onto it.

### Phase 8 — Shaders
Mesh Gradient, Liquid Metal, Halftone, Grain, etc. — deep GPU-effects subsystem, deliberately
late since it's pure polish, not core loop.

### Phase 9 — Export
Copy as React/Tailwind, image/video/PDF export.

### Phase 10 — Everything else Paper has that isn't yet covered
AI image generation, comments, folders, view-only/roles, snapshot browser extension, Figma
paste — sequence within this phase by whatever proves highest-value once the core loop (Phases
1-4) is real and in front of users.

---

# PHASE 1 DETAIL — canvas editor only (current phase, start here)

## Explicitly OUT of scope for Phase 1

AI agent, MCP, embedded terminal, multiplayer/sync, backend/database/auth, AI image gen,
shaders (functional), export. Pen/shader/component/token tools get toolbar icon slots as
visible, clickable, visually-inert stubs only — no logic behind them yet.

Using outside tools (e.g. Paper's own MCP) to look at reference UI while building this is fine
— that's research, not something shipping in this product.

## Reference UI — structural match, not pixel-perfect (visual polish in 1.10)

- Tab bar: "Dashboard" tab + one tab per open file
- Left panel: title + sidebar toggle → Design/Theme switcher (Theme = visual stub for now) →
  collapsible Pages list (+ button) → layer tree reflecting real DOM hierarchy, per-row
  visibility toggle
- Left toolbar, exact order: Move → Pan → Frame → Rectangle → Pen (stub) → Text → Image →
  Shader (stub) → Component (stub) → Token (stub)
- Canvas: infinite, pannable, zoomable, dot-grid, numbered pages laid left-to-right
- Right panel: position/size/fill/opacity, live-updates with selection; page background when
  nothing selected

## Document model — design this in from the start

1.9 (persistence) and 1.10 (undo/redo) both depend on the document model locked in during
1.3-1.4. Design it with clean JSON serialization and a command/patch-based undo stack in mind
from the moment it's created, so those phases are wiring, not a rewrite. Same model needs to be
sync-friendly (Yjs-compatible shape) ahead of Phase 4, even though sync itself isn't built yet.

## Sub-phases — sequential, gated. Demonstrated working, not assumed, before advancing.

**1.1 Project scaffold** — Tauri+React+TS+Vite boots on Mac and Windows, empty 3-panel layout.
*Acceptance:* `npm run tauri dev` opens the shell, no crashes.

**1.2 Infinite canvas viewport** — pan (drag/arrows/spacebar-drag), zoom (scroll/pinch/
zoom-to-fit/100%), dot grid scaling with zoom.
*Acceptance:* smooth pan/zoom on an empty canvas.

**1.3 Frame primitive** — frame tool creates real DOM containers; select/move/resize via
handles.
*Acceptance:* create, select, move, resize multiple independent frames.

**1.4 Shape + text primitives** — rectangle tool, text tool with double-click edit, correct
nesting inside frames.
*Acceptance:* place both inside and outside frames, edit text content.

**1.5 Selection + layer tree** — multi-select (shift-click, marquee), layer tree mirrors DOM
in real time, bidirectional selection sync, visibility/lock toggles.
*Acceptance:* canvas and layer-list selection stay in sync both directions.

**1.6 Properties panel** — live position/size/fill/opacity editing; page background when
nothing selected.
*Acceptance:* edit any property from the panel, canvas updates immediately.

**1.7 Toolbar + tool switching** — full icon set per Reference UI (pen/shader/component/token
visible but inert), keyboard shortcuts (V/H/F/R/T).
*Acceptance:* each active tool changes interaction mode; shortcuts work; stubs are visually
distinct from active tools.

**1.8 Pages + file tabs** — multiple pages per file, multiple files as tabs, Dashboard tab
listing local files.
*Acceptance:* two pages hold independent content; two file tabs don't share canvas state.

**1.9 Local persistence** — save/load full canvas state as local JSON, autosave.
*Acceptance:* quit and reopen restores a complex layout exactly.

**1.10 Polish pass** — copy/paste/duplicate, delete, undo/redo, align/distribute, z-order,
arrow-key nudge; visual polish matching reference spacing/toolbar treatment.
*Acceptance:* build a simple multi-page layout with mouse+keyboard only, no crashes/glitches.

## Working conventions

- Commit at sub-phase boundaries, not per-file
- Don't advance until the current sub-phase's acceptance criterion is demonstrated, not assumed
- Ask before introducing any dependency not listed in the stack sections above
- Don't implement anything on the out-of-scope list with real logic — visual-only stubs are
  fine, functional stubs are not