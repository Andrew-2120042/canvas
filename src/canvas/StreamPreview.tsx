import { useActive, worldRect } from "../document/store";
import { useStreamPreview } from "../state/streamPreview";

/**
 * The live preview, drawn over the frame being written into.
 *
 * Rendered as markup rather than as nodes, and that is the point: healed
 * fragments never enter the document, so a half-written design cannot land in
 * the layer tree, be selected, or be undone. When the call completes the real
 * parse replaces this, and the two look alike because the canvas is real DOM
 * and real CSS — the preview is the same markup the parser is about to read.
 *
 * Positioned inside the content layer so it scales with zoom and sits exactly
 * on its frame, and marked inert so nothing here can be clicked, measured, or
 * mistaken for the design.
 */
export function StreamPreview() {
  const doc = useActive((f) => f.doc);
  const targetId = useStreamPreview((s) => s.targetId);
  const html = useStreamPreview((s) => s.html);

  if (!targetId || !html) return null;
  const node = doc.nodes[targetId];
  if (!node) return null;
  const rect = worldRect(doc, targetId);
  if (!rect) return null;

  return (
    <div
      className="stream-preview"
      aria-hidden="true"
      style={{ left: rect.x, top: rect.y, width: rect.width }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
