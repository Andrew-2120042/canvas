import { useEffect, useState, type RefObject } from "react";
import {
  activeFile, collectWorldRects, frameAt, parentOrigin, rectsIntersect, useDoc,
  type Rect,
} from "../document/store";
import { isLaidOut, localRect } from "../document/geometry";
import { useTool } from "../state/tools";
import { placeImageAt } from "./imageImport";
import { useViewport } from "../state/viewport";
import type { HandleKey } from "./SelectionOverlay";

const MIN_SIZE = 1;
/** Two presses on the same node inside this window count as a double-click. */
const DOUBLE_MS = 350;
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
/** Last press, for detecting a double-click without the native event. */
let lastPress: { id: string | null; at: number } = { id: null, at: 0 };

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
      // This native listener runs before React's synthetic handlers, so an
      // overlay cannot stop it from starting a drag or clearing the selection
      // — bail out here instead. Without this, pressing a path anchor reads as
      // an empty-canvas click and unmounts the very overlay being dragged.
      if ((e.target as HTMLElement).closest(
        ".text-editor, .path-edit-overlay, .comment-layer",
      )) return;

      const tool = useTool.getState().tool;
      if (tool === "pan") return; // the viewport hook owns this gesture
      if (tool === "comment") return; // the comment layer owns this gesture
      if (tool === "pen") return; // the pen tool owns this gesture
      const store = useDoc.getState();
      const af = activeFile();
      const start = toWorld(e);
      const target = e.target as HTMLElement;

      // --- resize ----------------------------------------------------------
      const handleEl = target.closest("[data-handle]") as HTMLElement | null;
      if (handleEl && af.selection.length === 1) {
        const id = af.selection[0];
        const n = af.doc.nodes[id];
        if (n) {
          const handle = handleEl.dataset.handle as HandleKey;
          e.preventDefault();
          e.stopPropagation();
          const gesture = `resize:${id}`;

          // Dragging a handle is a request for this exact size, so the node
          // stops sizing itself to its content. Without this the drag writes
          // a width the renderer then ignores, and the handle springs back.
          //
          // A node its parent lays out keeps its place in the flow: resizing
          // a card inside a stack should make the card bigger, not tear it
          // out of the stack. Only the size is written, and the parent
          // re-flows around it — so the handles that pull from the top or
          // left resize against the opposite edge instead of moving it.
          const inFlow = isLaidOut(af.doc, id);
          const box = localRect(af.doc, id);
          const origin: Rect = {
            x: box?.x ?? n.x,
            y: box?.y ?? n.y,
            width: box?.width ?? n.width,
            height: box?.height ?? n.height,
          };
          // As with a move: pressing a handle writes nothing. Only a handle
          // that is actually dragged pins the node to a fixed size.
          let sizing = false;
          drag(e, (w) => {
            const dx = w.x - start.x;
            const dy = w.y - start.y;
            if (!sizing) {
              if (Math.abs(dx) < CLICK_SLOP && Math.abs(dy) < CLICK_SLOP) return;
              sizing = true;
              if (n.sizeW !== "fixed" || n.sizeH !== "fixed") {
                useDoc.getState().updateNode(
                  id,
                  { sizeW: "fixed", sizeH: "fixed", width: origin.width, height: origin.height },
                  gesture,
                );
              }
            }
            const next = resizeRect(origin, handle, dx, dy);
            useDoc
              .getState()
              .setNodeRect(
                id,
                inFlow ? { width: next.width, height: next.height } : next,
                gesture,
              );
          });
          return;
        }
      }

      // --- image import -----------------------------------------------------
      if (tool === "image") {
        e.preventDefault();
        void placeImageAt(start.x, start.y);
        return;
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
            const cur = activeFile();
            const page = cur.doc.pages[cur.currentPageId];
            const parent = frameAt(cur.doc, page.children, start.x, start.y);
            if (parent) {
              const o = parentOrigin(cur.doc, parent);
              rect = { ...rect, x: rect.x - o.x, y: rect.y - o.y };
            }

            const id = useDoc.getState().addNode(tool, rect, parent);
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

        // Detected here rather than from a `dblclick` event: the move branch
        // calls preventDefault to start dragging, which suppresses the
        // browser's synthesised click/dblclick pair.
        if (nodeEl) {
          const hit = nodeEl.dataset.nodeId!;
          const now = Date.now();
          if (lastPress.id === hit && now - lastPress.at < DOUBLE_MS) {
            lastPress = { id: null, at: 0 };
            const n = af.doc.nodes[hit];
            if (n && !n.locked && (n.type === "text" || n.type === "path")) {
              e.preventDefault();
              store.select([hit]);
              store.setEditing(hit);
              return;
            }
          }
          lastPress = { id: hit, at: now };
        } else {
          lastPress = { id: null, at: 0 };
        }

        if (!nodeEl) {
          // Empty canvas: rubber-band select. Additive with shift held, so an
          // existing selection can be extended rather than replaced.
          const base = e.shiftKey ? af.selection : [];
          if (!e.shiftKey) store.clearSelection();
          e.preventDefault();
          setMarquee({ x: start.x, y: start.y, width: 0, height: 0 });

          // Nothing moves while a marquee is dragged, so the page is measured
          // once here rather than on every pointer move. Reading layout each
          // frame — right after writing a new selection — is what makes a
          // rubber band over a large page stutter.
          const page0 = activeFile().doc.pages[activeFile().currentPageId];
          const placed = collectWorldRects(activeFile().doc, page0.children);

          drag(
            e,
            (w) => {
              const box = normalise(start.x, start.y, w.x, w.y);
              setMarquee(box);
              const hits = placed
                .filter((n) => n.visible && !n.locked && rectsIntersect(box, n))
                .map((n) => n.id);
              useDoc.getState().select([...new Set([...base, ...hits])]);
            },
            () => setMarquee(null),
          );
          return;
        }
        const id = nodeEl.dataset.nodeId!;
        const node = af.doc.nodes[id];
        if (!node || node.locked) return;

        if (e.shiftKey) {
          store.toggleSelect(id);
        } else if (!af.selection.includes(id)) {
          store.select([id]);
        }

        e.preventDefault();
        // One key for the whole drag, so it collapses to a single undo step.
        const ids = activeFile().selection;
        const gesture = `move:${ids.join(",")}:${Date.now()}`;

        // Capture origins up front so each move is applied to the start
        // position, never accumulated from the previous frame.
        //
        // A child its parent lays out has no x/y to move. Dragging one is the
        // absolute-position override: it leaves the flow at exactly the spot
        // it was already occupying, so the gesture starts without a jump.
        // Measuring is only a read — nothing is written here, because a press
        // is not yet a drag and selecting something must never move it.
        const origins = new Map<string, { x: number; y: number }>();
        const flowing = new Set<string>();
        for (const nid of ids) {
          const n = activeFile().doc.nodes[nid];
          const spot = isLaidOut(activeFile().doc, nid)
            ? localRect(activeFile().doc, nid)
            : null;
          if (spot) flowing.add(nid);
          origins.set(nid, spot ?? { x: n.x, y: n.y });
        }
        // Nothing is written until the pointer has actually travelled. A
        // click that happens to land on a node selects it and leaves it
        // exactly where it was — which matters most for a node in a flow,
        // where the first write would pull it out of the layout and shuffle
        // everything around it.
        let dragging = false;
        drag(e, (w) => {
          const dx = w.x - start.x;
          const dy = w.y - start.y;
          if (!dragging) {
            if (Math.abs(dx) < CLICK_SLOP && Math.abs(dy) < CLICK_SLOP) return;
            dragging = true;
            const st0 = useDoc.getState();
            for (const nid of flowing) {
              const o = origins.get(nid)!;
              st0.updateNode(nid, { placement: "absolute", x: o.x, y: o.y }, gesture);
            }
          }
          const st = useDoc.getState();
          origins.forEach((o, nid) =>
            st.setNodeRect(nid, { x: o.x + dx, y: o.y + dy }, gesture));
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
      // Capture is an optimisation, not a requirement: it keeps events coming
      // when the pointer leaves the element. It throws for a pointer the
      // browser no longer considers active, and losing the whole gesture —
      // listeners included — over that would be worse than tracking without it.
      try {
        elm.setPointerCapture(e.pointerId);
      } catch {
        // Tracked without capture.
      }
      let last = toWorld(e);

      const move = (m: PointerEvent) => {
        last = toWorld(m);
        onMove(last);
      };
      const up = () => {
        try {
          elm.releasePointerCapture(e.pointerId);
        } catch {
          // Never captured, or already released.
        }
        elm.removeEventListener("pointermove", move);
        elm.removeEventListener("pointerup", up);
        elm.removeEventListener("pointercancel", up);
        onEnd?.(last);
      };
      elm.addEventListener("pointermove", move);
      elm.addEventListener("pointerup", up);
      elm.addEventListener("pointercancel", up);
    }

    el.addEventListener("pointerdown", onPointerDown);
    return () => el.removeEventListener("pointerdown", onPointerDown);
  }, [ref, spaceHeld]);

  return { draft, marquee };
}
