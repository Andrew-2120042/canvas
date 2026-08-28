# Phase 2 — how the agent reaches the canvas

## Shape

```
agent CLI  --MCP over HTTP-->  sidecar (Node)  --WebSocket-->  app webview
 (claude)      127.0.0.1            /mcp             /app        (canvas store)
```

The sidecar owns no document state. Every tool call is forwarded to the app
and executed there.

## Why the bridge exists

The canvas lives in the webview's store, and Phase 2's governing rule is that
agent writes go through the **same named store actions** as human writes —
because undo (1.10) wraps that action set, and Phase 4's sync layer is built
around it being the single source of truth for all writes.

A Node process cannot call those actions directly. It could have re-implemented
document logic and written state itself, which is exactly the trap the rule
forbids. Forwarding instead makes routing around the store actions impossible
from the server: the server has no document to write to.

## Security posture

- Bound to `127.0.0.1` only, never `0.0.0.0`. Verified unreachable on the
  machine's LAN address.
- No auth on the MCP connection, deliberately: this is one user's own agent
  talking to their own app on their own machine over loopback. Accounts and
  remote access are Phase 4.

## Lifecycle

The sidecar starts when the app has a file open and dies with the app.

Two independent mechanisms, because one is not enough:

1. The app kills the child on window destroy — covers a clean quit.
2. The sidecar watches its parent pid and exits when the parent is gone —
   covers a crash or force-quit, which the first mechanism misses. Found by
   killing the app and seeing the sidecar keep its port.

## Port selection

The app asks the OS for a free loopback port and passes it to the sidecar,
which prints `CANVAS_MCP_LISTENING <port>` on stdout. The app blocks on that
line before reporting the port, so no caller is handed an address that is not
listening yet. A fixed port would collide with whatever else the user runs.

## Packaging note

In development the sidecar runs from source with the system `node`. A
packaged build must ship it as a bundled sidecar binary (`externalBin`) so it
does not depend on the user having node installed. Not yet done.

---

# Automatic connection injection (2.6)

## Mechanism chosen: write the config file directly

The app writes the server entry into `~/.claude.json` under the top-level
`mcpServers` key — the same place `claude mcp add --scope user` writes it,
confirmed by running that command and diffing the file.

```json
"mcpServers": { "canvas": { "type": "http", "url": "http://127.0.0.1:4319/mcp" } }
```

## Why not shell out to `claude mcp add`

- **Idempotence.** This runs on every app start. `claude mcp add` fails when
  the name already exists, so shelling out would need a remove-then-add pair
  that can leave the entry missing if it fails in between. Setting a key is
  idempotent by nature.
- **No PATH dependency.** The app's environment is not the user's interactive
  shell; `claude` may not be on it. Writing the file works either way, and
  works before the CLI is ever installed.
- **No CLI surface dependency.** Flags change; a two-field JSON object is a
  far smaller contract.

## Safety of writing a user's config

That file holds unrelated state — on this machine 218KB across 76 projects.
So the write:

- parses, merges **one** key, and re-serialises, rather than templating a
  file from scratch;
- goes to a temp file and renames, which is atomic within a filesystem, so a
  crash mid-write cannot truncate it;
- falls back to an empty object if the file is missing or unparseable rather
  than failing the app's startup.

Verified by diffing the file before and after: everything except `mcpServers`
was identical.

## Stable port

The server prefers port 4319 and only falls back to an OS-assigned port if
something already holds it. An earlier version took a random port every
launch, which meant the written config was stale the moment the app closed
and had to be rewritten on every start. A stable port keeps the entry valid
across restarts, so the user's config is touched once rather than constantly.

## What is deliberately NOT automated

Claude Code asks whether a folder is trusted the first time an agent runs in
it. The app does not suppress that: writing the trust flag into the user's
config would forge a security decision that belongs to them. It is a
per-folder question asked once, and it is not MCP setup — which is what this
phase promises to remove.

The terminal starts in a workspace directory rather than the home directory,
so the question is asked about a small, relevant folder instead of everything
the user owns.

# End-to-end validation (2.7)

Demonstrated with a real Claude Code process, not simulated:

1. `claude mcp list` -> `canvas: http://127.0.0.1:4319/mcp (HTTP) - ✔ Connected`
2. Asked to describe the canvas, it returned all five nodes with correct
   types, sizes and parent/child nesting.
3. Asked to draw, it created a rectangle at the exact position, size, fill
   and name requested, which appeared live on the canvas.
4. Pressing Cmd+Z removed the agent's node (7 -> 6); Shift+Cmd+Z restored it
   (6 -> 7) — an agent edit undoes exactly like a hand-made one.
5. A fresh agent process reconnected and read the node back with no setup
   step in between.

One diagnostic note worth keeping: Claude Code's startup banner warned
"1 MCP server needs authentication". That was a pre-existing Vercel server in
this user's config, not the canvas one. Checking `claude mcp list` rather
than trusting the banner is what distinguished them.
