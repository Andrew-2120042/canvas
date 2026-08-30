import { useLayoutEffect, useState } from "react";
import { useActive } from "../document/store";
import { measureAll, type Box } from "./../document/geometry";
import { useActivity } from "../state/activity";
import { useViewport } from "../state/viewport";

/**
 * The structure of a group, drawn before its paint arrives.
 *
 * A write_html call inserts a subtree that is already at its final geometry
 * the moment it mounts — the browser laid it out, and nothing about it will
 * move. So there is a real, honest thing to show while the paint fades up:
 * the boxes themselves. That reads as a design being planned and then
 * rendered, rather than as content appearing out of order.
 *
 * These are drawn here, in an overlay, rather than as a border on each node,
 * for one reason: the group fades in under a single opacity, and anything
 * inside that subtree fades with it. Outlines that faded with the content
 * would be at a tenth of their opacity exactly when they are the only thing
 * meant to be visible. Out here they stay crisp while the paint comes up
 * underneath them, which is the whole effect.
 *
 * Screen space, like the selection overlay: a hairline stays a hairline at
 * every zoom rather than growing into a slab.
 */

interface OutlineBox extends Box {
  id: string;
}

export function ArrivalOutlines() {
  const doc = useActive((f) => f.doc);
  const arrivals = useActivity((a) => a.arrivals);
  const { x, y, zoom } = useViewport();
  const [boxes, setBoxes] = useState<OutlineBox[]>([]);

  // Sorted so the key is stable across renders that did not change the set.
  const rootKey = Object.keys(arrivals).sort().join(",");

  /**
   * Measured after the commit, not during it.
   *
   * The subtree has only just been inserted, so during render the DOM still
   * holds the layout from before it existed. One pass over the whole layer
   * afterwards keeps every box consistent with every other, because they all
   * come out of the same layout.
   */
  useLayoutEffect(() => {
    const roots = rootKey ? rootKey.split(",") : [];
    if (roots.length === 0) {
      setBoxes((prev) => (prev.length ? [] : prev));
      return;
    }

    // Decoration must never be able to take the canvas down with it. This
    // draws over the document while the document is mid-write, which is the
    // least stable moment there is — a node can be referenced a frame before
    // it exists, and a cycle in a malformed tree would recurse forever. If
    // any of that goes wrong the right outcome is no outlines, not a blank
    // canvas.
    try {
      const measured = measureAll();
      const out: OutlineBox[] = [];
      const seen = new Set<string>();
      const walk = (id: string): void => {
        if (seen.has(id)) return;
        seen.add(id);
        const node = doc.nodes[id];
        if (!node || !node.visible) return;
        const box = measured.get(id);
        if (box) out.push({ id, ...box });
        for (const child of node.children) walk(child);
      };
      for (const root of roots) walk(root);
      setBoxes(out);
    } catch {
      setBoxes((prev) => (prev.length ? [] : prev));
    }
  }, [doc, rootKey]);

  if (boxes.length === 0) return null;

  return (
    <div className="arrival-overlay">
      {boxes.map((b) => (
        <div
          key={b.id}
          className="arrival-box"
          style={{
            left: b.x * zoom + x,
            top: b.y * zoom + y,
            width: b.width * zoom,
            height: b.height * zoom,
          }}
        />
      ))}
    </div>
  );
}
