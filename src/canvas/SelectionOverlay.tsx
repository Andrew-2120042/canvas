import { useEffect, useLayoutEffect, useState } from "react";
import { useActive, worldRect, type Rect } from "../document/store";
import { useViewport } from "../state/viewport";

/** Resize handle positions, as unit fractions of the selection box. */
export const HANDLES = [
  { key: "nw", fx: 0,   fy: 0   },
  { key: "n",  fx: 0.5, fy: 0   },
  { key: "ne", fx: 1,   fy: 0   },
  { key: "e",  fx: 1,   fy: 0.5 },
  { key: "se", fx: 1,   fy: 1   },
  { key: "s",  fx: 0.5, fy: 1   },
  { key: "sw", fx: 0,   fy: 1   },
  { key: "w",  fx: 0,   fy: 0.5 },
] as const;

export type HandleKey = (typeof HANDLES)[number]["key"];

/**
 * Drawn in screen space rather than inside the transformed content layer, so
 * outlines stay 1px and handles stay 8px at every zoom level.
 */
export function SelectionOverlay() {
  const doc = useActive((f) => f.doc);
  const selection = useActive((f) => f.selection);
  const { x, y, zoom } = useViewport();

  /**
   * Measured after the commit, not during the render.
   *
   * A selected node may be positioned by its parent, in which case its rect
   * has to be read from the DOM — and during render the DOM still holds the
   * *previous* layout. Reading it here, once React has painted, is what keeps
   * the box on the node instead of one edit behind it.
   */
  const [rects, setRects] = useState<Record<string, Rect>>({});

  useLayoutEffect(() => {
    const next: Record<string, Rect> = {};
    for (const id of selection) {
      const r = worldRect(doc, id);
      if (r) next[id] = r;
    }
    setRects((prev) => (sameRects(prev, next) ? prev : next));
  }, [doc, selection]);

  // Layout can also change without the document changing at all — a font
  // arriving, an image decoding, the panel resizing the canvas.
  useEffect(() => {
    if (selection.length === 0) return;
    const observer = new ResizeObserver(() => {
      const next: Record<string, Rect> = {};
      for (const id of selection) {
        const r = worldRect(doc, id);
        if (r) next[id] = r;
      }
      setRects((prev) => (sameRects(prev, next) ? prev : next));
    });
    for (const id of selection) {
      const el = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [doc, selection]);

  if (selection.length === 0) return null;

  return (
    <div className="selection-overlay">
      {selection.map((id: string) => {
        // A hidden node stays selected so it can be brought back, but drawing
        // its box would outline empty space.
        if (!doc.nodes[id]?.visible) return null;
        const r = rects[id];
        if (!r) return null;
        const left = r.x * zoom + x;
        const top = r.y * zoom + y;
        const w = r.width * zoom;
        const h = r.height * zoom;

        return (
          <div key={id} className="selection-box" style={{ left, top, width: w, height: h }}>
            {selection.length === 1 &&
              HANDLES.map((hd) => (
                <div
                  key={hd.key}
                  className="selection-handle"
                  data-handle={hd.key}
                  style={{ left: `${hd.fx * 100}%`, top: `${hd.fy * 100}%` }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** Rect maps compare by value, so an unchanged layout does not re-render. */
function sameRects(a: Record<string, Rect>, b: Record<string, Rect>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => {
    const p = a[k];
    const q = b[k];
    return q && p.x === q.x && p.y === q.y && p.width === q.width && p.height === q.height;
  });
}
