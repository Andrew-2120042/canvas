import http from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { AppBridge } from "./appBridge.js";

const PORT = Number(process.env.CANVAS_MCP_PORT ?? process.argv[2] ?? 4319);
/** Loopback only. This server is one user's own agent talking to their own
 *  app on their own machine; it must not be reachable from the network. */
const HOST = "127.0.0.1";

const bridge = new AppBridge();

/** A fresh MCP server per session, all sharing the one app bridge. */
function buildServer() {
  const server = new McpServer(
    { name: "canvas", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "get_status",
    {
      title: "Get status",
      description:
        "Whether the canvas app is connected and which document is open. " +
        "Call this first if other tools report no app connection.",
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
          .describe("Return the whole subtree rather than just this node."),
      },
    },
    async (args) => text(await bridge.call("get_node", args)),
  );

  server.registerTool(
    "get_screenshot",
    {
      title: "Get screenshot",
      description:
        "A PNG of the current page, or of one node when nodeId is given. " +
        "Use this to see the design rather than only reading its structure.",
      inputSchema: {
        nodeId: z.string().optional()
          .describe("Capture just this node; omit for the whole page."),
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
      },
    },
    async (args) => text(await bridge.call("create_node", args)),
  );

  server.registerTool(
    "update_node",
    {
      title: "Update node",
      description: "Change any subset of a node's geometry or style.",
      inputSchema: {
        id: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        name: z.string().optional(),
        fill: z.string().optional(),
        opacity: z.number().optional(),
        radius: z.number().optional(),
        visible: z.boolean().optional(),
        locked: z.boolean().optional(),
        text: z.string().optional(),
        fontSize: z.number().optional(),
      },
    },
    async (args) => text(await bridge.call("update_node", args)),
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
