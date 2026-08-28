import { create } from "zustand";
import {
  createNode, newId,
  type Doc, type NodeId, type NodeType, type PageId, type SceneNode,
} from "./types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FileId = string;

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
  setNodeRect: (id: NodeId, rect: Partial<Rect>) => void;
  updateNode: (id: NodeId, patch: Partial<SceneNode>) => void;
  removeNodes: (ids: NodeId[]) => void;

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
    },
    currentPageId: pageId,
    selection: [],
    editingId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  };
}

const first = blankFile("Untitled");

export const useDoc = create<DocStore>((set) => {
  /** Apply a change to the active file. Every mutation funnels through here,
   *  which is also where 1.10's command log will wrap. */
  const edit = (fn: (f: FileState) => FileState | void) =>
    set((s) => {
      const cur = s.files[s.activeFileId];
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

    setNodeRect: (id, rect) =>
      edit((f) => {
        const n = f.doc.nodes[id];
        if (!n) return f;
        f.doc = { ...f.doc, nodes: { ...f.doc.nodes, [id]: { ...n, ...rect } } };
        return f;
      }),

    updateNode: (id, patch) =>
      edit((f) => {
        const n = f.doc.nodes[id];
        if (!n) return f;
        f.doc = { ...f.doc, nodes: { ...f.doc.nodes, [id]: { ...n, ...patch } } };
        return f;
      }),

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

    select: (ids) => edit((f) => { f.selection = ids; return f; }),

    toggleSelect: (id) =>
      edit((f) => {
        f.selection = f.selection.includes(id)
          ? f.selection.filter((n) => n !== id)
          : [...f.selection, id];
        return f;
      }),

    clearSelection: () =>
      edit((f) => { f.selection = []; f.editingId = null; return f; }),

    setEditing: (editingId) => edit((f) => { f.editingId = editingId; return f; }),
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
