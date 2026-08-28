import { activeFile, worldRect } from "../document/store";
import type { Doc, NodeId, SceneNode } from "../document/types";
import { registerTool } from "./bridge";

/**
 * Read-side tools.
 *
 * Everything here reads the same store the canvas renders from, so what the
 * agent sees and what the user sees cannot disagree.
 */

/** Node as the agent sees it: the stored fields plus absolute placement,
 *  since node coordinates are parent-relative and an agent reasoning about
 *  the page needs page coordinates. */
function describe(doc: Doc, id: NodeId, includeStyle: boolean) {
  const n = doc.nodes[id];
  if (!n) return null;
  const abs = worldRect(doc, id);

  const base: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    name: n.name,
    parent: n.parent,
    childIds: n.children,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    absoluteX: abs?.x ?? n.x,
    absoluteY: abs?.y ?? n.y,
    visible: n.visible,
    locked: n.locked,
  };

  if (!includeStyle) return base;

  base.fill = n.fill;
  base.opacity = n.opacity;
  base.radius = n.radius;
  if (n.type === "text") {
    base.text = n.text;
    base.fontSize = n.fontSize;
    base.lineHeight = n.lineHeight;
    base.letterSpacing = n.letterSpacing;
    base.textAlign = n.textAlign;
  }
  if (n.type === "path") {
    base.pointCount = n.points?.length ?? 0;
    base.closed = !!n.closed;
    base.strokeWidth = n.strokeWidth;
    base.strokeColor = n.strokeColor;
  }
  if (n.type === "image") {
    base.naturalWidth = n.naturalWidth;
    base.naturalHeight = n.naturalHeight;
    // The data URL can be megabytes; an agent wants to know it exists, not read it.
    base.hasImage = !!n.src;
  }
  for (const k of ["outline", "border", "shadows", "innerShadows", "filters", "guides"] as const) {
    if (n[k] !== undefined) base[k] = n[k];
  }
  return base;
}

function subtree(doc: Doc, id: NodeId, detail: "summary" | "full"): unknown {
  const node = describe(doc, id, detail === "full") as Record<string, unknown> | null;
  if (!node) return null;
  const n = doc.nodes[id];
  if (n.children.length) {
    node.children = n.children.map((c) => subtree(doc, c, detail));
    delete node.childIds;
  }
  return node;
}

export function registerReadTools(): void {
  registerTool("get_canvas_state", (args) => {
    const detail = args.detail === "full" ? "full" : "summary";
    const f = activeFile();
    const pageId = (args.pageId as string) || f.currentPageId;
    const page = f.doc.pages[pageId];
    if (!page) throw new Error(`no page with id "${pageId}"`);

    return {
      file: f.name,
      page: { id: page.id, name: page.name, background: page.background },
      pages: f.doc.pageOrder.map((id) => ({
        id, name: f.doc.pages[id].name, isCurrent: id === f.currentPageId,
      })),
      selection: f.selection,
      // Paint order: first entry is furthest back, matching the DOM.
      nodes: page.children.map((id) => subtree(f.doc, id, detail)),
    };
  });

  registerTool("get_selection", () => {
    const f = activeFile();
    return {
      count: f.selection.length,
      nodes: f.selection.map((id) => describe(f.doc, id, true)).filter(Boolean),
    };
  });

  registerTool("get_node", (args) => {
    const id = String(args.id ?? "");
    const f = activeFile();
    const node = describe(f.doc, id, true);
    if (!node) throw new Error(`no node with id "${id}"`);
    if (args.includeChildren) return subtree(f.doc, id, "full");
    return node;
  });
}

/** Every node id on the current page, for validating agent-supplied ids. */
export function pageNodeIds(): Set<NodeId> {
  const f = activeFile();
  const out = new Set<NodeId>();
  const walk = (id: NodeId) => {
    const n = f.doc.nodes[id];
    if (!n) return;
    out.add(id);
    n.children.forEach(walk);
  };
  f.doc.pages[f.currentPageId].children.forEach(walk);
  return out;
}

export type { SceneNode };
