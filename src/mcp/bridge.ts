import { invoke } from "@tauri-apps/api/core";
import { activeFile, useDoc } from "../document/store";

/**
 * Link from the local MCP sidecar into this app.
 *
 * Tool calls arrive here and are executed against the document store — by the
 * same named actions the canvas UI calls. That is the rule the whole phase
 * rests on: an agent edit and a human edit are the same write, so undo
 * already covers agent edits and Phase 4's sync layer has one seam to wrap
 * rather than two to reconcile.
 */

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  get_status: () => {
    const s = useDoc.getState();
    const f = activeFile();
    return {
      appConnected: true,
      openFiles: s.fileOrder.map((id) => s.files[id].name),
      activeFile: f.name,
      currentPage: f.doc.pages[f.currentPageId]?.name ?? null,
      pageCount: f.doc.pageOrder.length,
      nodeCount: Object.keys(f.doc.nodes).length,
      selectionCount: f.selection.length,
    };
  },
};

/** Register a tool implementation. Read and write tools land here in 2.2/2.3. */
export function registerTool(name: string, fn: Handler): void {
  handlers[name] = fn;
}

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let stopped = false;
let currentPort: number | null = null;

function connect(port: number): void {
  if (stopped) return;
  socket = new WebSocket(`ws://127.0.0.1:${port}/app`);

  socket.onmessage = async (event) => {
    let msg: { id: string; op: string; args?: Record<string, unknown> };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }
    const fn = handlers[msg.op];
    if (!fn) {
      socket?.send(JSON.stringify({
        id: msg.id, ok: false, error: `unknown operation: ${msg.op}`,
      }));
      return;
    }
    try {
      const result = await fn(msg.args ?? {});
      socket?.send(JSON.stringify({ id: msg.id, ok: true, result }));
    } catch (err) {
      socket?.send(JSON.stringify({
        id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  // The sidecar may still be starting, or may be restarted under us; keep
  // retrying rather than leaving the agent silently disconnected.
  socket.onclose = () => {
    socket = null;
    if (!stopped) retry = setTimeout(() => connect(port), 1000);
  };
  socket.onerror = () => socket?.close();
}

/** Start the sidecar and attach to it. Returns the port it is listening on. */
export async function startMcp(): Promise<number> {
  stopped = false;
  const port = await invoke<number>("start_mcp_server");
  currentPort = port;
  connect(port);
  return port;
}

export async function stopMcp(): Promise<void> {
  stopped = true;
  if (retry) clearTimeout(retry);
  retry = null;
  socket?.close();
  socket = null;
  currentPort = null;
  await invoke("stop_mcp_server");
}

export function mcpPort(): number | null {
  return currentPort;
}
