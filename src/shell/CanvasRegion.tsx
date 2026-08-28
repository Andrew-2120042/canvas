import { useEffect, useRef } from "react";
import { useViewport } from "../state/viewport";
import { useTool } from "../state/tools";
import { useDoc } from "../document/store";
import { useViewportControls } from "../canvas/useViewportControls";
import { useCanvasInteraction } from "../canvas/useCanvasInteraction";
import { SceneNodeView } from "../canvas/SceneNodeView";
import { SelectionOverlay } from "../canvas/SelectionOverlay";

/**
 * Infinite viewport. Content lives in a single transformed layer, so panning
 * and zooming move one compositor layer rather than reflowing anything.
 */
export function CanvasRegion() {
  const ref = useRef<HTMLElement>(null);
  const { spaceHeld, dragging } = useViewportControls(ref);
  const { draft, marquee } = useCanvasInteraction(ref, spaceHeld);

  const { x, y, zoom } = useViewport();
  const tool = useTool((s) => s.tool);
  const page = useDoc((s) => s.doc.pages[s.currentPageId]);

  // Tool shortcuts. The full set arrives with the toolbar in 1.7; these are
  // the ones needed to exercise the primitives.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || t?.isContentEditable) return;
      if (useDoc.getState().editingId) return; // typing, not shortcutting
      const map: Record<string, "move" | "frame" | "rect" | "text"> = {
        v: "move", f: "frame", r: "rect", t: "text",
      };
      const next = map[e.key.toLowerCase()];
      if (next) useTool.getState().setTool(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cursor = dragging
    ? "grabbing"
    : spaceHeld
      ? "grab"
      : tool === "frame" || tool === "rect"
        ? "crosshair"
        : tool === "text"
          ? "text"
          : "default";

  return (
    <main ref={ref} className="canvas-region" style={{ cursor }} tabIndex={-1}>
      <div
        className="canvas-content"
        style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}
      >
        {page.children.map((id) => (
          <SceneNodeView key={id} id={id} />
        ))}

        {marquee && (
          <div
            className="marquee"
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.width,
              height: marquee.height,
              borderWidth: 1 / zoom,
            }}
          />
        )}

        {draft && (
          <div
            className="draft-node"
            style={{
              left: draft.x,
              top: draft.y,
              width: draft.width,
              height: draft.height,
              outlineWidth: 1 / zoom,
            }}
          />
        )}
      </div>

      <SelectionOverlay />
    </main>
  );
}
