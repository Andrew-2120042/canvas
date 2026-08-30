import { activeFile, worldRect } from "../document/store";
import { localRect } from "../document/geometry";
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
  // Geometry comes from one place for everyone — see document/geometry.ts.
  // A node its parent lays out has no stored position to report, so both the
  // local and the absolute rect are read from the layout the browser produced.
  const abs = worldRect(doc, id);
  const live = localRect(doc, id);

  const base: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    name: n.name,
    parent: n.parent,
    childIds: n.children,
    x: Math.round(live?.x ?? n.x),
    y: Math.round(live?.y ?? n.y),
    width: Math.round(live?.width ?? n.width),
    height: Math.round(live?.height ?? n.height),
    absoluteX: Math.round(abs?.x ?? n.x),
    absoluteY: Math.round(abs?.y ?? n.y),
    visible: n.visible,
    locked: n.locked,
  };
  if (n.layout === "flex") {
    base.layout = "flex";
    base.flex = n.flex;
  } else if (n.layout) base.layout = n.layout;
  // How the node sits in its parent. Without these an agent reading a design
  // cannot tell a box sized by its content from one pinned to a number, and
  // neither can anything auditing the document.
  if (n.padding) base.padding = n.padding;
  if (n.minWidth !== undefined) base.minWidth = n.minWidth;
  if (n.minHeight !== undefined) base.minHeight = n.minHeight;
  if (n.placement === "absolute") base.placement = "absolute";
  if ((n.sizeW ?? "fixed") !== "fixed") base.sizeW = n.sizeW;
  if ((n.sizeH ?? "fixed") !== "fixed") base.sizeH = n.sizeH;
  if (n.grow !== undefined) base.grow = n.grow;
  if (n.shrink === false) base.shrink = false;
  if (n.alignSelf) base.alignSelf = n.alignSelf;

  if (!includeStyle) return base;

  base.fill = n.fill;
  base.opacity = n.opacity;
  base.radius = n.radius;
  if (n.radii) base.radii = n.radii;
  if (n.gradient) base.gradient = n.gradient;
  if (n.transform) base.transform = n.transform;
  if (n.rotate) base.rotate = n.rotate;
  if (n.clipContent) base.clipContent = true;
  if (n.type === "text") {
    base.text = n.text;
    base.fontSize = n.fontSize;
    base.fontWeight = n.fontWeight;
    base.lineHeight = n.lineHeight;
    base.letterSpacing = n.letterSpacing;
    base.textAlign = n.textAlign;
    // Reported so a caller can read back what it set — a property that
    // applies but cannot be read is indistinguishable from one that did not.
    if (n.fontFamily) base.fontFamily = n.fontFamily;
    if (n.whiteSpace) base.whiteSpace = n.whiteSpace;
    else if (n.preWrap !== undefined) base.preWrap = n.preWrap;
  }
  if (n.type === "path") {
    base.pointCount = n.points?.length ?? 0;
    base.closed = !!n.closed;
    base.strokeWidth = n.strokeWidth;
    base.strokeColor = n.strokeColor;
  }
  // Any node can carry a picture, so report it on any node — not being able
  // to read back what was set is indistinguishable from it never applying.
  if (n.src && n.type !== "image") {
    base.hasImage = true;
    base.backgroundFit = n.backgroundFit ?? "cover";
  }
  if (n.css) base.css = n.css;

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

/** Counts rather than contents, so a large file is cheap to look at. */
function summarise(doc: Doc, ids: NodeId[]): unknown[] {
  return ids.map((id) => {
    const n = doc.nodes[id];
    if (!n) return null;
    // The summary is a map of the page, so these are page coordinates.
    const live = worldRect(doc, id);
    const entry: Record<string, unknown> = {
      id: n.id,
      name: n.name,
      type: n.type,
      x: Math.round(live?.x ?? n.x),
      y: Math.round(live?.y ?? n.y),
      width: Math.round(live?.width ?? n.width),
      height: Math.round(live?.height ?? n.height),
    };
    if (n.children.length) entry.childCount = n.children.length;
    if (n.type === "text") entry.text = (n.text ?? "").slice(0, 40);
    return entry;
  }).filter(Boolean);
}

export function registerReadTools(): void {
  registerTool("get_tree_summary", () => {
    const f = activeFile();
    const page = f.doc.pages[f.currentPageId];
    return {
      file: f.name,
      page: page.name,
      nodeCount: Object.keys(f.doc.nodes).length,
      pageCount: f.doc.pageOrder.length,
      selection: f.selection,
      // Top level only: enough to decide where to look, without the weight
      // of a full tree on a file of a few hundred nodes.
      topLevel: summarise(f.doc, page.children),
    };
  });

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
