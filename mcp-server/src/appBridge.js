import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

/** How long a tool call waits for the app to answer before giving up. */
const CALL_TIMEOUT_MS = 10_000;

/**
 * Longer for the operations that legitimately take seconds.
 *
 * Most calls read or write state and answer at once, so a short timeout is
 * right for them: a hung app should be reported rather than waited on. But a
 * fidelity comparison rasterises a whole page twice, a band at a time, and on
 * a long document that is genuinely several seconds of work. Timing it out
 * reports a broken app when the app is doing exactly what was asked, and
 * sends whoever reads it looking for a fault that is not there.
 */
const SLOW_OPS = new Set(["compare_to_source", "get_screenshot"]);
const SLOW_TIMEOUT_MS = 120_000;

/**
 * Link between the MCP server and the running canvas app.
 *
 * The canvas lives in the app's webview, and every mutation must go through
 * the same store actions the UI calls — so this process never owns document
 * state. It forwards each tool call to the app and relays the reply back.
 * That indirection is the point: it makes routing around the store actions
 * impossible from here.
 */
export class AppBridge {
  constructor() {
    this.socket = null;
    this.pending = new Map();
  }

  attach(httpServer, path = "/app") {
    this.wss = new WebSocketServer({ server: httpServer, path });
    this.wss.on("connection", (ws) => {
      // One app window owns the bridge; a reconnect replaces the old socket.
      if (this.socket && this.socket.readyState === this.socket.OPEN) {
        this.socket.close(1000, "replaced by a newer app connection");
      }
      this.socket = ws;
      console.error("[bridge] canvas app connected");

      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.ok) entry.resolve(msg.result);
        else entry.reject(new Error(msg.error ?? "the canvas app reported an error"));
      });

      ws.on("close", () => {
        if (this.socket === ws) this.socket = null;
        console.error("[bridge] canvas app disconnected");
      });
    });
  }

  get connected() {
    return !!this.socket && this.socket.readyState === this.socket.OPEN;
  }

  /** Ask the app to run one operation and wait for its reply. */
  call(op, args = {}) {
    if (!this.connected) {
      return Promise.reject(
        new Error("no canvas app is connected; open a file in the app first"),
      );
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the canvas app did not answer "${op}" in time`));
      }, SLOW_OPS.has(op) ? SLOW_TIMEOUT_MS : CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, op, args }));
    });
  }

  close() {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("the MCP server is shutting down"));
    }
    this.pending.clear();
    this.wss?.close();
    this.socket?.close();
  }
}
