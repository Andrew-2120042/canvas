import { useEffect, useRef, useState, type RefObject } from "react";
import { activeFile } from "../document/store";
import { useTool } from "../state/tools";
import { MAX_ZOOM, MIN_ZOOM, useViewport } from "../state/viewport";

const ARROW_STEP = 40;
const ARROW_STEP_LARGE = 200;
const ZOOM_KEY_FACTOR = 1.25;
/** Trackpad pinch arrives as a ctrl-wheel; damp it so a pinch isn't a leap. */
const WHEEL_ZOOM_DAMPING = 0.0135;
/**
 * How much of the remaining distance to the target zoom is covered each frame.
 *
 * Wheel and pinch events arrive unevenly — a few large deltas, then a burst of
 * small ones — and applying each one the instant it lands makes the canvas
 * lurch in time with the hardware rather than with the gesture. Easing toward
 * a target instead decouples what is drawn from when events happen. Low enough
 * to smooth the steps, high enough that it still stops when the fingers do.
 */
const ZOOM_EASE = 0.4;
/** Below this the remaining distance is not worth another frame. */
const ZOOM_EPSILON = 0.002;

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

/**
 * Pan and zoom for the canvas viewport.
 *
 * Pan:  space+drag, middle-drag, two-finger scroll, arrow keys
 * Zoom: ctrl/cmd+wheel (and trackpad pinch), cmd +/-, cmd+0 = 100%,
 *       shift+1 = zoom to fit
 *
 * Returns whether a grab is available or active, so the cursor can reflect it.
 */
export function useViewportControls(ref: RefObject<HTMLElement | null>) {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Read through a ref inside listeners so they never capture a stale value.
  const spaceRef = useRef(false);
  spaceRef.current = spaceHeld;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Where the zoom gesture is heading, and the screen point it pivots on.
    // null means no gesture is in flight.
    let zoomTarget: number | null = null;
    let zoomAnchor = { x: 0, y: 0 };
    let zoomFrame = 0;
    const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

    const centre = () => {
      const r = el.getBoundingClientRect();
      return { x: r.width / 2, y: r.height / 2 };
    };
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    /**
     * Ease the viewport toward the zoom the gesture has asked for.
     *
     * Interpolating in log space keeps the motion even: a step from 2x to 4x
     * covers the same visual distance as one from 8x to 16x, which is how
     * zooming is actually perceived.
     */
    const stepZoom = () => {
      zoomFrame = 0;
      const target = zoomTarget;
      if (target === null) return;

      const vp = useViewport.getState();
      const remaining = Math.log(target / vp.zoom);
      if (Math.abs(remaining) < ZOOM_EPSILON) {
        vp.zoomAt(target / vp.zoom, zoomAnchor.x, zoomAnchor.y);
        zoomTarget = null;
        return;
      }
      vp.zoomAt(Math.exp(remaining * ZOOM_EASE), zoomAnchor.x, zoomAnchor.y);
      zoomFrame = requestAnimationFrame(stepZoom);
    };

    /** Aim the easing at a zoom, pivoting on a screen point. */
    const easeZoomTo = (z: number, anchor: { x: number; y: number }) => {
      zoomTarget = clamp(z);
      zoomAnchor = anchor;
      if (!zoomFrame) zoomFrame = requestAnimationFrame(stepZoom);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey || e.metaKey) {
        // Pinch, or an explicit zoom gesture. Accumulated onto the target
        // rather than the current zoom, so a fast gesture is not throttled by
        // how far the easing has got.
        const from = zoomTarget ?? useViewport.getState().zoom;
        easeZoomTo(from * Math.exp(-e.deltaY * WHEEL_ZOOM_DAMPING), p);
      } else {
        useViewport.getState().panBy(-e.deltaX, -e.deltaY);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const vp = useViewport.getState();

      if (e.code === "Space" && !spaceRef.current) {
        setSpaceHeld(true);
        e.preventDefault();
        return;
      }

      // With a selection, arrows nudge the nodes instead — see useKeyboard.
      if (activeFile().selection.length > 0 && e.key.startsWith("Arrow")) return;

      const step = e.shiftKey ? ARROW_STEP_LARGE : ARROW_STEP;
      switch (e.key) {
        case "ArrowLeft":  vp.panBy(step, 0);  e.preventDefault(); return;
        case "ArrowRight": vp.panBy(-step, 0); e.preventDefault(); return;
        case "ArrowUp":    vp.panBy(0, step);  e.preventDefault(); return;
        case "ArrowDown":  vp.panBy(0, -step); e.preventDefault(); return;
      }

      if (e.metaKey || e.ctrlKey) {
        const c = centre();
        // Through the same easing as the wheel, so held-down +/- glides
        // instead of stepping, and repeats accumulate onto one target.
        if (e.key === "=" || e.key === "+") {
          easeZoomTo((zoomTarget ?? vp.zoom) * ZOOM_KEY_FACTOR, c); e.preventDefault();
        } else if (e.key === "-" || e.key === "_") {
          easeZoomTo((zoomTarget ?? vp.zoom) / ZOOM_KEY_FACTOR, c); e.preventDefault();
        } else if (e.key === "0") {
          easeZoomTo(1, c); e.preventDefault();
        }
      } else if (e.shiftKey && e.key === "!") {
        // Shift+1 — zoom to fit. Nothing to fit until 1.3, so reset to 1:1.
        vp.reset(0);
        e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    // A window blur while space is held would otherwise strand the grab state.
    const onBlur = () => setSpaceHeld(false);

    const onPointerDown = (e: PointerEvent) => {
      const panTool = useTool.getState().tool === "pan";
      const panning =
        e.button === 1 || (e.button === 0 && (spaceRef.current || panTool));
      if (!panning) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      setDragging(true);

      let lastX = e.clientX;
      let lastY = e.clientY;

      const onMove = (m: PointerEvent) => {
        useViewport.getState().panBy(m.clientX - lastX, m.clientY - lastY);
        lastX = m.clientX;
        lastY = m.clientY;
      };
      const onUp = () => {
        setDragging(false);
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      // A gesture must not keep animating a viewport this effect no longer owns.
      if (zoomFrame) cancelAnimationFrame(zoomFrame);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [ref]);

  return { spaceHeld, dragging };
}
