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

  return server;
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
