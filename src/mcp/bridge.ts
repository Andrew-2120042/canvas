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

/**
 * Whether a family renders as itself rather than being substituted.
 *
 * Measured, because a missing font is not an error — two strings set in the
 * candidate against a known fallback measure identically when nothing of the
 * candidate was used.
 */
function fontRenders(family: string): boolean {
  if (/^(system-ui|sans-serif|serif|monospace|cursive|fantasy|ui-[\w-]+)$/i.test(family)) {
    return true;
  }
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;
  const probe = "MWQ_iljI mmmmwwww";
  const width = (stack: string): number => {
    ctx.font = `72px ${stack}`;
    return ctx.measureText(probe).width;
  };
  const quoted = `"${family.replace(/"/g, "")}"`;
  return width(`${quoted}, monospace`) !== width("monospace")
    || width(`${quoted}, serif`) !== width("serif");
}

const handlers: Record<string, Handler> = {
  /**
   * Everything needed to decide what to do first.
   *
   * Counts are not orientation. What a design actually turns on is the size
   * of the boards already there — a 390-wide artboard is a phone and a
   * 1440-wide one is not — and which typefaces the document has committed
   * to, so a new section matches the work beside it rather than introducing
   * a fourth font.
   */
  get_status: () => {
    const s = useDoc.getState();
    const f = activeFile();
    const page = f.doc.pages[f.currentPageId];

    const nodes = Object.values(f.doc.nodes);

    // What was asked for is not what renders. A family that is not installed
    // does not error — the engine quietly substitutes another — so reporting
    // the requested name told a caller to match a font that was never on
    // screen. Each one is checked against what the engine actually resolves.
    // Deduplicated by the family that actually gets used, not by the stack
    // it was written in. Two nodes asking for `Helvetica Neue, sans-serif`
    // and `Helvetica Neue, Arial` are asking for one font, and listing it
    // twice makes the reader think there are two.
    const families = [...new Set(
      nodes
        .map((n) => n.fontFamily)
        .filter((x): x is string => !!x)
        .map((stack) => stack.split(",")[0].trim().replace(/^["']|["']$/g, "")),
    )].sort();
    const fonts = families.map((family) => ({
      family,
      rendering: fontRenders(family),
    }));

    // Top-level frames are the boards being designed on.
    const artboards = (page?.children ?? [])
      .map((id) => f.doc.nodes[id])
      .filter((n) => n && n.type === "frame")
      .map((n) => ({
        id: n.id,
        name: n.name,
        x: Math.round(n.x),
        y: Math.round(n.y),
        width: Math.round(n.width),
        height: Math.round(n.height),
        childCount: n.children.length,
      }));

    return {
      appConnected: true,
      activeFile: f.name,
      openFiles: s.fileOrder.map((id) => s.files[id].name),
      currentPage: page?.name ?? null,
      pages: f.doc.pageOrder.map((id) => ({
        id, name: f.doc.pages[id].name, current: id === f.currentPageId,
      })),
      artboards,
      // Families already in the document. Prefer these over introducing a new
      // one, unless the brief calls for it.
      // `rendering: false` means text was set in this family but something
      // else is on screen. Do not match it — pick a family that resolves.
      fontFamilies: fonts,
      pageBackground: page?.background ?? null,
      nodeCount: nodes.length,
      selection: f.selection,
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
