import { useActive, worldRect } from "../document/store";
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

  if (selection.length === 0) return null;

  return (
    <div className="selection-overlay">
      {selection.map((id: string) => {
        // A hidden node stays selected so it can be brought back, but drawing
        // its box would outline empty space.
        if (!doc.nodes[id]?.visible) return null;
        const r = worldRect(doc, id);
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
