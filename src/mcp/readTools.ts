import { activeFile, worldRect } from "../document/store";
import { localRect, type Box } from "../document/geometry";
import type { Doc, NodeId, SceneNode, SizeMode } from "../document/types";
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
    // Reported so a caller can tell a flat run from a formatted one; the
    // markup itself is usually long and is fetched with get_jsx.
    if (n.richText) base.hasFormatting = true;
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

/**
 * A node and its descendants, to a depth.
 *
 * Depth is capped because it was not: a full read of a real page returned
 * every node with every style, which is thousands of tokens for a question
 * that is usually about the top of the tree. Anything deeper than the limit
 * keeps its childIds, so a caller that genuinely needs further down can ask
 * again from there rather than paying for the whole thing by default.
 */
function subtree(
  doc: Doc, id: NodeId, detail: "summary" | "full", depth = 3,
): unknown {
  const node = describe(doc, id, detail === "full") as Record<string, unknown> | null;
  if (!node) return null;
  const n = doc.nodes[id];
  if (n.children.length && depth > 0) {
    node.children = n.children.map((c) => subtree(doc, c, detail, depth - 1));
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
    if (args.includeChildren) {
      const depth = args.depth === undefined ? 3 : Math.max(0, Math.min(10, Number(args.depth)));
      return subtree(f.doc, id, "full", depth);
    }
    return node;
  });

  /**
   * Finding a node without reading the document.
   *
   * The alternative is pulling a tree and scanning it, which costs the whole
   * page to answer a question about one node — and gets worse exactly as the
   * design gets big enough for the question to be worth asking. Matching here
   * means the reply carries the matches and nothing else.
   */
  registerTool("find_nodes", (args) => {
    const f = activeFile();
    const doc = f.doc;

    const text = args.text === undefined ? null : String(args.text).toLowerCase();
    const name = args.name === undefined ? null : String(args.name).toLowerCase();
    const type = args.type === undefined ? null : String(args.type);
    const limit = Math.max(1, Math.min(200, Number(args.limit ?? 50)));

    if (text === null && name === null && type === null) {
      throw new Error("give at least one of name, text or type to search for");
    }

    // A search scoped to a subtree only walks that subtree; otherwise the
    // current page, because a match on a page the user is not looking at is
    // rarely the one meant.
    const roots: NodeId[] = args.nodeId
      ? [String(args.nodeId)]
      : doc.pages[f.currentPageId]?.children ?? [];
    for (const id of roots) {
      if (!doc.nodes[id]) throw new Error(`no node with id "${id}"`);
    }

    const hits: Array<Record<string, unknown>> = [];
    let truncated = false;

    const walk = (id: NodeId): void => {
      const n = doc.nodes[id];
      if (!n) return;
      if (hits.length >= limit) { truncated = true; return; }

      const matches =
        (type === null || n.type === type) &&
        (name === null || n.name.toLowerCase().includes(name)) &&
        (text === null ||
          (n.type === "text" && (n.text ?? "").toLowerCase().includes(text)));

      if (matches) {
        const box = worldRect(doc, id);
        const hit: Record<string, unknown> = {
          id: n.id,
          type: n.type,
          name: n.name,
          parent: n.parent,
          box: box
            ? [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]
            : null,
        };
        // The matched words, so a caller searching by text can tell which of
        // several similar nodes it found without a second call for each.
        if (n.type === "text") hit.text = n.text;
        hits.push(hit);
      }
      for (const child of n.children) walk(child);
    };
    for (const root of roots) walk(root);

    // Which top-level board each match came from.
    //
    // A page often holds several versions of the same design — an import
    // beside a hand-built one, a before beside an after — and searching the
    // whole page silently answers about whichever it reached first. That is
    // worse than an error: the reply looks authoritative and is about the
    // wrong object. It fooled me twice in ten minutes while I knew there were
    // two boards, so saying so is the least this can do.
    const boardOf = (id: NodeId): string | null => {
      let cur: NodeId | null = id;
      let last: NodeId | null = null;
      while (cur) {
        last = cur;
        cur = doc.nodes[cur]?.parent ?? null;
      }
      return last;
    };
    const boards = new Map<string, number>();
    for (const hit of hits) {
      const board = boardOf(String(hit.id));
      if (!board) continue;
      boards.set(board, (boards.get(board) ?? 0) + 1);
    }

    return {
      count: hits.length,
      // Said explicitly: a caller that cannot tell a complete result from a
      // capped one will act on the first few and believe it saw everything.
      truncated,
      nodes: hits,
      ...(boards.size > 1
        ? {
            spansBoards: [...boards].map(([id, n]) => ({
              board: doc.nodes[id]?.name ?? id,
              id,
              matches: n,
            })),
            note:
              "Matches came from more than one top-level board. Pass nodeId " +
              "to search inside the one you mean.",
          }
        : {}),
    };
  });

  registerTool("get_layout", (args) => {
    const f = activeFile();
    const page = f.doc.pages[f.currentPageId];
    const rootId = args.nodeId ? String(args.nodeId) : null;
    if (rootId && !f.doc.nodes[rootId]) {
      throw new Error(`no node with id "${rootId}"`);
    }

    // Boxes for the whole subtree cost more than the screenshot they were
    // meant to replace — on a real page that is thousands of tokens to answer
    // a yes/no question. The answer is `ok` and `issues`; the tree is there
    // for when the numbers themselves are the question, and is off by default.
    const depth = args.depth === undefined ? 0 : Math.max(0, Math.min(10, Number(args.depth)));

    const issues: Issue[] = [];
    const roots = rootId ? [rootId] : page.children;
    const tree = roots
      .map((id) => layoutTree(f.doc, id, null, issues, depth))
      .filter((x): x is LayoutNode => !!x);

    return {
      page: page.name,
      // True means everything in the subtree fits inside its box.
      ok: issues.length === 0,
      issues,
      ...(depth > 0 ? { tree } : {}),
    };
  });
}

// --- layout health ------------------------------------------------------
//
// Most screenshots taken during a build are answering a yes/no question:
// did this frame hug its content, is anything spilling out of its box, is a
// caption cut off at a card edge. Those are questions about numbers, and a
// screenshot is an expensive way to ask them — it costs tokens in proportion
// to its pixel count, and the answer still has to be read out of pixels by
// eye. This walks the subtree and reports the same facts as text.

/** The element a node renders as right now, or null when it is off screen. */
function domNode(id: NodeId): HTMLElement | null {
  const layer = document.querySelector(".canvas-content");
  return layer
    ? layer.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
    : null;
}

/** Rect overlap, or null when the two do not meet. */
function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** The nearest ancestor that clips, and the box it confines things to. */
type Clip = { rect: Box; owner: NodeId } | null;

interface LayoutNode {
  id: NodeId;
  name: string;
  type: string;
  /** World box as [x, y, width, height], rounded. */
  box: [number, number, number, number];
  sizeW?: SizeMode;
  sizeH?: SizeMode;
  placement?: "absolute";
  /** Content past the node's own box, [x, y] in px. */
  overflow?: [number, number];
  clipsContent?: true;
  /** This node is cut off by an ancestor that clips. */
  clippedBy?: { id: NodeId; right: number; bottom: number };
  children?: LayoutNode[];
}

type Issue = Pick<LayoutNode, "id" | "name" | "overflow" | "clippedBy">;

function layoutTree(
  doc: Doc, id: NodeId, clip: Clip, issues: Issue[], depth: number,
): LayoutNode | null {
  const n = doc.nodes[id];
  if (!n || !n.visible) return null;
  const rect = worldRect(doc, id);
  if (!rect) return null;

  const node: LayoutNode = {
    id: n.id,
    name: n.name,
    type: n.type,
    box: [
      Math.round(rect.x), Math.round(rect.y),
      Math.round(rect.width), Math.round(rect.height),
    ],
  };
  const sw = n.sizeW ?? "fixed";
  const sh = n.sizeH ?? "fixed";
  if (sw !== "fixed") node.sizeW = sw;
  if (sh !== "fixed") node.sizeH = sh;
  if (n.placement === "absolute") node.placement = "absolute";
  if (n.clipContent) node.clipsContent = true;

  // Content the box is too small to hold — the "switch this to fit-content"
  // case. scrollSize against clientSize is the browser's own answer, and is
  // trusted only on an axis pinned to a number: an axis left to size itself
  // already grew to fit, so it can never report an overflow.
  const el = domNode(id);
  if (el) {
    const ox = sw === "fixed" ? Math.max(0, el.scrollWidth - el.clientWidth) : 0;
    const oy = sh === "fixed" ? Math.max(0, el.scrollHeight - el.clientHeight) : 0;
    // A pixel of slack, to absorb rounding between the model and the layout.
    if (ox > 1 || oy > 1) node.overflow = [Math.round(ox), Math.round(oy)];
  }

  if (clip) {
    const right = Math.round(rect.x + rect.width - (clip.rect.x + clip.rect.width));
    const bottom = Math.round(rect.y + rect.height - (clip.rect.y + clip.rect.height));
    const overLeft = clip.rect.x - rect.x;
    const overTop = clip.rect.y - rect.y;
    if (right > 1 || bottom > 1 || overLeft > 1 || overTop > 1) {
      node.clippedBy = {
        id: clip.owner,
        right: Math.max(0, right),
        bottom: Math.max(0, bottom),
      };
    }
  }

  if (node.overflow || node.clippedBy) {
    issues.push({
      id: n.id, name: n.name,
      overflow: node.overflow, clippedBy: node.clippedBy,
    });
  }

  // A frame that clips narrows the box everything beneath it must stay in.
  const next: Clip = n.clipContent
    ? {
        rect: clip
          ? intersect(clip.rect, rect) ?? { ...rect, width: 0, height: 0 }
          : rect,
        owner: n.id,
      }
    : clip;

  // The walk always continues, because an issue can be anywhere in the
  // subtree; only the reported boxes stop at the requested depth.
  const kids = n.children
    .map((c) => layoutTree(doc, c, next, issues, depth - 1))
    .filter((x): x is LayoutNode => !!x);
  if (kids.length && depth > 0) node.children = kids;
  return node;
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
