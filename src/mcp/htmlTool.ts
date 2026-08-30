import { activeFile, useDoc } from "../document/store";
import { createNode, newId, type NodeId, type SceneNode } from "../document/types";
import { parseHtml, type ParsedNode } from "../document/html/parseHtml";
import { registerTool } from "./bridge";
import { noteAgentWrite } from "./buildScope";

/**
 * Writing a design as HTML.
 *
 * This is the primary authoring path, not a convenience over the per-node
 * tools. An agent writes HTML and CSS far more fluently than it writes a
 * bespoke node schema — it has seen millions of interfaces in one and none in
 * the other — and one call carries a whole component rather than one box.
 *
 * Atomic by construction: a complete fragment is parsed once and inserted
 * once. There is no partial-markup path, so none of the tag-healing that a
 * streaming parser would need exists, and a frame's subtree is spliced once
 * rather than repeatedly as text arrives.
 */

/** A readable layer name taken from a text node's own content. */
function layerNameFor(text: string): string {
  const line = text.split("\n")[0].trim().replace(/\s+/g, " ");
  return line.length > 32 ? `${line.slice(0, 31)}…` : line || "Text";
}

/** Flatten a parsed tree into real nodes, parents before children. */
function build(
  parsed: ParsedNode,
  parent: NodeId | null,
  out: Array<{ node: SceneNode; children: NodeId[] }>,
): NodeId {
  // `<x-clone>` reuses a node that already exists: copy its subtree with fresh
  // ids so the copy shares nothing with the original, then apply whatever the
  // clone element overrode.
  if (parsed.cloneOf) {
    const doc = activeFile().doc;
    const src = doc.nodes[parsed.cloneOf];
    if (!src) throw new Error(`no node with id "${parsed.cloneOf}" to clone`);

    const copy = (id: NodeId, into: NodeId | null): NodeId => {
      const from = doc.nodes[id];
      const cloneId = newId(from.type[0]);
      const kids = from.children.map((c) => copy(c, cloneId));
      out.push({
        node: { ...structuredClone(from), id: cloneId, parent: into, children: kids },
        children: kids,
      });
      return cloneId;
    };
    const rootId = copy(parsed.cloneOf, parent);
    const made = out[out.length - 1];
    made.node = {
      ...made.node,
      ...parsed.props,
      ...(parsed.name ? { name: parsed.name } : {}),
    };
    return rootId;
  }

  const node = createNode(
    parsed.type,
    {
      x: parsed.props.x ?? 0,
      y: parsed.props.y ?? 0,
      width: parsed.props.width ?? 100,
      height: parsed.props.height ?? 100,
    },
    // `name` is spread only when the markup named it: an explicit undefined
    // would overwrite the type's default name with nothing.
    {
      ...parsed.props,
      parent,
      // A layer called "Text" tells the user nothing. Naming it from its own
      // words makes the layer list readable without anyone having to label
      // anything, which is most of what an explicit rename would have done.
      ...(parsed.name
        ? { name: parsed.name }
        : parsed.type === "text" && parsed.props.text
          ? { name: layerNameFor(String(parsed.props.text)) }
          : {}),
    },
  );
  const childIds = parsed.children.map((c) => build(c, node.id, out));
  out.push({ node, children: childIds });
  return node.id;
}

function countTree(trees: Array<{ node: SceneNode }>): number {
  return trees.length;
}

export function registerHtmlTool(): void {
  registerTool("write_html", (args) => {
    const html = String(args.html ?? "");
    if (!html.trim()) throw new Error("html is required");

    const mode =
      args.mode === "replace-children" ? "replace-children" : "insert-children";

    const targetId = args.targetNodeId ? String(args.targetNodeId) : null;
    if (targetId) {
      const target = activeFile().doc.nodes[targetId];
      if (!target) throw new Error(`no node with id "${targetId}"`);
      if (target.type !== "frame") {
        throw new Error("only a frame can contain other nodes");
      }
    }

    // The viewport this markup is being designed for — the artboard, not the
    // frame it happens to be dropped into.
    //
    // Media queries resolve against this. Using the immediate target's width
    // meant writing a header into any frame narrower than a breakpoint
    // silently triggered that page's mobile rules: on a real site whose CSS
    // says `@media (max-width:980px){ .nav{display:none} }`, the entire
    // navigation was set to display:none before it ever became a node. The
    // markup was right, the stylesheet was right, and the nav was gone.
    const pageWidth = (id: NodeId | null): number => {
      const doc = activeFile().doc;
      let cur = id;
      let width = 1440;
      while (cur) {
        const node: SceneNode | undefined = doc.nodes[cur];
        if (!node) break;
        width = node.width;
        if (!node.parent) break;
        cur = node.parent;
      }
      return width || 1440;
    };
    const container = pageWidth(targetId);
    const { nodes: parsed, ignored, conversion } = parseHtml(html, container);
    if (parsed.length === 0) throw new Error("no elements found in the html");

    const flat: Array<{ node: SceneNode; children: NodeId[] }> = [];
    const roots = parsed.map((p) => build(p, targetId, flat));

    // A frame being written into is a container for a document, so it lays
    // its children out the way a page does — stacked, each sizing itself —
    // rather than piling them all at its origin. Only applied when the markup
    // is ordinary flow content; absolutely-placed roots keep the frame as it
    // is, because those are asking to be positioned by hand.
    if (targetId) {
      const target = activeFile().doc.nodes[targetId];
      const flowRoots = parsed.some(
        (p) => p.props.placement !== "absolute" && p.props.layout !== undefined,
      );
      if (target && flowRoots && (target.layout ?? "absolute") === "absolute") {
        useDoc.getState().updateNode(targetId, { layout: "flow" });
      }
    }

    // Every node is "touched"; only the roots enter. A write_html call is one
    // visual group, and it should appear as one.
    noteAgentWrite("create", flat.map((f) => f.node.id), roots);
    useDoc.getState().insertTree(flat, roots, targetId, mode);

    return {
      created: countTree(flat),
      rootIds: roots,
      // Say what could not be represented rather than letting the caller
      // assume the markup arrived intact.
      ignoredCss: ignored,
      // What the conversion did. Reported every time rather than only on
      // failure: an agent that cannot see the stylesheet was resolved at one
      // width has no reason to suspect the other three breakpoints exist.
      conversion,
      nodes: flat.map((f) => ({ id: f.node.id, name: f.node.name, type: f.node.type })),
    };
  });
}
