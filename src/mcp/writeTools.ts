import { activeFile, useDoc, type AlignEdge } from "../document/store";
import { endAgentBuild, noteAgentWrite } from "./buildScope";
import type { NodeId, NodeType, SceneNode } from "../document/types";
import { registerTool } from "./bridge";

/** One key per tool call, so a create or an update that touches several
 *  store actions collapses into a single undo step — matching how the same
 *  change made by hand undoes in one press. */
let seq = 0;
/** Every agent write belongs to the build in progress, so undo takes the whole
 *  attempt back rather than one node at a time. */
const gestureKey = (op: string, ids: string[] = []) => {
  noteAgentWrite(op, ids);
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
  // How the node sizes itself. "auto" is what stops a frame clipping: it hugs
  // its content instead of holding a height someone guessed.
  for (const axis of ["sizeW", "sizeH"] as const) {
    const v = args[axis];
    if (v === undefined) continue;
    const mode = String(v);
    if (!["fixed", "auto", "fill"].includes(mode)) {
      throw new Error(`${axis} must be "fixed", "auto" or "fill"`);
    }
    patch[axis] = mode as SceneNode["sizeW"];
  }
  if (args.visible !== undefined) patch.visible = !!args.visible;
  if (args.locked !== undefined) patch.locked = !!args.locked;
  if (args.text !== undefined) patch.text = String(args.text);
  if (args.fontSize !== undefined) patch.fontSize = Math.max(1, num(args.fontSize, "fontSize"));
  if (args.fontWeight !== undefined) {
    patch.fontWeight = Math.min(900, Math.max(100, num(args.fontWeight, "fontWeight")));
  }
  if (args.lineHeight !== undefined) {
    patch.lineHeight = Math.max(1, num(args.lineHeight, "lineHeight"));
  }
  if (args.letterSpacing !== undefined) {
    patch.letterSpacing = num(args.letterSpacing, "letterSpacing");
  }
  if (args.textAlign !== undefined) {
    const a = String(args.textAlign);
    if (!["left", "center", "right"].includes(a)) {
      throw new Error("textAlign must be left, center or right");
    }
    patch.textAlign = a as "left" | "center" | "right";
  }
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
      ...(made.type === "text"
        ? {
            text: made.text, fontSize: made.fontSize,
            fontWeight: made.fontWeight, textAlign: made.textAlign,
          }
        : {}),
    };
  });

  registerTool("update_node", (args) => {
    const id = String(args.id ?? "");
    const node = requireNode(id);
    const st = useDoc.getState();

    // Geometry and styles are separate store actions, mirroring how a drag
    // and a panel edit differ in the UI.
    const key = gestureKey("update", [id]);
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
    noteAgentWrite("delete", ids);
    useDoc.getState().removeNodes(ids);
    return { deleted: ids };
  });

  registerTool("duplicate_node", (args) => {
    const ids = Array.isArray(args.ids)
      ? args.ids.map(String)
      : [String(args.id ?? "")];
    ids.forEach(requireNode);
    const offset = args.offset === undefined ? 10 : num(args.offset, "offset");
    noteAgentWrite("duplicate", ids);
    const { made, map } = useDoc.getState().duplicateNodes(ids, offset);
    noteAgentWrite("duplicate", made);
    // The map lets the caller style or retext a cloned child straight away,
    // instead of reading back the tree it just created.
    return { created: made, descendantIdMap: map };
  });

  /**
   * Restructure without rewriting.
   *
   * Reordering or reparenting through HTML would mint new ids and invalidate
   * every reference the caller is holding. This keeps them.
   */
  /**
   * Many nodes, one call.
   *
   * A design change is usually a change to a set of nodes — every row's
   * label, a group's fill. One call per node makes that cost a round trip and
   * a result payload each, for what is one edit conceptually, and it lands as
   * several undo steps unless every call happens to share a gesture key.
   */
  registerTool("update_nodes", (args) => {
    const updates = Array.isArray(args.updates) ? args.updates : [];
    if (updates.length === 0) throw new Error("updates is required");

    const key = gestureKey("update", updates.flatMap((u) => {
      const e = u as Record<string, unknown>;
      return Array.isArray(e.nodeIds) ? e.nodeIds.map(String) : [String(e.nodeId ?? "")];
    }));

    const touched: string[] = [];
    const st = useDoc.getState();
    for (const raw of updates) {
      const entry = raw as Record<string, unknown>;
      const ids = Array.isArray(entry.nodeIds)
        ? entry.nodeIds.map(String)
        : [String(entry.nodeId ?? "")];
      const props = (entry.styles ?? entry) as Record<string, unknown>;

      for (const id of ids) {
        requireNode(id);
        const rect: Partial<{ x: number; y: number; width: number; height: number }> = {};
        if (props.x !== undefined) rect.x = num(props.x, "x");
        if (props.y !== undefined) rect.y = num(props.y, "y");
        if (props.width !== undefined) rect.width = Math.max(1, num(props.width, "width"));
        if (props.height !== undefined) rect.height = Math.max(1, num(props.height, "height"));
        if (Object.keys(rect).length) st.setNodeRect(id, rect, key);

        const patch = stylePatch(props);
        if (Object.keys(patch).length) st.updateNode(id, patch, key);
        touched.push(id);
      }
    }
    noteAgentWrite("update", touched);
    return { updated: touched };
  });

  /** Text only, batched. Far cheaper than rewriting the markup around it. */
  registerTool("set_text_content", (args) => {
    const updates = Array.isArray(args.updates) ? args.updates : [];
    if (updates.length === 0) throw new Error("updates is required");

    const ids = updates.map((u) => String((u as Record<string, unknown>).nodeId ?? ""));
    const key = gestureKey("text", ids);
    const st = useDoc.getState();
    for (const raw of updates) {
      const entry = raw as Record<string, unknown>;
      const id = String(entry.nodeId ?? "");
      const node = requireNode(id);
      if (node.type !== "text") {
        throw new Error(`node "${id}" is a ${node.type}, not text`);
      }
      st.updateNode(id, { text: String(entry.text ?? entry.textContent ?? "") }, key);
    }
    noteAgentWrite("text", ids);
    return { updated: ids };
  });

  registerTool("move_nodes", (args) => {
    const raw = Array.isArray(args.moves) ? args.moves : [];
    if (raw.length === 0) throw new Error("moves is required");

    const moves = raw.map((m) => {
      const mv = m as Record<string, unknown>;
      const id = String(mv.nodeId ?? mv.id ?? "");
      requireNode(id);
      const out: { id: string; parent?: string | null; index?: number } = { id };
      if (mv.parentId !== undefined) {
        // "root" is how a caller asks for the page itself, which has no id.
        const p = mv.parentId === null || mv.parentId === "root"
          ? null
          : String(mv.parentId);
        if (p !== null) {
          const target = requireNode(p);
          if (target.type !== "frame") {
            throw new Error("only a frame can contain other nodes");
          }
        }
        out.parent = p;
      }
      if (mv.index !== undefined) out.index = num(mv.index, "index");
      return out;
    });

    noteAgentWrite("move", moves.map((m) => m.id));
    const affected = useDoc.getState().moveNodes(moves);
    return {
      moved: moves.map((m) => m.id),
      // The post-move child list of every parent that changed, so the caller
      // does not need a follow-up read to know where things ended up.
      affectedParents: affected.map((a) => ({
        parentId: a.parent ?? "root",
        children: a.children,
      })),
    };
  });

  /** Align or evenly space a set of nodes — the same actions the panel's
   *  alignment bar runs, so both paths behave identically. */
  registerTool("align_nodes", (args) => {
    const ids = (Array.isArray(args.ids) ? args.ids : []).map(String);
    ids.forEach(requireNode);
    const edge = args.edge ? String(args.edge) : null;
    const axis = args.distribute ? String(args.distribute) : null;

    if (edge) {
      if (ids.length < 2) throw new Error("aligning needs at least two nodes");
      noteAgentWrite("align", ids);
      useDoc.getState().align(ids, edge as AlignEdge);
    }
    if (axis) {
      if (ids.length < 3) throw new Error("distributing needs at least three nodes");
      noteAgentWrite("distribute", ids);
      useDoc.getState().distribute(ids, axis === "v" ? "v" : "h");
    }
    if (!edge && !axis) throw new Error("pass edge, distribute, or both");
    return { ids, edge, distribute: axis };
  });

  /**
   * A page to design on.
   *
   * Not the same thing as a frame. An artboard is a container for a document,
   * so it lays its children out rather than leaving them to position
   * themselves, it is placed clear of whatever is already on the page, and it
   * comes at a real device size. Making the caller supply all of that every
   * time is how boards end up overlapping at arbitrary sizes.
   */
  registerTool("create_artboard", (args) => {
    const DEVICES: Record<string, { width: number; height: number }> = {
      desktop: { width: 1440, height: 900 },
      tablet: { width: 768, height: 1024 },
      mobile: { width: 390, height: 844 },
    };
    const device = String(args.device ?? "desktop").toLowerCase();
    const preset = DEVICES[device] ?? DEVICES.desktop;
    const width = args.width === undefined ? preset.width : num(args.width, "width");
    const height = args.height === undefined ? preset.height : num(args.height, "height");

    // Placed to the right of everything already on the page, with a gap, so a
    // new board never lands on top of existing work.
    const f = activeFile();
    const page = f.doc.pages[f.currentPageId];
    const GAP = 80;
    let x = 0;
    let y = 0;
    for (const id of page.children) {
      const n = f.doc.nodes[id];
      if (!n) continue;
      x = Math.max(x, Math.round(n.x + n.width + GAP));
      y = Math.min(y, Math.round(n.y));
    }

    const id = useDoc.getState().addNode(
      "frame",
      { x, y, width, height },
      null,
    );
    useDoc.getState().updateNode(id, {
      name: String(args.name ?? "Artboard"),
      fill: args.background ? String(args.background) : "#FFFFFF",
      // A document stacks its sections; it does not scatter them.
      layout: "flow",
    });
    noteAgentWrite("create", [id]);
    return { id, x, y, width, height, device };
  });

  registerTool("rename_nodes", (args) => {
    const updates = Array.isArray(args.updates) ? args.updates : [];
    if (updates.length === 0) throw new Error("updates is required");
    const st = useDoc.getState();
    const key = gestureKey("rename", updates.map((u) =>
      String((u as Record<string, unknown>).nodeId ?? "")));
    const done: string[] = [];
    for (const raw of updates) {
      const e = raw as Record<string, unknown>;
      const id = String(e.nodeId ?? e.id ?? "");
      requireNode(id);
      // Long names make the layer list unreadable rather than more precise.
      st.updateNode(id, { name: String(e.name ?? "").slice(0, 50) }, key);
      done.push(id);
    }
    return { renamed: done };
  });

  /**
   * Clear the "being worked on" marks.
   *
   * The build indicator says the agent is still in here. Left on, the user
   * cannot tell a finished design from one that stopped halfway.
   */
  registerTool("finish_working", () => {
    endAgentBuild();
    return { ok: true };
  });

  registerTool("set_selection", (args) => {
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
    ids.forEach(requireNode);
    useDoc.getState().select(ids);
    return { selection: ids };
  });
}
