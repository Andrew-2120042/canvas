import { create } from "zustand";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

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
