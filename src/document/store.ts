import { create } from "zustand";
import {
  createNode, newId,
  type Comment, type Doc, type NodeId, type NodeType, type PageId, type SceneNode,
} from "./types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FileId = string;

export type AlignEdge =
  | "left" | "hcenter" | "right"
  | "top" | "vcenter" | "bottom";

/** One open file. Everything a tab owns lives here, so switching tabs cannot
 *  leak document or view state between files. */
export interface FileState {
  id: FileId;
  name: string;
  doc: Doc;
  currentPageId: PageId;
  selection: NodeId[];
  editingId: NodeId | null;
  /** Saved on tab switch and restored on return. */
  viewport: { x: number; y: number; zoom: number };
  updatedAt: number;
}

/** One undo step: the file's state before an edit. Snapshots rather than
 *  inverse commands — documents are small plain JSON, and a snapshot cannot
 *  drift out of sync with the operation it is meant to invert. */
interface HistoryEntry {
  doc: Doc;
  currentPageId: PageId;
  selection: NodeId[];
}

interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Key of the last edit, for coalescing a drag into one step. */
  lastKey: string | null;
  lastAt: number;
}

const HISTORY_LIMIT = 200;
/** Consecutive same-key edits inside this window collapse into one step. */
const COALESCE_MS = 800;

interface DocStore {
  files: Record<FileId, FileState>;
  fileOrder: FileId[];
  /** Always a real file, even while the dashboard is showing. */
  activeFileId: FileId;
  showDashboard: boolean;

  // files / tabs
  newFile: (name?: string) => FileId;
  openFile: (id: FileId) => void;
  closeFile: (id: FileId) => void;
  renameFile: (id: FileId, name: string) => void;
  setShowDashboard: (v: boolean) => void;

  // pages
  addPage: () => PageId;
  setCurrentPage: (id: PageId) => void;
  renamePage: (id: PageId, name: string) => void;
  setPageBackground: (pageId: PageId, background: string) => void;

  // nodes
  addNode: (type: NodeType, rect: Rect, parent?: NodeId | null) => NodeId;
  setNodeRect: (id: NodeId, rect: Partial<Rect>, key?: string) => void;
  updateNode: (id: NodeId, patch: Partial<SceneNode>, key?: string) => void;
  removeNodes: (ids: NodeId[]) => void;

  // comments
  addComment: (pageId: PageId, x: number, y: number, body: string) => void;
  updateComment: (id: string, patch: Partial<Comment>) => void;
  removeComment: (id: string) => void;

  // structure
  duplicateNodes: (ids: NodeId[], offset?: number) => NodeId[];
  reorder: (ids: NodeId[], where: "front" | "back" | "forward" | "backward") => void;
  align: (ids: NodeId[], edge: AlignEdge) => void;
  distribute: (ids: NodeId[], axis: "h" | "v") => void;
  insertNodes: (nodes: SceneNode[], parent: NodeId | null) => NodeId[];

  // history
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // selection
  select: (ids: NodeId[]) => void;
  toggleSelect: (id: NodeId) => void;
  clearSelection: () => void;
  setEditing: (id: NodeId | null) => void;
}

function blankFile(name: string): FileState {
  const pageId = newId("pg");
  return {
    id: newId("f"),
    name,
    doc: {
      nodes: {},
      pages: { [pageId]: { id: pageId, name: "Page 1", children: [], background: "#999999" } },
      pageOrder: [pageId],
      comments: [],
    },
    currentPageId: pageId,
    selection: [],
    editingId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  };
}

const first = blankFile("Untitled");

/** Undo stacks live outside the store: they are not document state, must not
 *  be persisted, and should not make every consumer re-render. */
const histories = new Map<FileId, History>();

function historyFor(id: FileId): History {
  let h = histories.get(id);
  if (!h) {
    h = { past: [], future: [], lastKey: null, lastAt: 0 };
    histories.set(id, h);
  }
  return h;
}

const snap = (f: FileState): HistoryEntry => ({
  doc: f.doc,
  currentPageId: f.currentPageId,
  selection: f.selection,
});

export const useDoc = create<DocStore>((set, get) => {
  /**
   * Apply a change to the active file. Every mutation funnels through here,
   * which is what lets undo wrap a single seam instead of every call site.
   *
   * `key` coalesces a continuous gesture — a drag fires one edit per pointer
   * move, and each of those must not become its own undo step.
   */
  const edit = (
    fn: (f: FileState) => FileState | void,
    opts: { key?: string; history?: boolean } = {},
  ) =>
    set((s) => {
      const cur = s.files[s.activeFileId];

      if (opts.history !== false) {
        const h = historyFor(s.activeFileId);
        const now = Date.now();
        const coalesce =
          opts.key != null && h.lastKey === opts.key && now - h.lastAt < COALESCE_MS;
        if (!coalesce) {
          h.past.push(snap(cur));
          if (h.past.length > HISTORY_LIMIT) h.past.shift();
          h.future.length = 0;
        }
        h.lastKey = opts.key ?? null;
        h.lastAt = now;
      }

      const next = fn({ ...cur }) ?? cur;
      return {
        files: { ...s.files, [s.activeFileId]: { ...next, updatedAt: Date.now() } },
      };
    });

  return {
    files: { [first.id]: first },
    fileOrder: [first.id],
    activeFileId: first.id,
    showDashboard: false,

    newFile: (name = "Untitled") => {
      const f = blankFile(name);
      set((s) => ({
        files: { ...s.files, [f.id]: f },
        fileOrder: [...s.fileOrder, f.id],
        activeFileId: f.id,
        showDashboard: false,
      }));
      return f.id;
    },

    openFile: (id) =>
      set((s) => (s.files[id] ? { activeFileId: id, showDashboard: false } : s)),

    closeFile: (id) =>
      set((s) => {
        if (s.fileOrder.length <= 1) return s;
        const order = s.fileOrder.filter((f) => f !== id);
        const files = { ...s.files };
        delete files[id];
        return {
          files,
          fileOrder: order,
          activeFileId: s.activeFileId === id ? order[order.length - 1] : s.activeFileId,
        };
      }),

    renameFile: (id, name) =>
      set((s) => ({ files: { ...s.files, [id]: { ...s.files[id], name } } })),

    setShowDashboard: (showDashboard) => set({ showDashboard }),

    addPage: () => {
      const pageId = newId("pg");
      edit((f) => {
        const n = f.doc.pageOrder.length + 1;
        f.doc = {
          ...f.doc,
          pages: {
            ...f.doc.pages,
            [pageId]: { id: pageId, name: `Page ${n}`, children: [], background: "#999999" },
          },
          pageOrder: [...f.doc.pageOrder, pageId],
        };
        f.currentPageId = pageId;
        f.selection = [];
        return f;
      });
      return pageId;
    },

    setCurrentPage: (id) =>
      edit((f) => {
        f.currentPageId = id;
        f.selection = [];
        f.editingId = null;
        return f;
      }),

    renamePage: (id, name) =>
      edit((f) => {
        f.doc = {
          ...f.doc,
          pages: { ...f.doc.pages, [id]: { ...f.doc.pages[id], name } },
        };
        return f;
      }),

    setPageBackground: (pageId, background) =>
      edit((f) => {
        f.doc = {
          ...f.doc,
          pages: { ...f.doc.pages, [pageId]: { ...f.doc.pages[pageId], background } },
        };
        return f;
      }),

    addNode: (type, rect, parent = null) => {
      const node = createNode(type, rect, { parent });
      edit((f) => {
        const nodes = { ...f.doc.nodes, [node.id]: node };
        const pages = { ...f.doc.pages };
        if (parent) {
          const p = nodes[parent];
          nodes[parent] = { ...p, children: [...p.children, node.id] };
        } else {
          const page = pages[f.currentPageId];
          pages[f.currentPageId] = { ...page, children: [...page.children, node.id] };
        }
        f.doc = { ...f.doc, nodes, pages };
        return f;
      });
      return node.id;
    },

    setNodeRect: (id, rect, key) =>
      edit((f) => {
        const n = f.doc.nodes[id];
        if (!n) return f;
        f.doc = { ...f.doc, nodes: { ...f.doc.nodes, [id]: { ...n, ...rect } } };
        return f;
      }, { key }),

    updateNode: (id, patch, key) =>
      edit((f) => {
        const n = f.doc.nodes[id];
        if (!n) return f;
        f.doc = { ...f.doc, nodes: { ...f.doc.nodes, [id]: { ...n, ...patch } } };
        return f;
      }, { key }),

    removeNodes: (ids) =>
      edit((f) => {
        const nodes = { ...f.doc.nodes };
        const pages = { ...f.doc.pages };

        // Collect descendants so a removed subtree leaves nothing orphaned.
        const doomed = new Set<NodeId>();
        const walk = (id: NodeId) => {
          if (doomed.has(id)) return;
          doomed.add(id);
          nodes[id]?.children.forEach(walk);
        };
        ids.forEach(walk);

        for (const id of doomed) {
          const n = nodes[id];
          if (!n) continue;
          if (n.parent && nodes[n.parent] && !doomed.has(n.parent)) {
            const p = nodes[n.parent];
            nodes[n.parent] = { ...p, children: p.children.filter((c) => c !== id) };
          }
          delete nodes[id];
        }
        for (const pid of Object.keys(pages)) {
          pages[pid] = {
            ...pages[pid],
            children: pages[pid].children.filter((c) => !doomed.has(c)),
          };
        }

        f.doc = { ...f.doc, nodes, pages };
        f.selection = f.selection.filter((id) => !doomed.has(id));
        return f;
      }),

    // Selection and edit-mode are view state, not document history.
    select: (ids) => edit((f) => { f.selection = ids; return f; }, { history: false }),

    toggleSelect: (id) =>
      edit((f) => {
        f.selection = f.selection.includes(id)
          ? f.selection.filter((n) => n !== id)
          : [...f.selection, id];
        return f;
      }, { history: false }),

    clearSelection: () =>
      edit((f) => { f.selection = []; f.editingId = null; return f; }, { history: false }),

    setEditing: (editingId) =>
      edit((f) => { f.editingId = editingId; return f; }, { history: false }),

    // --- comments ---------------------------------------------------------

    addComment: (pageId, x, y, body) =>
      edit((f) => {
        const c: Comment = {
          id: newId("c"), pageId, x, y, body,
          createdAt: Date.now(), resolved: false,
        };
        f.doc = { ...f.doc, comments: [...(f.doc.comments ?? []), c] };
        return f;
      }),

    updateComment: (id, patch) =>
      edit((f) => {
        f.doc = {
          ...f.doc,
          comments: (f.doc.comments ?? []).map((c) =>
            c.id === id ? { ...c, ...patch } : c),
        };
        return f;
      }),

    removeComment: (id) =>
      edit((f) => {
        f.doc = {
          ...f.doc,
          comments: (f.doc.comments ?? []).filter((c) => c.id !== id),
        };
        return f;
      }),

    // --- structure --------------------------------------------------------

    insertNodes: (incoming, parent) => {
      const ids: NodeId[] = [];
      edit((f) => {
        const nodes = { ...f.doc.nodes };
        const pages = { ...f.doc.pages };
        for (const n of incoming) nodes[n.id] = n;
        const roots = incoming.filter((n) => !n.parent).map((n) => n.id);
        ids.push(...roots);
        if (parent && nodes[parent]) {
          const p = nodes[parent];
          nodes[parent] = { ...p, children: [...p.children, ...roots] };
          roots.forEach((r) => { nodes[r] = { ...nodes[r], parent }; });
        } else {
          const page = pages[f.currentPageId];
          pages[f.currentPageId] = { ...page, children: [...page.children, ...roots] };
        }
        f.doc = { ...f.doc, nodes, pages };
        f.selection = roots;
        return f;
      });
      return ids;
    },

    duplicateNodes: (ids, offset = 10) => {
      const made: NodeId[] = [];
      edit((f) => {
        const nodes = { ...f.doc.nodes };
        const pages = { ...f.doc.pages };

        /** Deep-copy a subtree with fresh ids so the copy shares nothing. */
        const cloneTree = (id: NodeId, parent: NodeId | null): NodeId | null => {
          const src = nodes[id];
          if (!src) return null;
          const copyId = newId(src.type[0]);
          const kids = src.children
            .map((c) => cloneTree(c, copyId))
            .filter((c): c is NodeId => !!c);
          nodes[copyId] = { ...structuredClone(src), id: copyId, parent, children: kids };
          return copyId;
        };

        for (const id of ids) {
          const src = nodes[id];
          if (!src) continue;
          const cid = cloneTree(id, src.parent);
          if (!cid) continue;
          nodes[cid] = { ...nodes[cid], x: src.x + offset, y: src.y + offset };
          made.push(cid);
          if (src.parent && nodes[src.parent]) {
            const p = nodes[src.parent];
            nodes[src.parent] = { ...p, children: [...p.children, cid] };
          } else {
            const page = pages[f.currentPageId];
            pages[f.currentPageId] = { ...page, children: [...page.children, cid] };
          }
        }

        f.doc = { ...f.doc, nodes, pages };
        f.selection = made;
        return f;
      });
      return made;
    },

    reorder: (ids, where) =>
      edit((f) => {
        const nodes = { ...f.doc.nodes };
        const pages = { ...f.doc.pages };
        const picked = new Set(ids);

        /** Paint order is the child array; the last entry paints on top. */
        const move = (list: NodeId[]): NodeId[] => {
          const mine = list.filter((i) => picked.has(i));
          if (mine.length === 0) return list;
          const rest = list.filter((i) => !picked.has(i));
          if (where === "front") return [...rest, ...mine];
          if (where === "back") return [...mine, ...rest];
          const out = [...list];
          const step = where === "forward" ? 1 : -1;
          const order = where === "forward" ? [...mine].reverse() : mine;
          for (const id of order) {
            const i = out.indexOf(id);
            const j = i + step;
            if (j < 0 || j >= out.length || picked.has(out[j])) continue;
            [out[i], out[j]] = [out[j], out[i]];
          }
          return out;
        };

        for (const pid of Object.keys(pages)) {
          pages[pid] = { ...pages[pid], children: move(pages[pid].children) };
        }
        for (const nid of Object.keys(nodes)) {
          const n = nodes[nid];
          if (n.children.length) nodes[nid] = { ...n, children: move(n.children) };
        }
        f.doc = { ...f.doc, nodes, pages };
        return f;
      }),

    align: (ids, edge) =>
      edit((f) => {
        if (ids.length < 2) return f;
        const rects = ids
          .map((id) => ({ id, r: worldRect(f.doc, id) }))
          .filter((e): e is { id: NodeId; r: Rect } => !!e.r);
        if (rects.length < 2) return f;
        const minX = Math.min(...rects.map((e) => e.r.x));
        const maxX = Math.max(...rects.map((e) => e.r.x + e.r.width));
        const minY = Math.min(...rects.map((e) => e.r.y));
        const maxY = Math.max(...rects.map((e) => e.r.y + e.r.height));

        const nodes = { ...f.doc.nodes };
        for (const { id, r } of rects) {
          const n = nodes[id];
          let dx = 0;
          let dy = 0;
          if (edge === "left") dx = minX - r.x;
          if (edge === "right") dx = maxX - (r.x + r.width);
          if (edge === "hcenter") dx = (minX + maxX) / 2 - (r.x + r.width / 2);
          if (edge === "top") dy = minY - r.y;
          if (edge === "bottom") dy = maxY - (r.y + r.height);
          if (edge === "vcenter") dy = (minY + maxY) / 2 - (r.y + r.height / 2);
          nodes[id] = { ...n, x: n.x + dx, y: n.y + dy };
        }
        f.doc = { ...f.doc, nodes };
        return f;
      }),

    distribute: (ids, axis) =>
      edit((f) => {
        if (ids.length < 3) return f;
        const rects = ids
          .map((id) => ({ id, r: worldRect(f.doc, id) }))
          .filter((e): e is { id: NodeId; r: Rect } => !!e.r)
          .sort((a, b) => (axis === "h" ? a.r.x - b.r.x : a.r.y - b.r.y));
        if (rects.length < 3) return f;

        // Even gaps, holding the outermost two in place.
        const last = rects[rects.length - 1];
        const total = axis === "h"
          ? last.r.x + last.r.width - rects[0].r.x
          : last.r.y + last.r.height - rects[0].r.y;
        const used = rects.reduce(
          (sum, e) => sum + (axis === "h" ? e.r.width : e.r.height), 0);
        const gap = (total - used) / (rects.length - 1);

        const nodes = { ...f.doc.nodes };
        let cursor = axis === "h" ? rects[0].r.x : rects[0].r.y;
        for (const { id, r } of rects) {
          const n = nodes[id];
          if (axis === "h") {
            nodes[id] = { ...n, x: n.x + (cursor - r.x) };
            cursor += r.width + gap;
          } else {
            nodes[id] = { ...n, y: n.y + (cursor - r.y) };
            cursor += r.height + gap;
          }
        }
        f.doc = { ...f.doc, nodes };
        return f;
      }),

    undo: () =>
      set((s) => {
        const h = historyFor(s.activeFileId);
        const prev = h.past.pop();
        if (!prev) return s;
        const cur = s.files[s.activeFileId];
        h.future.push(snap(cur));
        h.lastKey = null;
        return {
          files: {
            ...s.files,
            [s.activeFileId]: { ...cur, ...prev, editingId: null, updatedAt: Date.now() },
          },
        };
      }),

    redo: () =>
      set((s) => {
        const h = historyFor(s.activeFileId);
        const next = h.future.pop();
        if (!next) return s;
        const cur = s.files[s.activeFileId];
        h.past.push(snap(cur));
        h.lastKey = null;
        return {
          files: {
            ...s.files,
            [s.activeFileId]: { ...cur, ...next, editingId: null, updatedAt: Date.now() },
          },
        };
      }),

    canUndo: () => historyFor(get().activeFileId).past.length > 0,
    canRedo: () => historyFor(get().activeFileId).future.length > 0,
  };
});

/** Read a slice of the active file. */
export function useActive<T>(sel: (f: FileState) => T): T {
  return useDoc((s) => sel(s.files[s.activeFileId]));
}

/** Non-reactive access to the active file. */
export function activeFile(): FileState {
  const s = useDoc.getState();
  return s.files[s.activeFileId];
}

/** Absolute world position of a node, walking up through its ancestors. */
export function worldRect(doc: Doc, id: NodeId): Rect | null {
  const n = doc.nodes[id];
  if (!n) return null;
  let x = n.x;
  let y = n.y;
  let p = n.parent;
  while (p) {
    const parent = doc.nodes[p];
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    p = parent.parent;
  }
  return { x, y, width: n.width, height: n.height };
}

/**
 * Deepest frame containing a world point, or null for the bare page.
 * Only frames can take children — a rectangle containing a node has no
 * meaning in the DOM model. Reverse paint order so the topmost frame wins.
 */
export function frameAt(
  doc: Doc, ids: NodeId[], px: number, py: number, ox = 0, oy = 0,
  exclude: ReadonlySet<NodeId> = new Set(),
): NodeId | null {
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    if (exclude.has(id)) continue;
    const n = doc.nodes[id];
    if (!n || !n.visible || n.type !== "frame") continue;
    const ax = ox + n.x;
    const ay = oy + n.y;
    if (px < ax || py < ay || px > ax + n.width || py > ay + n.height) continue;
    return frameAt(doc, n.children, px, py, ax, ay, exclude) ?? id;
  }
  return null;
}

/** Absolute world origin of a node, including its own offset. */
export function parentOrigin(doc: Doc, id: NodeId | null): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cur = id;
  while (cur) {
    const n = doc.nodes[cur];
    if (!n) break;
    x += n.x;
    y += n.y;
    cur = n.parent;
  }
  return { x, y };
}

export interface PlacedNode extends Rect {
  id: NodeId;
  locked: boolean;
  visible: boolean;
}

/** Every node on a page with its absolute world rect, front-most last. */
export function collectWorldRects(
  doc: Doc, ids: NodeId[], ox = 0, oy = 0, out: PlacedNode[] = [],
): PlacedNode[] {
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n) continue;
    const x = ox + n.x;
    const y = oy + n.y;
    out.push({ id, x, y, width: n.width, height: n.height, locked: n.locked, visible: n.visible });
    if (n.children.length) collectWorldRects(doc, n.children, x, y, out);
  }
  return out;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y
  );
}
