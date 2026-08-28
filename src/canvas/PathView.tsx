import { rgba } from "../document/style";
import type { SceneNode } from "../document/types";
import { toPathData } from "./pathGeometry";

/**
 * A path node renders as real inline SVG inside its box, the same way a frame
 * renders as a real div — the vector is in the DOM, not painted to a bitmap.
 */
export function PathView({ node }: { node: SceneNode }) {
  const points = node.points ?? [];
  if (points.length < 2) return null;

  const d = toPathData(points, !!node.closed);
  const w = Math.max(node.width, 1);
  const h = Math.max(node.height, 1);

  return (
    <svg
      className="path-svg"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      // Strokes are centred on the outline, so half of one spills past the
      // node box; let it draw rather than clipping it.
      style={{ overflow: "visible" }}
    >
      <path
        d={d}
        fill={node.fill && node.fill !== "transparent" ? rgba(node.fill, 1) : "none"}
        stroke={rgba(node.strokeColor ?? "#222222", node.strokeOpacity ?? 1)}
        strokeWidth={node.strokeWidth ?? 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
