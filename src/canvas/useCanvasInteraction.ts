import { useEffect, useState, type RefObject } from "react";
import {
  collectWorldRects, frameAt, parentOrigin, rectsIntersect, useDoc, type Rect,
} from "../document/store";
import { useTool } from "../state/tools";
import { useViewport } from "../state/viewport";
import type { HandleKey } from "./SelectionOverlay";

const MIN_SIZE = 1;
/** Below this drag distance a frame-tool press counts as a click. */
const CLICK_SLOP = 3;
const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  frame: { width: 400, height: 300 },
  rect: { width: 120, height: 120 },
  text: { width: 160, height: 24 },
};

function normalise(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}

/** Apply a world-space delta to one edge/corner of a rect. */
function resizeRect(start: Rect, handle: HandleKey, dx: number, dy: number): Rect {
  let { x, y, width, height } = start;

  if (handle.includes("w")) { x += dx; width -= dx; }
  if (handle.includes("e")) { width += dx; }
  if (handle.includes("n")) { y += dy; height -= dy; }
  if (handle.includes("s")) { height += dy; }

  // Collapsing past zero pins the edge rather than inverting the rect;
  // proper flipping lands with the transform work later.
  if (width < MIN_SIZE) {
    if (handle.includes("w")) x = start.x + start.width - MIN_SIZE;
    width = MIN_SIZE;
  }
  if (height < MIN_SIZE) {
    if (handle.includes("n")) y = start.y + start.height - MIN_SIZE;
    height = MIN_SIZE;
  }
  return { x, y, width, height };
}

/**
 * Creating, selecting, moving and resizing nodes on the canvas.
 *
 * Panning is owned by useViewportControls; this hook ignores middle-click and
 * space-held presses so the two never fight over the same gesture.
 */
export function useCanvasInteraction(
  ref: RefObject<HTMLElement | null>,
  spaceHeld: boolean,
) {
  const [draft, setDraft] = useState<Rect | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const toWorld = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const v = useViewport.getState();
      return {
        x: (e.clientX - r.left - v.x) / v.zoom,
        y: (e.clientY - r.top - v.y) / v.zoom,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || spaceHeld) return;
      // This native listener runs before React's synthetic handlers, so the
      // editor cannot stop it from starting a drag — bail out here instead.
      if ((e.target as HTMLElement).closest(".text-editor")) return;

      const tool = useTool.getState().tool;
      if (tool === "pan") return; // the viewport hook owns this gesture
      const doc = useDoc.getState();
      const start = toWorld(e);
      const target = e.target as HTMLElement;

      // --- resize ----------------------------------------------------------
      const handleEl = target.closest("[data-handle]") as HTMLElement | null;
      if (handleEl && doc.selection.length === 1) {
        const id = doc.selection[0];
        const n = doc.doc.nodes[id];
        if (n) {
          const handle = handleEl.dataset.handle as HandleKey;
          const origin: Rect = { x: n.x, y: n.y, width: n.width, height: n.height };
          e.preventDefault();
          e.stopPropagation();
          drag(e, (w) => {
            useDoc
              .getState()
              .setNodeRect(id, resizeRect(origin, handle, w.x - start.x, w.y - start.y));
          });
          return;
        }
      }

      // --- create ----------------------------------------------------------
      if (tool === "frame" || tool === "rect" || tool === "text") {
        e.preventDefault();
        setDraft({ x: start.x, y: start.y, width: 0, height: 0 });
        drag(
          e,
          (w) => setDraft(normalise(start.x, start.y, w.x, w.y)),
          (w) => {
            setDraft(null);
            let rect = normalise(start.x, start.y, w.x, w.y);
            if (rect.width < CLICK_SLOP && rect.height < CLICK_SLOP) {
              // A plain click drops a default-sized node at the cursor.
              rect = { x: start.x, y: start.y, ...DEFAULT_SIZE[tool] };
            }

            // Drop into whichever frame the press landed in. A frame dragged
            // out over another frame still nests — matching how the DOM would
            // read the result.
            const st = useDoc.getState();
            const page = st.doc.pages[st.currentPageId];
            const parent = frameAt(st.doc, page.children, start.x, start.y);
            if (parent) {
              const o = parentOrigin(st.doc, parent);
              rect = { ...rect, x: rect.x - o.x, y: rect.y - o.y };
            }

            const id = st.addNode(tool, rect, parent);
            useDoc.getState().select([id]);
            useTool.getState().setTool("move");
            if (tool === "text") useDoc.getState().setEditing(id);
          },
        );
        return;
      }

      // --- select and move -------------------------------------------------
      if (tool === "move") {
        const nodeEl = target.closest("[data-node-id]") as HTMLElement | null;
        if (!nodeEl) {
          // Empty canvas: rubber-band select. Additive with shift held, so an
          // existing selection can be extended rather than replaced.
          const base = e.shiftKey ? doc.selection : [];
          if (!e.shiftKey) doc.clearSelection();
          e.preventDefault();
          setMarquee({ x: start.x, y: start.y, width: 0, height: 0 });
          drag(
            e,
            (w) => {
              const box = normalise(start.x, start.y, w.x, w.y);
              setMarquee(box);
              const st = useDoc.getState();
              const page = st.doc.pages[st.currentPageId];
              const hits = collectWorldRects(st.doc, page.children)
                .filter((n) => n.visible && !n.locked && rectsIntersect(box, n))
                .map((n) => n.id);
              st.select([...new Set([...base, ...hits])]);
            },
            () => setMarquee(null),
          );
          return;
        }
        const id = nodeEl.dataset.nodeId!;
        const node = doc.doc.nodes[id];
        if (!node || node.locked) return;

        if (e.shiftKey) {
          doc.toggleSelect(id);
        } else if (!doc.selection.includes(id)) {
          doc.select([id]);
        }

        // Capture origins up front so each move is applied to the start
        // position, never accumulated from the previous frame.
        const ids = useDoc.getState().selection;
        const origins = new Map(
          ids.map((nid) => {
            const n = useDoc.getState().doc.nodes[nid];
            return [nid, { x: n.x, y: n.y }] as const;
          }),
        );

        e.preventDefault();
        drag(e, (w) => {
          const dx = w.x - start.x;
          const dy = w.y - start.y;
          const st = useDoc.getState();
          origins.forEach((o, nid) => st.setNodeRect(nid, { x: o.x + dx, y: o.y + dy }));
        });
      }
    };

    /** Shared pointer-capture drag loop. */
    function drag(
      e: PointerEvent,
      onMove: (world: { x: number; y: number }) => void,
      onEnd?: (world: { x: number; y: number }) => void,
    ) {
      const elm = ref.current!;
      elm.setPointerCapture(e.pointerId);
      let last = toWorld(e);

      const move = (m: PointerEvent) => {
        last = toWorld(m);
        onMove(last);
      };
      const up = () => {
        elm.releasePointerCapture(e.pointerId);
        elm.removeEventListener("pointermove", move);
        elm.removeEventListener("pointerup", up);
        elm.removeEventListener("pointercancel", up);
        onEnd?.(last);
      };
      elm.addEventListener("pointermove", move);
      elm.addEventListener("pointerup", up);
      elm.addEventListener("pointercancel", up);
    }

    /** Double-click a text node to edit it in place. */
    const onDoubleClick = (e: MouseEvent) => {
      const nodeEl = (e.target as HTMLElement).closest(
        "[data-node-id]",
      ) as HTMLElement | null;
      if (!nodeEl) return;
      const id = nodeEl.dataset.nodeId!;
      const n = useDoc.getState().doc.nodes[id];
      if (n?.type !== "text" || n.locked) return;
      e.preventDefault();
      useDoc.getState().select([id]);
      useDoc.getState().setEditing(id);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("dblclick", onDoubleClick);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("dblclick", onDoubleClick);
    };
  }, [ref, spaceHeld]);

  return { draft, marquee };
}
