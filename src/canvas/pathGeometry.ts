import type { PathPoint } from "../document/types";

export const emptyPoint = (x: number, y: number): PathPoint => ({
  x, y, inX: null, inY: null, outX: null, outY: null,
});

/** Bounding box of the anchors and their handles, in the same space. */
export function pathBounds(points: PathPoint[]): {
  x: number; y: number; width: number; height: number;
} {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    xs.push(p.x);
    ys.push(p.y);
    if (p.inX !== null && p.inY !== null) { xs.push(p.x + p.inX); ys.push(p.y + p.inY); }
    if (p.outX !== null && p.outY !== null) { xs.push(p.x + p.outX); ys.push(p.y + p.outY); }
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Shift every anchor so the path's bounds start at the origin. */
export function normalise(points: PathPoint[]): {
  points: PathPoint[]; dx: number; dy: number;
} {
  const b = pathBounds(points);
  if (b.x === 0 && b.y === 0) return { points, dx: 0, dy: 0 };
  return {
    points: points.map((p) => ({ ...p, x: p.x - b.x, y: p.y - b.y })),
    dx: b.x,
    dy: b.y,
  };
}

/**
 * SVG path data. A segment is a cubic when either side carries a handle and a
 * straight line otherwise, which is what makes a corner and a smooth point
 * differ by data rather than by kind.
 */
export function toPathData(points: PathPoint[], closed: boolean): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const seg = (a: PathPoint, b: PathPoint): string => {
    const hasOut = a.outX !== null && a.outY !== null;
    const hasIn = b.inX !== null && b.inY !== null;
    if (!hasOut && !hasIn) return `L ${b.x} ${b.y}`;
    const c1x = hasOut ? a.x + a.outX! : a.x;
    const c1y = hasOut ? a.y + a.outY! : a.y;
    const c2x = hasIn ? b.x + b.inX! : b.x;
    const c2y = hasIn ? b.y + b.inY! : b.y;
    return `C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`;
  };

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) d += ` ${seg(points[i - 1], points[i])}`;
  if (closed && points.length > 2) {
    d += ` ${seg(points[points.length - 1], points[0])} Z`;
  }
  return d;
}
