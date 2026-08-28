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
