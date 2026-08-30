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
| `get_tree_summary` | The page in outline — counts, top-level nodes, selection |
| `get_guide` | How to design well here: colour, type, spacing, layout, CSS, icons |

Write:

| Tool | What it does |
|---|---|
| `write_html` | **The main way to build.** HTML + inline CSS into nodes, one call per component or screen |
| `create_node` | type, x, y, width, height, parentId, name, fill, opacity, radius, text, fontSize, fontWeight, lineHeight, letterSpacing, textAlign |
| `update_node` | any subset of the above, by id |
| `delete_node` | `id` or `ids` |
| `duplicate_node` | `id` or `ids`, with an offset |
| `set_selection` | select nodes so the user sees what you mean |
| `focus_node` | pan and zoom the user's view to a node |

Coordinates are relative to `parentId` when given, otherwise to the page.
Only a frame can contain other nodes.

### write_html

The canvas is real DOM and real CSS, so a design is written as markup rather
than assembled a box at a time:

    write_html({
      targetNodeId: "f10_abc",     // a frame; omit to add at page level
      mode: "replace-children",    // or "insert-children" (the default)
      html: "<div style=\"display:flex;...\">…</div>",
    })

Supported: flexbox (`display:flex`, `flex-direction`, `gap`, `flex-wrap`,
`justify-content`, `align-items`, `align-self`, `flex-grow`, `flex-shrink`,
the `flex` shorthand, `padding`), colours and linear/radial gradients,
`border` and single-side borders, `box-shadow`, per-corner `border-radius`,
`transform: rotate()`, `opacity`, `overflow: hidden`, and the text properties
`font-size`, `font-weight`, `line-height`, `letter-spacing`, `text-align`,
`color`. Inline `<svg>` is kept verbatim, which is how icons are drawn.
`layer-name="…"` names the layer.

For `width`/`height`: a pixel length, `100%` to fill the parent, or omit to
size to the content. Other percentages have no equivalent in the model.

No CSS Grid, and no stylesheets — put styles in the `style` attribute.
Whatever could not be represented comes back in `ignoredCss`; those
declarations did not take effect, so read it.

## Try it

    claude -p "Using the canvas MCP tools, describe what is on the canvas." \
      --allowedTools "mcp__canvas__get_canvas_state"

    claude -p "Using the canvas MCP tools, add a 200x120 rounded blue card at 400,400 named Test." \
      --allowedTools "mcp__canvas__create_node"

Then press Cmd+Z in the app — the whole build undoes in one press.

## The design brief the server sends

The server sends `instructions` at connection, and they matter more than any
tool: a bare tool surface produces generated-looking output, and the same
model given a designer's working method produces something finished. They ask
the agent to read the canvas first, settle a palette and a type scale before
drawing, build **one visual group per `write_html` call**, and **screenshot
and fix after each group** rather than emitting a whole screen blind.

`get_guide` carries the depth — `design-basics`, `layout`, `css`, `icons` —
including the two rules behind most misalignment: fixed-width slots with
`flex-shrink: 0` for icons and trailing controls (gap alone never aligns
columns across rows), and hugging rather than guessing a height when a frame
clips.

## Notes and current limits

- **Every agent write goes through the same store actions as a human edit**,
  so agent changes undo, persist and render identically. An agent's whole
  turn is one undo step.
- **Flex is real flex.** The canvas is DOM, so a node declared a flex
  container is laid out by the browser itself — nothing here computes
  positions. A child the parent lays out has no stored x/y worth reading, so
  every coordinate these tools report for one is measured from the rendered
  layout rather than taken from the model. In the app, dragging such a child
  detaches it to the absolute position it already occupied; resizing one
  keeps it in the flow and only changes its size.
- **CSS Grid is not supported**, in the node model or the parser.
- **A capture-path artifact:** a node with both a `border` and a
  `box-shadow` can rasterise with a pale rectangle beside it in
  `get_screenshot`. It is an artifact of the screenshot's foreignObject
  path, not of the document — the node itself is correct.
- If the app is closed, calls return "no canvas app is connected" rather
  than failing obscurely.
