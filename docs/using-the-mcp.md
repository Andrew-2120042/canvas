# Using the canvas MCP server

The app runs a local MCP server whenever it has a file open. Any agent that
speaks MCP can drive the canvas through it.

## Connection

    http://127.0.0.1:4319/mcp        (streamable HTTP)

Loopback only — not reachable from the network. The app registers it in
Claude Code automatically on startup, so `claude` already sees it as `canvas`
with no setup. Confirm with:

    claude mcp list          # -> canvas: ... ✔ Connected
    curl -s http://127.0.0.1:4319/health

For another client, add it as an HTTP MCP server at that URL. Cursor, VS Code
and the rest use the same two fields:

    { "type": "http", "url": "http://127.0.0.1:4319/mcp" }

## Tools

Read:

| Tool | What it does |
|---|---|
| `get_status` | Which file and page are open, node and selection counts |
| `get_canvas_state` | The page as a tree. `detail: "full"` adds styles |
| `get_selection` | What the user has selected, with properties |
| `get_node` | One node by id; `includeChildren` for the subtree |
| `get_screenshot` | PNG of the page, or of one node via `nodeId` |

Write:

| Tool | What it does |
|---|---|
| `create_node` | type, x, y, width, height, parentId, name, fill, opacity, radius, text, fontSize |
| `update_node` | any subset of the above, by id |
| `delete_node` | `id` or `ids` |
| `duplicate_node` | `id` or `ids`, with an offset |
| `set_selection` | select nodes so the user sees what you mean |

Coordinates are relative to `parentId` when given, otherwise to the page.
Only a frame can contain other nodes.

## Try it

    claude -p "Using the canvas MCP tools, describe what is on the canvas." \
      --allowedTools "mcp__canvas__get_canvas_state"

    claude -p "Using the canvas MCP tools, add a 200x120 rounded blue card at 400,400 named Test." \
      --allowedTools "mcp__canvas__create_node"

Then press Cmd+Z in the app — the whole build undoes in one press.

## Notes and current limits

- **Every agent write goes through the same store actions as a human edit**,
  so agent changes undo, persist and render identically. An agent's whole
  turn is one undo step.
- **`fontWeight` and `lineHeight` are not exposed** on `create_node` or
  `update_node`, though the document model supports both. Large text
  therefore sits in the default line box and can overflow its own bounds;
  compensate with spacing until this is fixed.
- **No layout engine.** Flex and grid are not in the node model, so position
  everything explicitly.
- If the app is closed, calls return "no canvas app is connected" rather
  than failing obscurely.
