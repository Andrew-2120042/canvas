import { useEffect } from "react";
import { activeFile, useDoc } from "../document/store";
import type { SceneNode } from "../document/types";

const NUDGE = 1;
const NUDGE_LARGE = 10;

/** In-app clipboard. Not the system clipboard — that needs a serialisation
 *  format agreed with the outside world, which is Phase 9's export work. */
let clipboard: SceneNode[] = [];

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

/** Collect a subtree so a copied frame carries its children. */
function collectSubtree(nodes: Record<string, SceneNode>, id: string, out: SceneNode[]) {
  const n = nodes[id];
  if (!n) return;
  out.push(structuredClone(n));
  n.children.forEach((c) => collectSubtree(nodes, c, out));
}

/** Fresh ids across a copied set, keeping internal parent/child links intact. */
function reid(set: SceneNode[]): SceneNode[] {
  const map = new Map<string, string>();
  set.forEach((n, i) => map.set(n.id, `p${Date.now().toString(36)}${i}`));
  return set.map((n) => ({
    ...n,
    id: map.get(n.id)!,
    parent: n.parent && map.has(n.parent) ? map.get(n.parent)! : null,
    children: n.children.map((c) => map.get(c)).filter((c): c is string => !!c),
  }));
}

/** Editing shortcuts: undo/redo, clipboard, delete, nudge, ordering. */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const f = activeFile();
      if (isTyping(e.target) || f.editingId) return;

      const st = useDoc.getState();
      const mod = e.metaKey || e.ctrlKey;
      const sel = f.selection;

      // --- history --------------------------------------------------------
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }

      // --- clipboard ------------------------------------------------------
      if (mod && e.key.toLowerCase() === "c" && sel.length) {
        e.preventDefault();
        const out: SceneNode[] = [];
        sel.forEach((id) => collectSubtree(f.doc.nodes, id, out));
        // Roots of the copied set detach so they paste at page level.
        clipboard = out.map((n) =>
          sel.includes(n.id) ? { ...n, parent: null } : n);
        return;
      }

      if (mod && e.key.toLowerCase() === "x" && sel.length) {
        e.preventDefault();
        const out: SceneNode[] = [];
        sel.forEach((id) => collectSubtree(f.doc.nodes, id, out));
        clipboard = out.map((n) => (sel.includes(n.id) ? { ...n, parent: null } : n));
        st.removeNodes(sel);
        return;
      }

      if (mod && e.key.toLowerCase() === "v" && clipboard.length) {
        e.preventDefault();
        const copies = reid(clipboard).map((n) =>
          n.parent === null ? { ...n, x: n.x + 12, y: n.y + 12 } : n);
        st.insertNodes(copies, null);
        return;
      }

      if (mod && e.key.toLowerCase() === "d" && sel.length) {
        e.preventDefault();
        st.duplicateNodes(sel);
        return;
      }

      // --- delete ---------------------------------------------------------
      if ((e.key === "Backspace" || e.key === "Delete") && sel.length) {
        e.preventDefault();
        st.removeNodes(sel);
        return;
      }

      // --- z-order --------------------------------------------------------
      if (mod && e.key === "]") {
        e.preventDefault();
        st.reorder(sel, e.shiftKey ? "front" : "forward");
        return;
      }
      if (mod && e.key === "[") {
        e.preventDefault();
        st.reorder(sel, e.shiftKey ? "back" : "backward");
        return;
      }

      // --- nudge ----------------------------------------------------------
      // Arrows pan the viewport when nothing is selected; that stays in the
      // viewport hook, which checks for an empty selection.
      if (sel.length && e.key.startsWith("Arrow")) {
        const step = e.shiftKey ? NUDGE_LARGE : NUDGE;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (dx === 0 && dy === 0) return;
        e.preventDefault();
        const key = `nudge:${sel.join(",")}`;
        sel.forEach((id) => {
          const n = activeFile().doc.nodes[id];
          if (n) st.setNodeRect(id, { x: n.x + dx, y: n.y + dy }, key);
        });
        return;
      }

      // --- select all -----------------------------------------------------
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const page = f.doc.pages[f.currentPageId];
        st.select(page.children);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
