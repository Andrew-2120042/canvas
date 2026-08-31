import { create } from "zustand";

export const MIN_ZOOM = 0.02;
/* Scale stays layout-accurate at rest however far in it goes — see the note
   in CanvasRegion — so the ceiling is set by what is useful, not by where the
   renderer gives up. */
export const MAX_ZOOM = 256;

/** Screen-space pan in CSS px, plus a scale factor. World -> screen is
 *  `screen = world * zoom + pan`. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface ViewportStore extends Viewport {
  /** Move the viewport by a screen-space delta. */
  panBy: (dx: number, dy: number) => void;
  /** Zoom towards a screen point so the world point under it stays put. */
  zoomAt: (factor: number, screenX: number, screenY: number) => void;
  /** Jump to an exact zoom, keeping a screen point anchored. */
  zoomTo: (zoom: number, screenX: number, screenY: number) => void;
  /** Reset to 1:1 with the world origin at the viewport's top-left inset. */
  reset: (inset?: number) => void;
  /**
   * Frame a world rect in the viewport.
   *
   * Zoom-to-fit is how a user gets back to a page they have zoomed into and
   * lost — the one navigation move a canvas cannot do without, and the only
   * part of 1.2 that was never built.
   */
  fit: (
    rect: { x: number; y: number; width: number; height: number },
    view: { width: number; height: number },
    padding?: number,
  ) => void;
  /** Jump to 1:1 about the centre of the viewport, keeping it in place. */
  actualSize: (view: { width: number; height: number }) => void;
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const useViewport = create<ViewportStore>((set) => ({
  x: 0,
  y: 0,
  zoom: 1,

  panBy: (dx, dy) => set((s) => ({ x: s.x + dx, y: s.y + dy })),

  zoomAt: (factor, screenX, screenY) =>
    set((s) => {
      const zoom = clampZoom(s.zoom * factor);
      if (zoom === s.zoom) return s;
      // Keep the world point under the cursor fixed on screen.
      const k = zoom / s.zoom;
      return {
        zoom,
        x: screenX - (screenX - s.x) * k,
        y: screenY - (screenY - s.y) * k,
      };
    }),

  fit: (rect, view, padding = 64) =>
    set(() => {
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const usableW = Math.max(1, view.width - padding * 2);
      const usableH = Math.max(1, view.height - padding * 2);
      // Never zoom past 1:1 when framing: blowing a small selection up to
      // fill the screen is disorienting, and the user asked to see it whole,
      // not to see it enormous.
      const zoom = clampZoom(Math.min(usableW / w, usableH / h, 1));
      return {
        zoom,
        x: view.width / 2 - (rect.x + w / 2) * zoom,
        y: view.height / 2 - (rect.y + h / 2) * zoom,
      };
    }),

  actualSize: (view) =>
    set((s) => {
      const k = 1 / s.zoom;
      const cx = view.width / 2;
      const cy = view.height / 2;
      // Anchored on the middle of the viewport, so whatever the user was
      // looking at is still what they are looking at.
      return { zoom: 1, x: cx - (cx - s.x) * k, y: cy - (cy - s.y) * k };
    }),

  zoomTo: (target, screenX, screenY) =>
    set((s) => {
      const zoom = clampZoom(target);
      if (zoom === s.zoom) return s;
      const k = zoom / s.zoom;
      return {
        zoom,
        x: screenX - (screenX - s.x) * k,
        y: screenY - (screenY - s.y) * k,
      };
    }),

  reset: (inset = 0) => set({ x: inset, y: inset, zoom: 1 }),
}));

/** Convert a screen point (relative to the canvas element) into world space. */
export function screenToWorld(v: Viewport, sx: number, sy: number) {
  return { x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom };
}
