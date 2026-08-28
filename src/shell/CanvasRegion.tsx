import { useEffect, useRef, useState } from "react";
import { useViewport } from "../state/viewport";
import { SHORTCUTS, useTool } from "../state/tools";
import { activeFile, useActive } from "../document/store";
import { useViewportControls } from "../canvas/useViewportControls";
import { useCanvasInteraction } from "../canvas/useCanvasInteraction";
import { useKeyboard } from "../canvas/useKeyboard";
import { SceneNodeView } from "../canvas/SceneNodeView";
import { SelectionOverlay } from "../canvas/SelectionOverlay";
import { CommentLayer, type PendingComment } from "../canvas/CommentLayer";
import { usePenTool } from "../canvas/usePenTool";
import { PenPreview } from "../canvas/PenPreview";
import { PathEditOverlay } from "../canvas/PathEditOverlay";

/**
 * Infinite viewport. Content lives in a single transformed layer, so panning
 * and zooming move one compositor layer rather than reflowing anything.
 */
export function CanvasRegion() {
  const ref = useRef<HTMLElement>(null);
  const { spaceHeld, dragging } = useViewportControls(ref);
  const { draft, marquee } = useCanvasInteraction(ref, spaceHeld);
  useKeyboard();
  const [pending, setPending] = useState<PendingComment | null>(null);
  const penDraft = usePenTool(ref);

  const { x, y, zoom } = useViewport();
  const tool = useTool((s) => s.tool);
  const page = useActive((f) => f.doc.pages[f.currentPageId]);

  // Tool shortcuts: V/H/F/R/T. Stub tools deliberately have none.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || t?.isContentEditable) return;
      if (activeFile().editingId) return; // typing, not shortcutting
      const next = SHORTCUTS[e.key.toLowerCase()];
      if (next) useTool.getState().setTool(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cursor = dragging
    ? "grabbing"
    : spaceHeld || tool === "pan"
      ? "grab"
      : tool === "frame" || tool === "rect" || tool === "comment" || tool === "pen"
        ? "crosshair"
        : tool === "text"
          ? "text"
          : "default";

  return (
    <main
      ref={ref}
      className="canvas-region"
      onPointerDownCapture={(e) => {
        if (useTool.getState().tool !== "comment") return;
        // Never steal a press aimed at an open composer or an existing pin.
        if ((e.target as HTMLElement).closest(".comment-card, .comment-pin")) return;
        // With a composer already open, a press outside dismisses it rather
        // than dropping a second pin on top.
        if (pending) {
          setPending(null);
          return;
        }
        const r = ref.current!.getBoundingClientRect();
        const v = useViewport.getState();
        setPending({
          x: (e.clientX - r.left - v.x) / v.zoom,
          y: (e.clientY - r.top - v.y) / v.zoom,
        });
      }}
      /* The backdrop is the page fill, not a chrome colour — the reference
         shows this same value in the Page fill swatch. */
      style={{ cursor, background: page.background }}
      tabIndex={-1}
    >
      <div
        className="canvas-content"
        style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}
      >
        {page.children.map((id: string) => (
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

      <PenPreview draft={penDraft} />
      <PathEditOverlay />
      <SelectionOverlay />
      <CommentLayer pending={pending} onCancel={() => setPending(null)} />
    </main>
  );
}
