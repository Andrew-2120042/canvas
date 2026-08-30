import { activeFile, worldRect } from "../document/store";
import { useViewport, MAX_ZOOM, MIN_ZOOM } from "../state/viewport";
import { registerTool } from "./bridge";

/**
 * Pointing the user's view at something.
 *
 * An agent working a canvas is working in someone else's window: it can build
 * a screen the user never scrolls to. Being able to say "look here" is part
 * of the agent being present in the room rather than editing a file.
 */
export function registerViewTools(): void {
  registerTool("focus_node", (args) => {
    const id = String(args.nodeId ?? "");
    const f = activeFile();
    if (!f.doc.nodes[id]) throw new Error(`no node with id "${id}"`);
    const rect = worldRect(f.doc, id);
    if (!rect) throw new Error(`node "${id}" has no geometry to focus`);

    const region = document.querySelector(".canvas-region");
    const box = region?.getBoundingClientRect();
    const vw = box?.width ?? 1200;
    const vh = box?.height ?? 800;

    // Fit the node with a margin, unless an explicit zoom was asked for.
    const margin = 1.15;
    const fitted = Math.min(vw / (rect.width * margin), vh / (rect.height * margin));
    const asked = args.zoom !== undefined ? Number(args.zoom) : fitted;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, asked));

    // Centre the node: screen = world * zoom + pan.
    const x = vw / 2 - (rect.x + rect.width / 2) * zoom;
    const y = vh / 2 - (rect.y + rect.height / 2) * zoom;
    useViewport.setState({ x, y, zoom });

    return {
      focused: id,
      zoom: Number(zoom.toFixed(3)),
      rect: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
      },
    };
  });
}
