import { useActive, useDoc } from "../document/store";
import { useViewport } from "../state/viewport";

/**
 * Anchor and handle editing for the path currently open for editing.
 *
 * Drawn in screen space so the handles stay a constant size, while the values
 * written back are node-local world units.
 */
export function PathEditOverlay() {
  const editingId = useActive((f) => f.editingId);
  const node = useActive((f) => (f.editingId ? f.doc.nodes[f.editingId] : undefined));
  const doc = useActive((f) => f.doc);
  const { x, y, zoom } = useViewport();

  if (!editingId || !node || node.type !== "path" || !node.points) return null;

  // Node-local -> screen, walking ancestors for nested paths.
  let ox = node.x;
  let oy = node.y;
  let p = node.parent;
  while (p) {
    const parent = doc.nodes[p];
    if (!parent) break;
    ox += parent.x;
    oy += parent.y;
    p = parent.parent;
  }
  const toScreen = (px: number, py: number) => ({
    left: (ox + px) * zoom + x,
    top: (oy + py) * zoom + y,
  });

  const startDrag = (
    e: React.PointerEvent,
    index: number,
    kind: "anchor" | "in" | "out",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const pt = node.points![index];
    const startX = e.clientX;
    const startY = e.clientY;
    const gesture = `path:${editingId}:${index}:${kind}:${Date.now()}`;

    const onMove = (m: PointerEvent) => {
      const dx = (m.clientX - startX) / zoom;
      const dy = (m.clientY - startY) / zoom;
      const st = useDoc.getState();
      if (kind === "anchor") {
        st.updatePathPoint(editingId, index, { x: pt.x + dx, y: pt.y + dy }, gesture);
      } else if (kind === "out") {
        st.updatePathPoint(editingId, index, {
          outX: (pt.outX ?? 0) + dx, outY: (pt.outY ?? 0) + dy,
        }, gesture);
      } else {
        st.updatePathPoint(editingId, index, {
          inX: (pt.inX ?? 0) + dx, inY: (pt.inY ?? 0) + dy,
        }, gesture);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="path-edit-overlay">
      {node.points.map((pt, i) => (
        <div key={i}>
          {pt.outX !== null && pt.outY !== null && (
            <div
              className="path-handle"
              style={toScreen(pt.x + pt.outX, pt.y + pt.outY)}
              onPointerDown={(e) => startDrag(e, i, "out")}
            />
          )}
          {pt.inX !== null && pt.inY !== null && (
            <div
              className="path-handle"
              style={toScreen(pt.x + pt.inX, pt.y + pt.inY)}
              onPointerDown={(e) => startDrag(e, i, "in")}
            />
          )}
          <div
            className="path-anchor"
            style={toScreen(pt.x, pt.y)}
            onPointerDown={(e) => startDrag(e, i, "anchor")}
          />
        </div>
      ))}
    </div>
  );
}
