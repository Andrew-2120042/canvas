import { useEffect, useRef, useState } from "react";
import { MIN_ZOOM, useViewport } from "../state/viewport";
import { SHORTCUTS, useTool } from "../state/tools";
import { activeFile, useActive, worldRect } from "../document/store";
import { useViewportControls } from "../canvas/useViewportControls";
import { useCanvasInteraction } from "../canvas/useCanvasInteraction";
import { useKeyboard } from "../canvas/useKeyboard";
import { SceneNodeView } from "../canvas/SceneNodeView";
import { SelectionOverlay } from "../canvas/SelectionOverlay";
import { ArrivalOutlines } from "../canvas/ArrivalOutlines";
import { StreamPreview } from "../canvas/StreamPreview";
import { CommentLayer, type PendingComment } from "../canvas/CommentLayer";
import { usePenTool } from "../canvas/usePenTool";
import { PenPreview } from "../canvas/PenPreview";
import { PathEditOverlay } from "../canvas/PathEditOverlay";
import { BuildStatus } from "../canvas/BuildStatus";

/**
 * Below this, scale rides on a transform instead of going through layout.
 *
 * The floor is 1: the design is never laid out at a scale *smaller* than it
 * was authored at. Shrinking the layout is where text metrics stop being
 * proportional — small rendered sizes get hinted differently and hit the
 * engine's minimum font size, which changed auto-sized text by up to 16% and
 * visibly moved things around. Magnifying has no such problem, so everything
 * from 100% up is laid out at its true scale and rendered sharp.
 *
 * Below 100% a transform shrinks the last raster, which downsamples cleanly
 * and keeps the design exactly the shape it was drawn.
 */
const CRISP_FROM = 1;
/** Long enough that a wheel or pinch gesture reads as one continuous motion. */
const SETTLE_MS = 140;

/**
 * Infinite viewport.
 *
 * Scale is split across two elements, and the split is what keeps the canvas
 * both smooth and sharp:
 *
 * - `zoom` on the content layer is a *layout* property. The subtree is laid
 *   out at the magnified size and glyphs and vectors are rasterised at that
 *   size, so they are sharp rather than upscaled. It costs a re-layout, so it
 *   cannot run on every wheel tick.
 * - `scale()` on the pan layer is a *transform*. It costs no layout at all,
 *   but it stretches whatever was last rasterised.
 *
 * So the transform carries only the difference between the current zoom and
 * the layout scale beneath it, and that layout scale is held still for the
 * whole gesture. Zooming therefore costs no layout whatsoever — it is one
 * transform update per frame, exactly as it was before any of this — and the
 * design goes a little soft only while it is actually moving. The moment the
 * motion stops the layout scale becomes the exact zoom, the transform returns
 * to 1, and what is on screen is rendered rather than stretched.
 *
 * This applies to zooming out as much as to zooming in. A transform that
 * shrinks is downsampling a texture rasterised at full size, which is why a
 * design viewed from far away looked soft; laying it out at the smaller scale
 * renders it the way a browser renders any small text, which is sharp.
 *
 * Both paths leave layout offsets in unscaled pixels, so geometry, selection
 * and the MCP tools never need to know which is in effect.
 */
export function CanvasRegion() {
  const ref = useRef<HTMLElement>(null);
  const { spaceHeld, dragging } = useViewportControls(ref);
  const { draft, marquee } = useCanvasInteraction(ref, spaceHeld);
  useKeyboard();
  const [pending, setPending] = useState<PendingComment | null>(null);
  const penDraft = usePenTool(ref);

  const { x, y, zoom } = useViewport();

  // The scale the subtree is actually laid out at. It deliberately lags the
  // viewport: re-laying out mid-gesture is what makes zooming feel heavy, so
  // during motion the transform absorbs the whole difference and no layout
  // happens at all. The instant the motion stops, this catches up and the
  // transform falls back to 1, which is pixel-exact.
  const [base, setBase] = useState(1);
  const target = zoom < CRISP_FROM ? 1 : zoom;
  const residual = zoom / base;

  useEffect(() => {
    if (target === base) return;
    // One exception to waiting: a gesture long enough to stretch the texture
    // this far is visibly soft, so catch up immediately rather than ride it
    // out. A normal flick never gets here.
    const stretchedTooFar = residual > 3 || residual < 1 / 3;
    const t = setTimeout(() => setBase(target), stretchedTooFar ? 0 : SETTLE_MS);
    return () => clearTimeout(t);
  }, [target, base, residual]);
  const tool = useTool((s) => s.tool);
  const page = useActive((f) => f.doc.pages[f.currentPageId]);
  const pageId = useActive((f) => f.currentPageId);

  /**
   * Show the new page's content when the page changes.
   *
   * The viewport is a property of the window, not of the page, so switching
   * used to leave it wherever it was — which on a different page is almost
   * always empty space. The work was there and rendered; it just was not
   * anywhere near the part of the canvas being looked at, which reads as
   * nothing having happened at all.
   */
  useEffect(() => {
    const f = activeFile();
    const p = f.doc.pages[f.currentPageId];
    if (!p) return;

    const rects = p.children
      .map((id) => worldRect(f.doc, id))
      .filter((r): r is NonNullable<typeof r> => !!r);
    if (rects.length === 0) return;

    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.width));
    const maxY = Math.max(...rects.map((r) => r.y + r.height));

    const box = ref.current?.getBoundingClientRect();
    const vw = box?.width ?? 1200;
    const vh = box?.height ?? 800;
    const margin = 1.08;
    const zoom = Math.max(
      MIN_ZOOM,
      Math.min(1, vw / ((maxX - minX) * margin), vh / ((maxY - minY) * margin)),
    );
    useViewport.setState({
      x: vw / 2 - ((minX + maxX) / 2) * zoom,
      y: vh / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    });
  }, [pageId]);

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
      {/* Pan and scale are deliberately separate elements. Pan is a transform,
          which is cheap and composited. Scale is CSS `zoom`, which is a layout
          property: the browser lays the subtree out at the magnified size and
          rasterises glyphs and vectors at that size, so they stay sharp all the
          way in. `transform: scale()` cannot do that — past roughly 10x WebKit
          stops re-rasterising the layer and upscales a texture instead, which
          is what turned type to mush at high zoom. */}
      <div
        className="canvas-pan"
        style={{
          transform:
            residual === 1
              ? `translate(${x}px, ${y}px)`
              : `translate(${x}px, ${y}px) scale(${residual})`,
        }}
      >
      <div className="canvas-content" style={base === 1 ? undefined : { zoom: base }}>
        {page.children.map((id: string) => (
          <SceneNodeView key={id} id={id} />
        ))}

        <StreamPreview />

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
      </div>

      <PenPreview draft={penDraft} />
      <PathEditOverlay />
      <ArrivalOutlines />
      <SelectionOverlay />
      <CommentLayer pending={pending} onCancel={() => setPending(null)} />
      <BuildStatus />
    </main>
  );
}
