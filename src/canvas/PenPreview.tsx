import type { PenDraft } from "./usePenTool";
import { toPathData } from "./pathGeometry";
import { useViewport } from "../state/viewport";
import { emptyPoint } from "./pathGeometry";

/**
 * The in-progress path, drawn in screen space so anchors and the rubber-band
 * segment keep a constant size while the geometry lives in world units.
 */
export function PenPreview({ draft }: { draft: PenDraft | null }) {
  const { x, y, zoom } = useViewport();
  if (!draft || draft.points.length === 0) return null;

  const toScreen = (px: number, py: number) => ({
    x: px * zoom + x,
    y: py * zoom + y,
  });

  const screenPoints = draft.points.map((p) => {
    const s = toScreen(p.x, p.y);
    return {
      ...p,
      x: s.x,
      y: s.y,
      inX: p.inX === null ? null : p.inX * zoom,
      inY: p.inY === null ? null : p.inY * zoom,
      outX: p.outX === null ? null : p.outX * zoom,
      outY: p.outY === null ? null : p.outY * zoom,
    };
  });

  // Rubber band: the committed path plus a provisional point at the cursor.
  const withCursor = draft.cursor
    ? [...screenPoints, emptyPoint(
        draft.cursor.x * zoom + x, draft.cursor.y * zoom + y)]
    : screenPoints;

  const last = screenPoints[screenPoints.length - 1];

  return (
    <svg className="pen-preview">
      <path d={toPathData(withCursor, false)} fill="none" stroke="#2B7FFF" strokeWidth={1.5} />

      {screenPoints.map((p, i) => (
        <g key={i}>
          {p.outX !== null && p.outY !== null && (
            <>
              <line x1={p.x} y1={p.y} x2={p.x + p.outX} y2={p.y + p.outY}
                    stroke="#2B7FFF" strokeWidth={1} />
              <circle cx={p.x + p.outX} cy={p.y + p.outY} r={3} fill="#2B7FFF" />
            </>
          )}
          {p.inX !== null && p.inY !== null && (
            <>
              <line x1={p.x} y1={p.y} x2={p.x + p.inX} y2={p.y + p.inY}
                    stroke="#2B7FFF" strokeWidth={1} />
              <circle cx={p.x + p.inX} cy={p.y + p.inY} r={3} fill="#2B7FFF" />
            </>
          )}
          <rect x={p.x - 3.5} y={p.y - 3.5} width={7} height={7}
                fill="#FFFFFF" stroke="#2B7FFF" strokeWidth={1.2} />
        </g>
      ))}

      {/* Closing target on the first anchor once the path can be closed. */}
      {screenPoints.length > 1 && last && (
        <circle cx={screenPoints[0].x} cy={screenPoints[0].y} r={6}
                fill="none" stroke="#2B7FFF" strokeWidth={1.2} />
      )}
    </svg>
  );
}
