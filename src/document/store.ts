import { create } from "zustand";
import {
  createNode,
  newId,
  type Doc,
  type NodeId,
  type NodeType,
  type PageId,
  type SceneNode,
} from "./types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DocStore {
  doc: Doc;
  currentPageId: PageId;
  selection: NodeId[];

  // --- mutations -----------------------------------------------------------
  // Every write to `doc` goes through one of these. 1.10 wraps this set in a
  // command log; keeping call sites out of the internals is what makes that
  // a wrapper rather than a rewrite.
  addNode: (type: NodeType, rect: Rect, parent?: NodeId | null) => NodeId;
  setNodeRect: (id: NodeId, rect: Partial<Rect>) => void;
  updateNode: (id: NodeId, patch: Partial<SceneNode>) => void;
  removeNodes: (ids: NodeId[]) => void;

  // --- selection -----------------------------------------------------------
  select: (ids: NodeId[]) => void;
  toggleSelect: (id: NodeId) => void;
  clearSelection: () => void;
}

function emptyDoc(): { doc: Doc; pageId: PageId } {
  const pageId = newId("p");
  return {
    pageId,
    doc: {
      nodes: {},
      pages: {
        [pageId]: { id: pageId, name: "Page 1", children: [], background: "#999999" },
      },
      pageOrder: [pageId],
    },
  };
}

const initial = emptyDoc();

export const useDoc = create<DocStore>((set, get) => ({
  doc: initial.doc,
  currentPageId: initial.pageId,
  selection: [],

  addNode: (type, rect, parent = null) => {
    const node = createNode(type, rect, { parent });
    set((s) => {
      const nodes = { ...s.doc.nodes, [node.id]: node };
      const pages = { ...s.doc.pages };

      if (parent) {
        const p = nodes[parent];
        nodes[parent] = { ...p, children: [...p.children, node.id] };
      } else {
        const page = pages[s.currentPageId];
        pages[s.currentPageId] = { ...page, children: [...page.children, node.id] };
      }
      return { doc: { ...s.doc, nodes, pages } };
    });
    return node.id;
  },

  setNodeRect: (id, rect) =>
    set((s) => {
      const n = s.doc.nodes[id];
      if (!n) return s;
      return {
        doc: { ...s.doc, nodes: { ...s.doc.nodes, [id]: { ...n, ...rect } } },
      };
    }),

  updateNode: (id, patch) =>
    set((s) => {
      const n = s.doc.nodes[id];
      if (!n) return s;
      return {
        doc: { ...s.doc, nodes: { ...s.doc.nodes, [id]: { ...n, ...patch } } },
      };
    }),

  removeNodes: (ids) =>
    set((s) => {
      const nodes = { ...s.doc.nodes };
      const pages = { ...s.doc.pages };

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
          nodes[n.parent] = {
            ...p,
            children: p.children.filter((c) => c !== id),
          };
        }
        delete nodes[id];
      }
      for (const pid of Object.keys(pages)) {
        pages[pid] = {
          ...pages[pid],
          children: pages[pid].children.filter((c) => !doomed.has(c)),
        };
      }

      return {
        doc: { ...s.doc, nodes, pages },
        selection: get().selection.filter((id) => !doomed.has(id)),
      };
    }),

  select: (ids) => set({ selection: ids }),

  toggleSelect: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((n) => n !== id)
        : [...s.selection, id],
    })),

  clearSelection: () => set({ selection: [] }),
}));

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
