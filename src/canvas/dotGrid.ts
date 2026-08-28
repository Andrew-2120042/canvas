import type { CSSProperties } from "react";
import type { Viewport } from "../state/viewport";

/** Grid spacing in world units. */
const BASE_STEP = 16;
/** Keep on-screen spacing inside this range by doubling/halving the step,
 *  so the grid stays readable from 2% to 6400% zoom. */
const MIN_SCREEN_STEP = 12;
const MAX_SCREEN_STEP = 96;

export function gridStepFor(zoom: number): number {
  let step = BASE_STEP;
  while (step * zoom < MIN_SCREEN_STEP) step *= 2;
  while (step * zoom > MAX_SCREEN_STEP) step /= 2;
  return step;
}

/**
 * Dot grid as a tiled background. Dots are drawn at a constant 1px radius
 * regardless of zoom — scaling them would turn the grid to mush when zoomed
 * out and to blobs when zoomed in.
 */
export function dotGridStyle(v: Viewport): CSSProperties {
  const screenStep = gridStepFor(v.zoom) * v.zoom;
  // Modulo keeps the offset small; a huge background-position degrades badly.
  const ox = ((v.x % screenStep) + screenStep) % screenStep;
  const oy = ((v.y % screenStep) + screenStep) % screenStep;

  return {
    backgroundImage:
      "radial-gradient(circle, var(--dot-grid) 1px, transparent 1px)",
    backgroundSize: `${screenStep}px ${screenStep}px`,
    backgroundPosition: `${ox}px ${oy}px`,
  };
}
