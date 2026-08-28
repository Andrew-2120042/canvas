import { useEffect, useRef, useState, type RefObject } from "react";
import { useViewport } from "../state/viewport";

const ARROW_STEP = 40;
const ARROW_STEP_LARGE = 200;
const ZOOM_KEY_FACTOR = 1.2;
/** Trackpad pinch arrives as a ctrl-wheel; damp it so a pinch isn't a leap. */
const WHEEL_ZOOM_DAMPING = 0.01;

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

    const centre = () => {
      const r = el.getBoundingClientRect();
      return { x: r.width / 2, y: r.height / 2 };
    };
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey || e.metaKey) {
        // Pinch, or an explicit zoom gesture.
        useViewport
          .getState()
          .zoomAt(Math.exp(-e.deltaY * WHEEL_ZOOM_DAMPING), p.x, p.y);
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

      const step = e.shiftKey ? ARROW_STEP_LARGE : ARROW_STEP;
      switch (e.key) {
        case "ArrowLeft":  vp.panBy(step, 0);  e.preventDefault(); return;
        case "ArrowRight": vp.panBy(-step, 0); e.preventDefault(); return;
        case "ArrowUp":    vp.panBy(0, step);  e.preventDefault(); return;
        case "ArrowDown":  vp.panBy(0, -step); e.preventDefault(); return;
      }

      if (e.metaKey || e.ctrlKey) {
        const c = centre();
        if (e.key === "=" || e.key === "+") {
          vp.zoomAt(ZOOM_KEY_FACTOR, c.x, c.y); e.preventDefault();
        } else if (e.key === "-" || e.key === "_") {
          vp.zoomAt(1 / ZOOM_KEY_FACTOR, c.x, c.y); e.preventDefault();
        } else if (e.key === "0") {
          vp.zoomTo(1, c.x, c.y); e.preventDefault();
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
      const panning = e.button === 1 || (e.button === 0 && spaceRef.current);
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
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [ref]);

  return { spaceHeld, dragging };
}
