import { useEffect, useRef, useState, type RefObject } from "react";
import { useDoc } from "../document/store";
import type { PathPoint } from "../document/types";
import { useTool } from "../state/tools";
import { useViewport } from "../state/viewport";
import { emptyPoint, normalise, pathBounds } from "./pathGeometry";

/** Screen-space radius for snapping the last click onto the first anchor. */
const CLOSE_SNAP = 10;

export interface PenDraft {
  points: PathPoint[];
  /** Live cursor position, for the rubber-band segment. */
  cursor: { x: number; y: number } | null;
  closed: boolean;
}

/**
 * Pen drawing.
 *
 * Click places a corner. Click-and-drag places a smooth point, the drag
 * setting the outgoing handle and mirroring it into the incoming one — the
 * standard bezier pen gesture. Clicking the first anchor closes the path;
 * Enter or Escape finishes it open. Double-click also finishes.
 */
export function usePenTool(ref: RefObject<HTMLElement | null>) {
  const [draft, setDraft] = useState<PenDraft | null>(null);
  // Mirrored so the finish handlers can read the draft without running a
  // state updater. React may invoke an updater more than once, and committing
  // inside one creates the node twice.
  const draftRef = useRef<PenDraft | null>(null);
  draftRef.current = draft;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const toWorld = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      const v = useViewport.getState();
      return {
        x: (e.clientX - r.left - v.x) / v.zoom,
        y: (e.clientY - r.top - v.y) / v.zoom,
      };
    };

    /** Turn the draft into a real node, or discard it if too short. */
    const commit = (points: PathPoint[], closed: boolean) => {
      setDraft(null);
      if (points.length < 2) return;
      const b = pathBounds(points);
      const { points: local } = normalise(points);
      const st = useDoc.getState();
      const id = st.addNode("path", {
        x: b.x, y: b.y, width: Math.max(b.width, 1), height: Math.max(b.height, 1),
      });
      st.updateNode(id, { points: local, closed });
      st.select([id]);
      useTool.getState().setTool("move");
    };

    const onPointerDown = (e: PointerEvent) => {
      if (useTool.getState().tool !== "pen" || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const world = toWorld(e);
      const zoom = useViewport.getState().zoom;
      const current = draft?.points ?? [];

      // Clicking the first anchor closes the shape.
      if (current.length > 1) {
        const first = current[0];
        const dist = Math.hypot(first.x - world.x, first.y - world.y) * zoom;
        if (dist <= CLOSE_SNAP) {
          commit(current, true);
          return;
        }
      }

      const point = emptyPoint(world.x, world.y);
      const points = [...current, point];
      setDraft({ points, cursor: world, closed: false });

      // Dragging off the click turns this anchor into a smooth point.
      const index = points.length - 1;
      const onMove = (m: PointerEvent) => {
        const w = toWorld(m);
        const dx = w.x - world.x;
        const dy = w.y - world.y;
        if (Math.hypot(dx, dy) * zoom < 2) return;
        setDraft((d) => {
          if (!d) return d;
          const next = [...d.points];
          next[index] = {
            ...next[index],
            outX: dx, outY: dy,
            inX: -dx, inY: -dy, // mirrored, so the curve passes through smoothly
          };
          return { ...d, points: next };
        });
      };
      const onUp = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
    };

    /** Rubber-band segment from the last anchor to the cursor. */
    const onHover = (e: PointerEvent) => {
      setDraft((d) => (d ? { ...d, cursor: toWorld(e) } : d));
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (useTool.getState().tool !== "pen") return;
      e.preventDefault();
      const d = draftRef.current;
      if (d) commit(d.points, false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (useTool.getState().tool !== "pen") return;
      if (e.key === "Enter") {
        e.preventDefault();
        const d = draftRef.current;
        if (d) commit(d.points, false);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setDraft(null);
        useTool.getState().setTool("move");
      }
    };

    el.addEventListener("pointerdown", onPointerDown, true);
    el.addEventListener("pointermove", onHover);
    el.addEventListener("dblclick", onDoubleClick, true);
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, true);
      el.removeEventListener("pointermove", onHover);
      el.removeEventListener("dblclick", onDoubleClick, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ref, draft]);

  // Leaving the pen tool abandons an unfinished path rather than stranding it.
  const tool = useTool((s) => s.tool);
  useEffect(() => {
    if (tool !== "pen") setDraft(null);
  }, [tool]);

  return draft;
}
