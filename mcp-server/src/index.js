import http from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { AppBridge } from "./appBridge.js";
import { INSTRUCTIONS, guide, guideTopics } from "./guide.js";

const PORT = Number(process.env.CANVAS_MCP_PORT ?? process.argv[2] ?? 4319);
/** Loopback only. This server is one user's own agent talking to their own
 *  app on their own machine; it must not be reachable from the network. */
const HOST = "127.0.0.1";

const bridge = new AppBridge();

/** A fresh MCP server per session, all sharing the one app bridge. */
function buildServer() {
  const server = new McpServer(
    { name: "canvas", version: "0.1.0" },
    // Sent once at connection. Tool schemas say what can be called; this says
    // how to work — which is what actually decides whether the result looks
    // designed. See guide.js.
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "get_guide",
    {
      title: "Get guide",
      description:
        "How to work on this canvas: how to sequence a build so the user can " +
        "watch it, what the renderer supports and where it differs from a " +
        "browser, flex layout, and how to draw icons. Read `building` before " +
        "your first build — it is the one that changes how you should work. " +
        "Omit topic for all of it.",
      inputSchema: {
        topic: z
          .enum(["building", "design-basics", "layout", "css", "icons"])
          .optional()
          .describe("`building` is how to sequence calls and verify each group — read it first."),
      },
    },
    async (args) => ({ content: [{ type: "text", text: guide(args?.topic) }] }),
  );

  server.registerTool(
    "get_status",
    {
      title: "Get status",
      description:
        "Orientation: the open file, its pages, every artboard on the current " +
        "page with its position and size, the font families already in use, " +
        "and the selection. Call this first — artboard width tells you whether " +
        "you are designing for a phone or a desktop, and the font list is what " +
        "a new section should match.",
      inputSchema: {},
    },
    async () => {
      if (!bridge.connected) {
        return {
          content: [{
            type: "text",
            text: "The canvas app is not connected. Open a file in the app and try again.",
          }],
        };
      }
      const status = await bridge.call("get_status");
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    },
  );

  server.registerTool(
    "get_canvas_state",
    {
      title: "Get canvas state",
      description:
        "The current page as a tree of nodes, in paint order — the first " +
        "entry is furthest back. Use detail 'full' for style properties.",
      inputSchema: {
        pageId: z.string().optional().describe("Defaults to the current page."),
        detail: z.enum(["summary", "full"]).optional()
          .describe("'summary' is geometry and names; 'full' adds styles."),
      },
    },
    async (args) => text(await bridge.call("get_canvas_state", args)),
  );

  server.registerTool(
    "get_tree_summary",
    {
      title: "Get tree summary",
      description:
        "Counts and top-level nodes only — cheap to call on a large file. " +
        "Prefer this over get_canvas_state to get your bearings, then use " +
        "get_node on whatever you actually need.",
      inputSchema: {},
    },
    async () => text(await bridge.call("get_tree_summary")),
  );

  server.registerTool(
    "get_selection",
    {
      title: "Get selection",
      description: "The nodes the user currently has selected, with their properties.",
      inputSchema: {},
    },
    async () => text(await bridge.call("get_selection")),
  );

  server.registerTool(
    "get_node",
    {
      title: "Get node",
      description: "One node by id, with full properties.",
      inputSchema: {
        id: z.string().describe("The node id."),
        includeChildren: z.boolean().optional()
          .describe("Return the subtree rather than just this node."),
        depth: z.number().optional()
          .describe("How deep includeChildren goes. Default 3, max 10. Nodes at the limit keep their childIds so you can read on from there."),
      },
    },
    async (args) => text(await bridge.call("get_node", args)),
  );

  server.registerTool(
    "get_font_info",
    {
      title: "Get font info",
      description:
        "Whether a font family will actually render here, and what it offers " +
        "— the weights that are genuinely distinct, whether it has a real " +
        "italic, and the range of any variable width axis. Ask before setting " +
        "type for the first time: a missing family does not error, it " +
        "silently falls back to something else. A width axis is what lets a " +
        "display heading be truly condensed rather than merely bold.",
      inputSchema: {
        families: z.array(z.string()).describe("Family names to check."),
      },
    },
    async (args) => text(await bridge.call("get_font_info", args)),
  );

  server.registerTool(
    "create_artboard",
    {
      title: "Create artboard",
      description:
        "A page to design on. Placed clear of existing boards, sized to a " +
        "real device, and set to lay its children out in flow so sections " +
        "stack the way a page does. Prefer this over create_node for a new " +
        "screen. The height is a starting point: when content outgrows it, " +
        "set sizeH to \"auto\" rather than guessing a taller number.",
      inputSchema: {
        name: z.string().optional(),
        device: z.enum(["desktop", "tablet", "mobile"]).optional()
          .describe("desktop 1440x900, tablet 768x1024, mobile 390x844. Default desktop."),
        width: z.number().optional(),
        height: z.number().optional(),
        background: z.string().optional(),
      },
    },
    async (args) => text(await bridge.call("create_artboard", args)),
  );

  server.registerTool(
    "rename_nodes",
    {
      title: "Rename nodes",
      description:
        "Set the name shown in the layer tree. Text nodes are already named " +
        "from their own content, so this is for the frames around them — a " +
        "file full of layers called \"Frame\" is one nobody can navigate.",
      inputSchema: {
        updates: z.array(z.object({ nodeId: z.string(), name: z.string() })),
      },
    },
    async (args) => text(await bridge.call("rename_nodes", args)),
  );

  server.registerTool(
    "finish_working",
    {
      title: "Finish working",
      description:
        "Call when you are done. Clears the working indicator, so the user " +
        "can tell a finished design from one that stopped halfway.",
      inputSchema: {},
    },
    async (args) => text(await bridge.call("finish_working", args)),
  );

  server.registerTool(
    "find_nodes",
    {
      title: "Find nodes",
      description:
        "Find nodes by name, by text content, or by type, without reading " +
        "the tree. Give any combination — they narrow each other. Returns " +
        "each match's id, name, type and world box, which is what you need " +
        "to then edit or focus it. Prefer this over get_canvas_state when " +
        "you are looking for something specific: it costs the matches " +
        "rather than the page. Scoped to the current page unless nodeId " +
        "names a subtree.",
      inputSchema: {
        name: z.string().optional()
          .describe("Substring of the layer name, case-insensitive."),
        text: z.string().optional()
          .describe("Substring of a text node's content, case-insensitive."),
        type: z.enum(["frame", "rect", "text", "image", "path", "svg"]).optional()
          .describe("Only nodes of this type."),
        nodeId: z.string().optional()
          .describe("Search inside this subtree. Omit to search the page."),
        limit: z.number().optional()
          .describe("Most matches to return. Default 50, max 200. `truncated` says whether any were cut."),
      },
    },
    async (args) => text(await bridge.call("find_nodes", args)),
  );

  server.registerTool(
    "get_jsx",
    {
      title: "Get JSX",
      description:
        "Export a design as React or HTML — this is how what is on the " +
        "canvas becomes code in a codebase. Styles are read from the same " +
        "functions that paint the canvas, so geometry, spacing and colour " +
        "match the design rather than approximating it. Type inherits from " +
        "wherever you paste it unless the design set a font-family, so " +
        "glyphs can differ. Inline <svg> icons come out as real markup with JSX " +
        "attribute names. Pass nodeId for one component, or omit it for the " +
        "whole page. Local image paths are emitted as written and need " +
        "moving into the project's assets.",
      inputSchema: {
        nodeId: z.string().optional()
          .describe("Subtree to export. Omit for the whole page."),
        format: z.enum(["jsx", "html"]).optional()
          .describe("React JSX with a style object (default), or plain HTML with style attributes."),
        component: z.boolean().optional()
          .describe("JSX only. Wrap the markup in an exported function component, named from the layer. Default true."),
      },
    },
    async (args) => text(await bridge.call("get_jsx", args)),
  );

  server.registerTool(
    "get_layout",
    {
      title: "Get layout",
      description:
        "Layout health for a subtree, as text. Every node's world box and " +
        "size mode, plus a flat `issues` list of anything whose content " +
        "overflows its frame or is clipped by an ancestor. This answers " +
        "\"does it fit, is it hugging, is anything cut off\" for the cost of " +
        "a short reply rather than an image — check it first, and take a " +
        "screenshot only when the question is genuinely how something looks. " +
        "`ok: true` means the subtree fits. Pass nodeId for one section; " +
        "omit for the whole page.",
      inputSchema: {
        nodeId: z.string().optional()
          .describe("Subtree to inspect; omit for the whole page."),
        depth: z.number().optional()
          .describe("How many levels of boxes to include. Default 0 — just the verdict and any issues, which is what you usually want. Issues are found at any depth regardless."),
      },
    },
    async (args) => text(await bridge.call("get_layout", args)),
  );

  server.registerTool(
    "get_screenshot",
    {
      title: "Get screenshot",
      description:
        "A PNG of the current page, or of one node when nodeId is given. " +
        "Use this to see the design rather than only reading its structure. " +
        "The default 1x is enough for layout, spacing and colour; pass " +
        "scale: 2 only to read small text or inspect fine detail, since a " +
        "capture costs tokens in proportion to its pixel count.",
      inputSchema: {
        nodeId: z.string().optional()
          .describe("Capture just this node; omit for the whole page."),
        scale: z.number().optional()
          .describe("Render scale. 1 (default) for layout review, 2 for fine detail."),
      },
    },
    async (args) => {
      const shot = await bridge.call("get_screenshot", args);
      return {
        content: [
          { type: "image", data: shot.base64, mimeType: shot.mimeType },
          { type: "text", text: `${shot.width}x${shot.height} px` },
        ],
      };
    },
  );

  // --- write tools ---------------------------------------------------------
  // Each of these lands on the same store action a human interaction calls,
  // which is why an agent edit undoes exactly like a hand-made one.

  server.registerTool(
    "create_node",
    {
      title: "Create node",
      description:
        "Add a node to the current page. Coordinates are relative to " +
        "parentId when given, otherwise to the page.",
      inputSchema: {
        type: z.enum(["frame", "rect", "text", "image", "path"]),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        parentId: z.string().optional().describe("A frame to nest inside."),
        name: z.string().optional(),
        fill: z.string().optional().describe("CSS colour, e.g. #E8622A."),
        opacity: z.number().optional().describe("0 to 1."),
        radius: z.number().optional(),
        text: z.string().optional().describe("Text nodes only."),
        fontSize: z.number().optional().describe("Text nodes only."),
        fontWeight: z.number().optional()
          .describe("Text nodes only. 100-900; 400 normal, 600 semibold, 700 bold."),
        lineHeight: z.number().optional()
          .describe("Text nodes only, in px. Omit for automatic leading."),
        letterSpacing: z.number().optional().describe("Text nodes only, in em."),
        textAlign: z.enum(["left", "center", "right"]).optional()
          .describe("Text nodes only."),
      },
    },
    async (args) => text(await bridge.call("create_node", args)),
  );

  server.registerTool(
    "update_node",
    {
      title: "Update node",
      description:
        "Change any subset of a node's geometry or style. To stop a frame " +
        "clipping its content, set sizeH to \"auto\" so it hugs instead of " +
        "guessing a taller height.",
      inputSchema: {
        id: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        sizeW: z.enum(["fixed", "auto", "fill"]).optional()
          .describe("fixed = the given width; auto = hug content; fill = fill the parent."),
        sizeH: z.enum(["fixed", "auto", "fill"]).optional()
          .describe("fixed = the given height; auto = hug content; fill = fill the parent."),
        name: z.string().optional(),
        fill: z.string().optional(),
        opacity: z.number().optional(),
        radius: z.number().optional(),
        visible: z.boolean().optional(),
        locked: z.boolean().optional(),
        text: z.string().optional(),
        fontSize: z.number().optional(),
        fontWeight: z.number().optional().describe("100-900."),
        lineHeight: z.number().optional().describe("px; omit for automatic."),
        letterSpacing: z.number().optional().describe("em."),
        textAlign: z.enum(["left", "center", "right"]).optional(),
      },
    },
    async (args) => text(await bridge.call("update_node", args)),
  );

  server.registerTool(
    "update_nodes",
    {
      title: "Update nodes",
      description:
        "Change many nodes in one call. Each entry applies one set of " +
        "properties to every node id listed with it. Prefer this over " +
        "repeated update_node calls: it is one round trip and one undo step. " +
        "To stop a frame clipping its content, set sizeH to \"auto\".",
      inputSchema: {
        updates: z.array(z.object({
          nodeIds: z.array(z.string()),
          styles: z.record(z.any())
            .describe("Any properties update_node accepts, applied to every id above."),
        })).describe("At least one entry."),
      },
    },
    async (args) => text(await bridge.call("update_nodes", args)),
  );

  server.registerTool(
    "set_text_content",
    {
      title: "Set text content",
      description:
        "Replace the text of text nodes, batched. Use this rather than " +
        "rewriting HTML whenever only the words change — it is much cheaper " +
        "and keeps node ids intact.",
      inputSchema: {
        updates: z.array(z.object({
          nodeId: z.string(),
          text: z.string(),
        })).describe("One entry per text node."),
      },
    },
    async (args) => text(await bridge.call("set_text_content", args)),
  );

  server.registerTool(
    "move_nodes",
    {
      title: "Move nodes",
      description:
        "Reorder or reparent existing nodes while keeping their ids, so any " +
        "reference you already hold stays valid — use this rather than " +
        "rewriting HTML just to change structure. Moves apply in order, each " +
        "seeing the previous one's result. In a flex parent this changes " +
        "visual order; otherwise it changes stacking, last child on top. " +
        "Returns the new child list of every parent that changed.",
      inputSchema: {
        moves: z.array(z.object({
          nodeId: z.string(),
          parentId: z.string().optional()
            .describe('A frame to move into, or "root" for the page itself. Omit to keep the current parent.'),
          index: z.number().optional()
            .describe("Position among the children. Omit to append. Clamped to the valid range."),
        })).describe("At least one move."),
      },
    },
    async (args) => text(await bridge.call("move_nodes", args)),
  );

  server.registerTool(
    "delete_node",
    {
      title: "Delete node",
      description: "Remove a node and its children.",
      inputSchema: {
        id: z.string().optional(),
        ids: z.array(z.string()).optional().describe("Delete several at once."),
      },
    },
    async (args) => text(await bridge.call("delete_node", args)),
  );

  server.registerTool(
    "duplicate_node",
    {
      title: "Duplicate node",
      description: "Copy a node and its children, offset from the original.",
      inputSchema: {
        id: z.string().optional(),
        ids: z.array(z.string()).optional(),
        offset: z.number().optional().describe("Pixels to offset the copy; default 10."),
      },
    },
    async (args) => text(await bridge.call("duplicate_node", args)),
  );

  server.registerTool(
    "write_html",
    {
      title: "Write HTML",
      description:
        "Create nodes from HTML and CSS — the main way to build a design. " +
        "IMAGES: put an absolute file path in <img src> — the app reads the " +
        "file itself. Never base64 a local image into a data URL and never " +
        "shrink one to make it fit; a path costs about forty characters and " +
        "keeps the picture at full resolution. " +
        "IMPORTANT: write incrementally. One call builds one visual group — " +
        "a header, a card, one row of a list, a footer. Not a whole screen, " +
        "and not a whole component either: a card with a header, four rows " +
        "and a footer is six calls, not one. The user is watching the canvas " +
        "as you work, and a design that appears all at once after a minute " +
        "of silence is a black box they cannot follow or interrupt. Build " +
        "the group, look at it, then build the next one. Still do not place " +
        "a design node by node — the unit is a group, not a box. Real flexbox is supported (display:flex, " +
        "flex-direction, gap, flex-wrap, justify-content, align-items, " +
        "align-self, flex-grow, flex-shrink, the flex shorthand, padding), " +
        "along with background colours and linear/radial gradients, border " +
        "and single-side borders, box-shadow, per-corner border-radius, " +
        "transform:rotate, opacity, overflow:hidden, and the text properties " +
        "font-size/weight/line-height/letter-spacing/text-align/color. " +
        "For width and height use a pixel length, 100% to fill the parent, " +
        "or leave it out to size to the content. Inline <svg> is kept as-is, " +
        "which is how icons and illustrations are drawn. Add layer-name=\"…\" " +
        "to any element to name the layer. " +
        "Write ordinary CSS: anything without special handling here is passed " +
        "to the browser unchanged and behaves as it would on a web page, " +
        "including grid, margin and percentage padding. A <style> block is " +
        "honoured too — the cascade is resolved by the browser — so real page " +
        "markup can be pasted in as it stands. ignoredCss lists only what " +
        "genuinely could not be applied; it is normally empty.",
      inputSchema: {
        html: z.string().describe("A complete HTML fragment with inline styles."),
        targetNodeId: z.string().optional()
          .describe("A frame to insert into. Omit to add at page level."),
        mode: z.enum(["insert-children", "replace-children"]).optional()
          .describe("Append to the target, or replace what it holds. Default append."),
      },
    },
    async (args) => text(await bridge.call("write_html", args)),
  );

  server.registerTool(
    "align_nodes",
    {
      title: "Align nodes",
      description:
        "Align nodes to a shared edge or centre, and/or space them evenly. " +
        "Aligning needs two nodes, distributing needs three. Runs the same " +
        "actions as the panel's alignment bar.",
      inputSchema: {
        ids: z.array(z.string()),
        edge: z.enum(["left", "hcenter", "right", "top", "vcenter", "bottom"]).optional(),
        distribute: z.enum(["h", "v"]).optional()
          .describe("Even gaps along this axis, holding the outermost two in place."),
      },
    },
    async (args) => text(await bridge.call("align_nodes", args)),
  );

  server.registerTool(
    "list_comments",
    {
      title: "List comments",
      description:
        "Comments the user has left on the canvas, with the page and the " +
        "point each is pinned to. Read these before acting on feedback — an " +
        "open comment is work someone is asking for. Shows open ones by default.",
      inputSchema: {
        status: z.enum(["open", "resolved", "all"]).optional(),
        pageId: z.string().optional().describe("Restrict to one page."),
      },
    },
    async (args) => text(await bridge.call("list_comments", args)),
  );

  server.registerTool(
    "resolve_comment",
    {
      title: "Resolve comment",
      description:
        "Mark a comment resolved once its feedback is actually addressed in " +
        "the design, or pass resolved:false to reopen it. Never resolve a " +
        "comment you did not act on.",
      inputSchema: {
        id: z.string(),
        resolved: z.boolean().optional().describe("Defaults to true."),
      },
    },
    async (args) => text(await bridge.call("resolve_comment", args)),
  );

  server.registerTool(
    "list_pages",
    {
      title: "List pages",
      description:
        "Every page in the open file with its node count, and which one is " +
        "current. Work lands on the current page, so check this before " +
        "assuming where a design will appear.",
      inputSchema: {},
    },
    async (args) => text(await bridge.call("list_pages", args)),
  );

  server.registerTool(
    "set_page",
    {
      title: "Set page",
      description: "Switch the file to a different page. Later writes land there.",
      inputSchema: { pageId: z.string() },
    },
    async (args) => text(await bridge.call("set_page", args)),
  );

  server.registerTool(
    "create_page",
    {
      title: "Create page",
      description:
        "Add a page to the open file. Does not switch to it — call set_page " +
        "with the returned id to start working there.",
      inputSchema: { name: z.string().optional() },
    },
    async (args) => text(await bridge.call("create_page", args)),
  );

  server.registerTool(
    "focus_node",
    {
      title: "Focus node",
      description:
        "Pan and zoom the user's canvas to a node, so they are looking at " +
        "what you are talking about. Omit zoom to fit the node in the view.",
      inputSchema: {
        nodeId: z.string(),
        zoom: z.number().optional().describe("1 = 100%. Omit to fit."),
      },
    },
    async (args) => text(await bridge.call("focus_node", args)),
  );

  server.registerTool(
    "set_selection",
    {
      title: "Set selection",
      description: "Select nodes, so the user sees what you are referring to.",
      inputSchema: { ids: z.array(z.string()) },
    },
    async (args) => text(await bridge.call("set_selection", args)),
  );

  return server;
}

/** Tool results are JSON for the agent to read. */
function text(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const sessions = new Map();

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  console.error(`[http] ${req.method} ${url.pathname}` +
    (req.headers.authorization ? " (with auth header)" : ""));

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, appConnected: bridge.connected, port: PORT }));
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404).end();
    return;
  }

  const sessionId = req.headers["mcp-session-id"];
  let transport = sessionId ? sessions.get(sessionId) : undefined;

  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, transport),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await buildServer().connect(transport);
  }

  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("[mcp] request failed:", err);
    if (!res.headersSent) res.writeHead(500).end();
  }
});

bridge.attach(httpServer, "/app");

httpServer.listen(PORT, HOST, () => {
  // The app reads this line to learn the port it actually got.
  console.log(`CANVAS_MCP_LISTENING ${PORT}`);
  console.error(`[mcp] listening on http://${HOST}:${PORT}/mcp`);
});

/**
 * Exit when the app that spawned us goes away.
 *
 * The app's own teardown handler covers a clean quit, but not a crash or a
 * force-quit — and an orphaned sidecar keeps a port and a socket open. On
 * POSIX a reparented child sees its ppid become 1, which is a reliable signal
 * without needing the parent to tell us anything.
 */
const PARENT_PID = process.ppid;
setInterval(() => {
  let parentGone = process.ppid !== PARENT_PID;
  if (!parentGone) {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      parentGone = true;
    }
  }
  if (parentGone) {
    console.error("[mcp] parent process is gone; exiting");
    shutdown();
  }
}, 1000).unref();

function shutdown() {
  console.error("[mcp] shutting down");
  bridge.close();
  httpServer.close(() => process.exit(0));
  // Do not hang on a wedged socket.
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
