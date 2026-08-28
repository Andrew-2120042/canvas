import { useRef } from "react";
import { useViewport } from "../state/viewport";
import { useViewportControls } from "../canvas/useViewportControls";
import { dotGridStyle } from "../canvas/dotGrid";

/**
 * Infinite viewport. The dot grid is painted on this element while content
 * lives in a single transformed layer inside it, so panning and zooming move
 * one compositor layer rather than reflowing anything.
 */
export function CanvasRegion() {
  const ref = useRef<HTMLElement>(null);
  const { spaceHeld, dragging } = useViewportControls(ref);
  const x = useViewport((s) => s.x);
  const y = useViewport((s) => s.y);
  const zoom = useViewport((s) => s.zoom);

  const cursor = dragging ? "grabbing" : spaceHeld ? "grab" : "default";

  return (
    <main
      ref={ref}
      className="canvas-region"
      style={{ ...dotGridStyle({ x, y, zoom }), cursor }}
      tabIndex={-1}
    >
      <div
        className="canvas-content"
        style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}
      >
        {/* Pages and primitives land here from 1.3 onward. */}
      </div>
    </main>
  );
}
