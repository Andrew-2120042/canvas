import { activeFile, useDoc } from "../document/store";
import { noteAgentWrite } from "./buildScope";
import type { NodeId, NodeType, SceneNode } from "../document/types";
import { registerTool } from "./bridge";

/** One key per tool call, so a create or an update that touches several
 *  store actions collapses into a single undo step — matching how the same
 *  change made by hand undoes in one press. */
let seq = 0;
const gestureKey = (op: string) => {
  // Every agent write belongs to the build in progress, so undo takes the
  // whole attempt back rather than one node at a time.
  noteAgentWrite();
  return `mcp:${op}:${Date.now()}:${seq++}`;
};

/**
 * Write-side tools.
 *
 * Every one of these calls the same named store action a human interaction
 * already calls — `addNode`, `updateNode`, `setNodeRect`, `removeNodes`,
 * `duplicateNodes`. None of them touches `doc` directly.
 *
 * That is not tidiness. Undo wraps the action set, so an agent edit is
 * undoable for free; and Phase 4's sync layer is built around that set being
 * the single source of truth for every write, human or agent. A second write
 * path here would have to be unpicked later.
 */

const TYPES: NodeType[] = ["frame", "rect", "text", "image", "path"];

function num(v: unknown, field: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  return n;
}

function requireNode(id: NodeId): SceneNode {
  const n = activeFile().doc.nodes[id];
  if (!n) throw new Error(`no node with id "${id}"`);
  return n;
}

/** Fields an agent may set, mapped to what the store expects. */
function stylePatch(args: Record<string, unknown>): Partial<SceneNode> {
  const patch: Partial<SceneNode> = {};
  if (args.name !== undefined) patch.name = String(args.name);
  if (args.fill !== undefined) patch.fill = String(args.fill);
  if (args.opacity !== undefined) {
    const o = num(args.opacity, "opacity");
    if (o < 0 || o > 1) throw new Error("opacity must be between 0 and 1");
    patch.opacity = o;
  }
  if (args.radius !== undefined) patch.radius = Math.max(0, num(args.radius, "radius"));
  if (args.visible !== undefined) patch.visible = !!args.visible;
  if (args.locked !== undefined) patch.locked = !!args.locked;
  if (args.text !== undefined) patch.text = String(args.text);
  if (args.fontSize !== undefined) patch.fontSize = Math.max(1, num(args.fontSize, "fontSize"));
  return patch;
}

export function registerWriteTools(): void {
  registerTool("create_node", (args) => {
    const type = String(args.type ?? "") as NodeType;
    if (!TYPES.includes(type)) {
      throw new Error(`type must be one of: ${TYPES.join(", ")}`);
    }
    const rect = {
      x: num(args.x ?? 0, "x"),
      y: num(args.y ?? 0, "y"),
      width: Math.max(1, num(args.width ?? 100, "width")),
      height: Math.max(1, num(args.height ?? 100, "height")),
    };

    const parent = args.parentId ? String(args.parentId) : null;
    if (parent) {
      const p = requireNode(parent);
      if (p.type !== "frame") throw new Error("only a frame can contain other nodes");
    }

    const st = useDoc.getState();
    const key = gestureKey("create");
    const id = st.addNode(type, rect, parent, key);  // same action the canvas calls
    const patch = stylePatch(args);
    if (Object.keys(patch).length) st.updateNode(id, patch, key);
    st.select([id]);
    // Echo what was actually applied, not just what was asked for: the agent
    // has no other way to confirm a property took effect, and it flagged the
    // omission the first time it used this tool.
    const made = activeFile().doc.nodes[id];
    return {
      id, type, parentId: parent,
      x: made.x, y: made.y, width: made.width, height: made.height,
      name: made.name, fill: made.fill, opacity: made.opacity, radius: made.radius,
      ...(made.type === "text" ? { text: made.text, fontSize: made.fontSize } : {}),
    };
  });

  registerTool("update_node", (args) => {
    const id = String(args.id ?? "");
    const node = requireNode(id);
    const st = useDoc.getState();

    // Geometry and styles are separate store actions, mirroring how a drag
    // and a panel edit differ in the UI.
    const key = gestureKey("update");
    const rect: Partial<{ x: number; y: number; width: number; height: number }> = {};
    if (args.x !== undefined) rect.x = num(args.x, "x");
    if (args.y !== undefined) rect.y = num(args.y, "y");
    if (args.width !== undefined) rect.width = Math.max(1, num(args.width, "width"));
    if (args.height !== undefined) rect.height = Math.max(1, num(args.height, "height"));
    if (Object.keys(rect).length) st.setNodeRect(id, rect, key);

    const patch = stylePatch(args);
    if (Object.keys(patch).length) st.updateNode(id, patch, key);

    if (!Object.keys(rect).length && !Object.keys(patch).length) {
      throw new Error("nothing to update; pass at least one property");
    }
    const after = activeFile().doc.nodes[id] ?? node;
    return {
      id, type: after.type, name: after.name,
      x: after.x, y: after.y, width: after.width, height: after.height,
      fill: after.fill, opacity: after.opacity, radius: after.radius,
      visible: after.visible, locked: after.locked,
      ...(after.type === "text" ? { text: after.text, fontSize: after.fontSize } : {}),
    };
  });

  registerTool("delete_node", (args) => {
    const ids = Array.isArray(args.ids)
      ? args.ids.map(String)
      : [String(args.id ?? "")];
    ids.forEach(requireNode);
    noteAgentWrite();
    useDoc.getState().removeNodes(ids);
    return { deleted: ids };
  });

  registerTool("duplicate_node", (args) => {
    const ids = Array.isArray(args.ids)
      ? args.ids.map(String)
      : [String(args.id ?? "")];
    ids.forEach(requireNode);
    const offset = args.offset === undefined ? 10 : num(args.offset, "offset");
    noteAgentWrite();
    const made = useDoc.getState().duplicateNodes(ids, offset);
    return { created: made };
  });

  registerTool("set_selection", (args) => {
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
    ids.forEach(requireNode);
    useDoc.getState().select(ids);
    return { selection: ids };
  });
}
