import { childLayoutOf } from "./style";
import type { Doc, NodeId, SceneNode } from "./types";

/**
 * Where nodes actually are.
 *
 * For most of the document a node's position is what the model says: x and y
 * relative to its parent, summed up the chain. That stops being true the
 * moment a parent lays its children out. A flex container decides where its
 * children go, and their stored x/y — whatever happens to be sitting in the
 * model — mean nothing. Summing them puts the node at its parent's origin,
 * which is why a selected icon drew its handles in empty space.
 *
 * The resolution is the product's own bet rather than a workaround: the
 * canvas *is* real DOM, so when the browser owns the layout the browser is
 * the authority on the result. Ask it.
 *
 * Everything here reads the layout box — offsetLeft and friends — rather than
 * getBoundingClientRect. The two disagree whenever a transform is in play,
 * and two are: the viewport's zoom, which would otherwise have to be divided
 * back out of every number, and the brief scale a node animates through as it
 * arrives. A rect read from the visual box mid-animation is wrong, and wrong
 * in a way that only appears right after an agent build. Layout offsets ignore
 * both, and are already in the canvas's own units.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The layer every node is positioned within. */
function canvasLayer(): HTMLElement | null {
  return document.querySelector(".canvas-content");
}

/** The element a node renders as, if it is on screen right now. */
function elementFor(id: NodeId, layer: HTMLElement): HTMLElement | null {
  return layer.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
}

/**
 * An element's box in the canvas's own coordinates.
 *
 * Every scene node is positioned, so each one is its child's offsetParent and
 * the walk climbs the node tree exactly. If it never reaches the canvas layer
 * the element is not part of the scene, and there is no answer to give.
 */
function layoutBox(el: HTMLElement, layer: HTMLElement): Box | null {
  let x = 0;
  let y = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== layer) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  if (cur !== layer) return null;
  return { x, y, width: el.offsetWidth, height: el.offsetHeight };
}

/**
 * True when this node's own x/y do not decide where it sits.
 *
 * A node flows when its parent is a flex container and it has not been given
 * an absolute placement. An absolutely-placed node inside a flowing ancestor
 * is still measured, because the origin it is placed against has itself moved.
 */
export function isLaidOut(doc: Doc, id: NodeId): boolean {
  let cur: NodeId | null = id;
  while (cur) {
    const node: SceneNode | undefined = doc.nodes[cur];
    if (!node) return false;
    const parent = node.parent ? doc.nodes[node.parent] : null;
    // Any parent that lays its children out — flex, grid, block — decides
    // where this node sits, so its stored x/y are not the answer.
    if (
      parent &&
      childLayoutOf(parent).mode !== "absolute" &&
      (node.placement ?? "flow") === "flow"
    ) {
      return true;
    }
    cur = node.parent;
  }
  return false;
}

/** A node's world rect as rendered, or null when it is not on screen. */
export function measureWorld(id: NodeId): Box | null {
  const layer = canvasLayer();
  if (!layer) return null;
  const el = elementFor(id, layer);
  return el ? layoutBox(el, layer) : null;
}

/**
 * Every rendered node's world rect, in one pass.
 *
 * A marquee tests against the whole page. Collecting the nodes once and
 * walking each one's offsets keeps every rect consistent with the others,
 * because they all come out of the same layout.
 */
export function measureAll(): Map<NodeId, Box> {
  const out = new Map<NodeId, Box>();
  const layer = canvasLayer();
  if (!layer) return out;
  for (const el of Array.from(layer.querySelectorAll<HTMLElement>("[data-node-id]"))) {
    const id = el.dataset.nodeId;
    if (!id) continue;
    const box = layoutBox(el, layer);
    if (box) out.set(id, box);
  }
  return out;
}

/**
 * A node's position and size as the panel should show them.
 *
 * The panel speaks in parent-relative coordinates, which is what an offset
 * already is: a node's offsetParent is its parent node. When nothing has laid
 * the node out this is exactly what the model already holds.
 */
export function localRect(doc: Doc, id: NodeId): Box | null {
  const node = doc.nodes[id];
  if (!node) return null;

  const fallback: Box = { x: node.x, y: node.y, width: node.width, height: node.height };
  const layer = canvasLayer();
  const el = layer ? elementFor(id, layer) : null;

  if (!isLaidOut(doc, id)) {
    // Even a node the model positions can be sized by its content.
    if ((node.sizeW ?? "fixed") === "fixed" && (node.sizeH ?? "fixed") === "fixed") {
      return fallback;
    }
    return el
      ? { ...fallback, width: el.offsetWidth, height: el.offsetHeight }
      : fallback;
  }

  return el
    ? { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
    : fallback;
}
