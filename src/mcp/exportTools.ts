import type { CSSProperties } from "react";
import { activeFile } from "../document/store";
import {
  childLayoutOf,
  renderStyle,
  type ParentLayout,
} from "../document/style";
import type { Doc, NodeId, SceneNode } from "../document/types";
import { registerTool } from "./bridge";

/**
 * Getting a design back out as code.
 *
 * This is where the product's central bet pays off. A tool that stores a
 * proprietary shape has to *translate* on the way out, and every translation
 * is a guess: the exporter re-derives what the renderer meant and the two
 * drift. Here the document already holds real CSS, and the canvas renders it
 * through `nodeCss` and `layoutCss`. So this walks the same two functions the
 * canvas paints with and prints what they return.
 *
 * That is the whole design. The output is not "our best reconstruction of the
 * design" — it is the styles that produced the pixels the user is looking at,
 * which is the only version of this that can be trusted enough to paste into
 * a codebase without checking it against a screenshot.
 */

/** A CSS property name as it is written in a stylesheet. */
function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Numbers that are lengths, so React's own px rule is reproduced exactly. */
const UNITLESS = new Set([
  "opacity", "zIndex", "flexGrow", "flexShrink", "fontWeight", "lineHeight",
  "order", "flex", "zoom", "aspectRatio",
]);

function cssValue(prop: string, value: unknown): string {
  if (typeof value === "number" && !UNITLESS.has(prop)) return `${value}px`;
  return String(value);
}

/**
 * What the canvas gets from its stylesheet and exported code does not.
 *
 * `renderStyle` returns what a node is styled *with*, but a node is also
 * styled by the rule it sits under. `.scene-node` sets `box-sizing:
 * border-box`, and text additionally gets `margin: 0` and `word-break`. On
 * the canvas those are ambient. Pasted into a codebase there is no such rule,
 * so the browser's own defaults apply instead — and they are not neutral:
 * content-box makes a 280px card with 20px padding render 320px wide, and a
 * <p> picks up a 1em margin top and bottom that nothing in the design asked
 * for. The first export of this card rendered a third taller than the design
 * for exactly that reason, with the badge pushed off the bottom.
 *
 * These are the values the canvas computes, written down rather than
 * inherited. Nothing here is invented: it is the same style, made portable.
 */
function ambient(node: SceneNode): CSSProperties {
  const base: CSSProperties = { boxSizing: "border-box" };
  if (node.type === "text") {
    return { ...base, margin: 0, wordBreak: "break-word" };
  }
  // Every block-level tag a design uses carries a default margin somewhere;
  // the canvas has none, so say so.
  return { ...base, margin: 0 };
}

/**
 * Declarations the canvas needs and exported code does not.
 *
 * The canvas writes some properties explicitly because it is overriding its
 * own reset — a node has to say `background: transparent` to beat the rule
 * that would otherwise paint it. Pasted into a codebase there is no such
 * rule, so those are the browser's defaults written out longhand, and they
 * bury the handful of declarations that actually describe the design.
 *
 * Only values identical to the CSS initial value are dropped, so nothing here
 * can change what renders. Properties that merely *look* redundant are kept:
 * `position: relative` is what an absolutely-placed descendant resolves
 * against, and `white-space` is what makes a text node's real newlines
 * survive.
 */
const CSS_DEFAULT: Record<string, string> = {
  background: "transparent",
  opacity: "1",
  width: "auto",
  height: "auto",
};

function isDefault(prop: string, value: string): boolean {
  return CSS_DEFAULT[prop] === value;
}

/** Only the entries that carry a value, in a stable order. */
function entries(style: CSSProperties): Array<[string, string]> {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, cssValue(k, v)] as [string, string])
    .filter(([k, v]) => !isDefault(k, v))
    .sort(([a], [b]) => a.localeCompare(b));
}

/** A JS object literal for a JSX `style` prop. */
function styleLiteral(style: CSSProperties): string {
  const parts = entries(style).map(([k, v]) => {
    const key = /^[a-zA-Z][a-zA-Z0-9]*$/.test(k) ? k : JSON.stringify(k);
    return `${key}: ${JSON.stringify(v)}`;
  });
  return parts.length ? `{{ ${parts.join(", ")} }}` : "";
}

/** An inline style attribute for plain HTML. */
function styleAttr(style: CSSProperties): string {
  const parts = entries(style).map(([k, v]) => `${kebab(k)}: ${v}`);
  return parts.length ? parts.join("; ") : "";
}

/**
 * SVG markup as JSX.
 *
 * The document stores an icon as the markup that was written, which is HTML.
 * JSX is not HTML: hyphenated attributes are invalid, so `stroke-width`
 * pasted into a component is a syntax error rather than a thin line. Only
 * attribute names are touched — path data and every value is left exactly as
 * it is, because rewriting those is how an exporter silently redraws an icon.
 */
function svgToJsx(markup: string): string {
  return markup.replace(
    /\s([a-zA-Z]+(?:-[a-zA-Z]+)+)=/g,
    (_m, name: string) =>
      ` ${name.replace(/-([a-z])/g, (_x, c: string) => c.toUpperCase())}=`,
  );
}

/** Text that is about to sit between two JSX tags. */
function escapeText(text: string, jsx: boolean): string {
  const base = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // In JSX a bare brace opens an expression.
  return jsx ? base.replace(/[{}]/g, (c) => `{"${c}"}`) : base;
}

/** A readable component name taken from the node's layer name. */
function componentName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ]/g, " ").trim();
  const camel = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  return /^[A-Za-z]/.test(camel) ? camel : `Component${camel}`;
}

interface EmitOptions {
  jsx: boolean;
  indent: string;
}

/** The tag a node becomes, chosen for what the markup will mean. */
function tagFor(node: SceneNode): string {
  if (node.type === "text") return "p";
  if (node.type === "image") return "img";
  return "div";
}

function emit(
  doc: Doc,
  id: NodeId,
  parent: ParentLayout,
  depth: number,
  opts: EmitOptions,
  lines: string[],
): void {
  const node = doc.nodes[id];
  if (!node || !node.visible) return;

  const pad = opts.indent.repeat(depth);
  // The same object the canvas paints with — including fill, text colour
  // and clipping, which live in the composition rather than in nodeCss. An
  // export that read only part of it came out with no colours at all.
  const style = renderStyle(node, parent);
  // An <img> already names its picture in `src`. The node also carries it as
  // a background because that is how the canvas paints every node, but
  // emitting both writes the same file into the markup twice.
  if (node.type === "image") delete (style as Record<string, unknown>).background;
  // Ambient first, so anything the node states for itself wins.
  const portable: CSSProperties = { ...ambient(node), ...style };

  // An icon is already markup. It carries its own geometry and its own
  // styling, so wrapping it in a styled div would apply the node's box twice.
  if (node.type === "svg" && node.svg) {
    const markup = opts.jsx ? svgToJsx(node.svg) : node.svg;
    lines.push(...markup.split("\n").map((l) => pad + l));
    return;
  }

  const attrs: string[] = [];
  if (opts.jsx) {
    const literal = styleLiteral(portable);
    if (literal) attrs.push(`style=${literal}`);
  } else {
    const attr = styleAttr(portable);
    if (attr) attrs.push(`style="${attr.replace(/"/g, "&quot;")}"`);
  }

  if (node.type === "image" && node.src) {
    // A path on disk is not a URL a build can resolve. Saying so in the
    // output beats emitting a broken src that looks fine until it 404s.
    const local = !/^(https?:|data:)/i.test(node.src);
    attrs.push(`src=${opts.jsx ? `{${JSON.stringify(node.src)}}` : `"${node.src}"`}`);
    attrs.push(opts.jsx ? `alt=""` : `alt=""`);
    if (local) lines.push(`${pad}{/* local file — import or move it into your assets */}`);
  }

  const open = `<${tagFor(node)}${attrs.length ? " " + attrs.join(" ") : ""}`;

  if (node.type === "image") {
    lines.push(`${pad}${open} />`);
    return;
  }

  if (node.type === "text") {
    const text = escapeText(node.text ?? "", opts.jsx);
    // Newlines in a text node are real line breaks, not whitespace to
    // collapse. The node renders them because it carries a white-space rule;
    // the markup has to carry it too or the lines run together.
    lines.push(`${pad}${open}>${text.replace(/\n/g, opts.jsx ? "<br />" : "<br>")}</p>`);
    return;
  }

  const kids = node.children.filter((c) => doc.nodes[c]?.visible);
  if (kids.length === 0) {
    lines.push(`${pad}${open} />`);
    return;
  }

  lines.push(`${pad}${open}>`);
  const mine = childLayoutOf(node);
  for (const child of kids) emit(doc, child, mine, depth + 1, opts, lines);
  lines.push(`${pad}</${tagFor(node)}>`);
}

export function registerExportTools(): void {
  registerTool("get_jsx", (args) => {
    const format = args.format === "html" ? "html" : "jsx";
    const doc = activeFile().doc;
    const jsx = format === "jsx";

    const f = activeFile();
    const ids: NodeId[] = args.nodeId
      ? [String(args.nodeId)]
      : f.doc.pages[f.currentPageId]?.children ?? [];
    for (const id of ids) {
      if (!doc.nodes[id]) throw new Error(`no node with id "${id}"`);
    }
    if (ids.length === 0) throw new Error("nothing to export; the page is empty");

    const lines: string[] = [];
    const wrap = jsx && args.component !== false;
    const indent = "  ";
    const depth = wrap ? 2 : 0;

    for (const id of ids) {
      const node = doc.nodes[id];
      const parent = node.parent ? doc.nodes[node.parent] : null;
      // A node is exported as it renders, which depends on what its parent
      // does to it. Read from the real parent so a flex child does not come
      // out absolutely positioned at a meaningless x/y.
      emit(
        doc,
        id,
        parent ? childLayoutOf(parent) : { mode: "absolute" },
        depth,
        { jsx, indent },
        lines,
      );
    }

    const name = componentName(doc.nodes[ids[0]]?.name ?? "Design");
    const code = wrap
      ? [
          `export function ${name}() {`,
          `${indent}return (`,
          ...lines,
          `${indent});`,
          `}`,
        ].join("\n")
      : lines.join("\n");

    return {
      format,
      code,
      // Said plainly rather than left for the caller to discover: these are
      // the styles the canvas renders with, not a reconstruction of them.
      note:
        "Geometry, spacing and colour are the values the canvas renders " +
        "with, verified to lay out identically in a browser. Type inherits: " +
        "a text node keeps an explicit font-family but otherwise takes the " +
        "font of wherever you paste it, so glyphs may differ from the " +
        "canvas. Local image paths are emitted as written and need moving " +
        "into your assets.",
    };
  });
}
