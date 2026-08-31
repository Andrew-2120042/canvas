import type { CSSProperties } from "react";
import type { FlexLayout, Gradient, SceneNode } from "./types";

/** Style groups on a node. All plain JSON — see the model note in types.ts. */

export interface Paint {
  color: string;
  opacity: number;
  visible: boolean;
}

export interface OutlineStyle extends Paint {
  width: number;
  offset: number;
}

export type BorderSide = "All" | "Top" | "Right" | "Bottom" | "Left";

export interface BorderStyle extends Paint {
  width: number;
  side: BorderSide;
}

export interface ShadowStyle extends Paint {
  x: number;
  y: number;
  blur: number;
  /** CSS text-shadow has no spread, so text nodes omit it. */
  spread: number;
}

export const FILTER_FNS = [
  "Blur", "Brightness", "Contrast", "Grayscale",
  "Hue rotate", "Invert", "Saturation", "Sepia",
] as const;
export type FilterFn = (typeof FILTER_FNS)[number];

export interface FilterStyle {
  fn: FilterFn;
  amount: number;
  /** false = CSS `filter` (Layer), true = `backdrop-filter` (Backdrop). */
  backdrop: boolean;
  visible: boolean;
}

export interface UnderlineStyle extends Paint {
  width: number;
  /** null renders as `auto`. */
  offset: number | null;
}

export type StrokePosition = "Below fill" | "Above fill";

export interface TextStrokeStyle extends Paint {
  width: number;
  position: StrokePosition;
}

export interface GuideStyle extends Paint {
  kind: "Grid" | "Columns" | "Rows";
  size: number;
}

// --- CSS mapping ----------------------------------------------------------

/** A gradient as the CSS it renders with. */
export function gradientCss(g: Gradient): string {
  const stops = g.stops
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((s) => `${s.color} ${Math.round(s.at * 100)}%`)
    .join(", ");
  return g.kind === "radial"
    ? `radial-gradient(circle, ${stops})`
    : `linear-gradient(${g.angle ?? 180}deg, ${stops})`;
}

/** How a node's parent arranges it, which decides how the node sizes itself. */
export interface ParentLayout {
  /**
   * How this parent places its children.
   *
   * "flow" covers every CSS layout that positions children itself — flex,
   * grid, block. The distinction that matters to a child is only whether
   * something else is deciding where it goes, not which algorithm is doing
   * the deciding.
   */
  mode: "absolute" | "flex" | "flow";
  /** The parent's main axis, when it is a flex container. */
  direction?: FlexLayout["direction"];
}

/** CSS display values that lay their children out, rather than leaving them
 *  to position themselves. */
const FLOW_DISPLAYS = new Set([
  "grid", "inline-grid", "block", "inline-block", "inline-flex", "flow-root",
]);

/** How a node arranges its children, including layouts held as raw CSS. */
export function childLayoutOf(node: SceneNode): ParentLayout {
  if (node.layout === "flex" && node.flex) {
    return { mode: "flex", direction: node.flex.direction };
  }
  if (node.layout === "flow") return { mode: "flow" };
  const display = node.css?.display?.trim();
  if (display && FLOW_DISPLAYS.has(display)) return { mode: "flow" };
  if (display === "flex") return { mode: "flex" };
  return { mode: "absolute" };
}

/**
 * Layout properties as CSS.
 *
 * Nothing is computed here. The canvas is real DOM, so declaring a node a flex
 * container is enough — the browser lays it out. The only work is deciding
 * whether a node positions itself absolutely or flows, which depends on its
 * parent's layout mode.
 */
export function layoutCss(
  node: SceneNode,
  parent: ParentLayout,
): CSSProperties {
  const css: CSSProperties = {};

  // A flex parent lays out its children; anything else places them by x/y.
  const flowing = parent.mode !== "absolute" && (node.placement ?? "flow") === "flow";
  const column = parent.direction?.startsWith("column") ?? false;

  if (flowing) {
    css.position = "relative";
    if (node.grow !== undefined) css.flexGrow = node.grow;
    if (node.shrink === false) css.flexShrink = 0;
    if (node.alignSelf) css.alignSelf = alignValue(node.alignSelf);
  } else {
    css.position = "absolute";
    // The model stores a left/top for every node, but the markup may have
    // been explicit about where this one goes — pinned to the opposite edge,
    // or offset by a percentage the model has no field for. Either way the
    // stored number is a placeholder, and emitting it would win over what was
    // actually asked for. So it stands aside whenever the node's own CSS
    // already positions it on that axis.
    if (node.css?.left === undefined && node.css?.right === undefined) {
      css.left = node.x;
    }
    if (node.css?.top === undefined && node.css?.bottom === undefined) {
      css.top = node.y;
    }
  }

  // "auto" lets content decide; "fill" takes the whole of the parent on that
  // axis. Which CSS says that depends on the axis: along the parent's main
  // axis it is a grow, across it a stretch, and outside flex it is just 100%.
  const w = node.sizeW ?? "fixed";
  const h = node.sizeH ?? "fixed";

  // The node's own CSS wins where it is more specific than the field: a
  // `fit-content` cannot survive being restated as `auto`.
  if (w === "auto") { if (node.css?.width === undefined) css.width = "auto"; }
  else if (w === "fill") {
    if (!flowing) css.width = "100%";
    else if (column) { css.alignSelf = "stretch"; css.width = "auto"; }
    else { css.flexGrow = css.flexGrow ?? 1; css.flexBasis = 0; css.width = "auto"; }
  } else css.width = node.width;

  if (h === "auto") { if (node.css?.height === undefined) css.height = "auto"; }
  else if (h === "fill") {
    if (!flowing) css.height = "100%";
    else if (column) { css.flexGrow = css.flexGrow ?? 1; css.flexBasis = 0; css.height = "auto"; }
    else { css.alignSelf = "stretch"; css.height = "auto"; }
  } else css.height = node.height;

  if (node.layout === "flow" && !node.css?.display) css.display = "block";

  if (node.layout === "flex" && node.flex) {
    css.display = "flex";
    css.flexDirection = node.flex.direction;
    css.gap = node.flex.columnGap !== undefined
      ? `${node.flex.gap}px ${node.flex.columnGap}px`
      : node.flex.gap;
    if (node.flex.wrap) css.flexWrap = node.flex.wrap === "reverse" ? "wrap-reverse" : "wrap";
    if (node.flex.justify) css.justifyContent = justifyValue(node.flex.justify);
    if (node.flex.align) css.alignItems = alignValue(node.flex.align);
  }

  if (node.minWidth !== undefined) css.minWidth = node.minWidth;
  if (node.minHeight !== undefined) css.minHeight = node.minHeight;

  // A number is pixels; a string is already a CSS length.
  const spacing = (v: number | string) => (typeof v === "number" ? `${v}px` : v);
  if (node.padding) {
    const p = node.padding;
    css.padding = `${spacing(p.top)} ${spacing(p.right)} ${spacing(p.bottom)} ${spacing(p.left)}`;
  }
  if (node.margin) {
    const m = node.margin;
    css.margin = `${spacing(m.top)} ${spacing(m.right)} ${spacing(m.bottom)} ${spacing(m.left)}`;
  }

  // A transform written as CSS wins; `rotate` is the panel's own field.
  if (node.transform) css.transform = node.transform;
  else if (node.rotate) css.transform = `rotate(${node.rotate}deg)`;

  if (node.radii) {
    const [a, b, c, d] = node.radii;
    css.borderRadius = `${a}px ${b}px ${c}px ${d}px`;
  } else if (node.radius) {
    css.borderRadius = node.radius;
  }

  return css;
}

/** CSS spells these differently from the model's plainer words. */
function alignValue(v: string): string {
  return v === "start" ? "flex-start" : v === "end" ? "flex-end" : v;
}
function justifyValue(v: string): string {
  return v === "start" ? "flex-start" : v === "end" ? "flex-end" : v;
}

/** Leading used when a node does not set its own. */
export const AUTO_LINE_HEIGHT = 1.3;

/** The line box a text node should render with, in px. */
export function resolvedLineHeight(node: SceneNode): number {
  const size = node.fontSize ?? 16;
  // A line box smaller than the glyphs is never what someone meant; it is a
  // value left behind by an earlier, smaller font size.
  if (node.lineHeight !== undefined && node.lineHeight >= size * 0.8) {
    return node.lineHeight;
  }
  return Math.round(size * AUTO_LINE_HEIGHT);
}

/** #RGB or #RRGGBB plus an alpha, as an rgba() string. */
export function rgba(hex: string, alpha = 1): string {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return alpha >= 1 ? `#${h}` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shadowCss(s: ShadowStyle, inset: boolean, withSpread: boolean): string {
  const parts = [`${s.x}px`, `${s.y}px`, `${s.blur}px`];
  if (withSpread) parts.push(`${s.spread}px`);
  parts.push(rgba(s.color, s.opacity));
  return (inset ? "inset " : "") + parts.join(" ");
}

const FILTER_CSS: Record<FilterFn, (n: number) => string> = {
  Blur: (n) => `blur(${n}px)`,
  Brightness: (n) => `brightness(${n}%)`,
  Contrast: (n) => `contrast(${n}%)`,
  Grayscale: (n) => `grayscale(${n}%)`,
  "Hue rotate": (n) => `hue-rotate(${n}deg)`,
  Invert: (n) => `invert(${n}%)`,
  Saturation: (n) => `saturate(${n}%)`,
  Sepia: (n) => `sepia(${n}%)`,
};

/**
 * Node styles as real CSS. Everything here is a direct CSS property rather
 * than a private effect model — the whole point of the real-DOM bet is that
 * what the panel edits is what the browser renders.
 */
/** `background-color` -> `backgroundColor`, as the DOM expects. */
function camel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function nodeCss(node: SceneNode): CSSProperties {
  const isText = node.type === "text";
  const css: CSSProperties = {};

  // Passthrough first, so a first-class field still wins where both exist —
  // the panel must stay the authority over what it edits.
  if (node.css) {
    for (const [prop, value] of Object.entries(node.css)) {
      (css as Record<string, string>)[camel(prop)] = value;
    }
  }

  if (node.outline?.visible) {
    css.outline = `${node.outline.width}px solid ${rgba(node.outline.color, node.outline.opacity)}`;
    css.outlineOffset = node.outline.offset;
  }

  if (node.border?.visible) {
    const decl = `${node.border.width}px solid ${rgba(node.border.color, node.border.opacity)}`;
    if (node.border.side === "All") css.border = decl;
    else css[`border${node.border.side}` as "borderTop"] = decl;
  }

  // text-shadow has no spread and no inset; box-shadow has both.
  const drop = (node.shadows ?? []).filter((s) => s.visible);
  const inner = (node.innerShadows ?? []).filter((s) => s.visible);
  if (isText) {
    if (drop.length) {
      css.textShadow = drop.map((s) => shadowCss(s, false, false)).join(", ");
    }
  } else if (drop.length || inner.length) {
    css.boxShadow = [
      ...drop.map((s) => shadowCss(s, false, true)),
      ...inner.map((s) => shadowCss(s, true, true)),
    ].join(", ");
  }

  const fs = (node.filters ?? []).filter((f) => f.visible);
  const layer = fs.filter((f) => !f.backdrop);
  const backdrop = fs.filter((f) => f.backdrop);
  if (layer.length) css.filter = layer.map((f) => FILTER_CSS[f.fn](f.amount)).join(" ");
  if (backdrop.length) {
    css.backdropFilter = backdrop.map((f) => FILTER_CSS[f.fn](f.amount)).join(" ");
  }

  if (isText) {
    if (node.fontFamily) css.fontFamily = node.fontFamily;
    if (node.fontWeight) css.fontWeight = node.fontWeight;
    if (node.fontSize) css.fontSize = node.fontSize;
    css.lineHeight = `${resolvedLineHeight(node)}px`;
    if (node.letterSpacing) css.letterSpacing = `${node.letterSpacing}em`;
    if (node.textAlign) css.textAlign = node.textAlign;
    css.whiteSpace = node.whiteSpace
      ?? (node.preWrap === false ? "normal" : "pre-wrap");

    if (node.underline?.visible) {
      css.textDecorationLine = "underline";
      css.textDecorationThickness = node.underline.width;
      css.textUnderlineOffset =
        node.underline.offset === null ? "auto" : node.underline.offset;
      css.textDecorationColor = rgba(node.underline.color, node.underline.opacity);
    }
    if (node.textStroke?.visible) {
      css.WebkitTextStrokeWidth = node.textStroke.width;
      css.WebkitTextStrokeColor = rgba(node.textStroke.color, node.textStroke.opacity);
      // "Below fill" is the default paint order; "Above fill" overdraws it.
      css.paintOrder = node.textStroke.position === "Below fill" ? "stroke fill" : "fill stroke";
    }
  }

  return css;
}

/** Every colour used in a subtree, with usage counts, most-used first. */
/**
 * Everything a node renders with, in one place.
 *
 * There used to be two halves to this: `nodeCss` and `layoutCss` returned
 * most of it, and the canvas component added fill, text colour, opacity and
 * clipping itself, inline. That was invisible until something other than the
 * canvas needed to know how a node looks — the code exporter read the two
 * functions, got no colours at all, and produced a black-on-black card that
 * looked nothing like the design.
 *
 * A second reader is the whole point of the product: the design has to leave
 * as code. So composition happens here, once, and the canvas and the exporter
 * are both callers. Whatever the canvas paints is what the export says,
 * because it is the same object.
 *
 * `imageSrc` exists because the two readers want different spellings of the
 * same picture — the webview needs an asset URL it is allowed to load, and
 * exported code needs the path the user actually wrote. That is the only
 * thing they are permitted to disagree about.
 */
export function renderStyle(
  node: SceneNode,
  parent: ParentLayout,
  imageSrc: (src: string) => string | undefined = (s) => s,
): CSSProperties {
  const isText = node.type === "text";
  const isPath = node.type === "path";
  const isSvg = node.type === "svg";

  const style: CSSProperties = {
    ...nodeCss(node),
    ...layoutCss(node, parent),
    // Text sizes to its content unless it was given a fixed box.
    ...(isText && (node.sizeH ?? "fixed") === "fixed"
      ? { height: undefined, minHeight: node.height }
      : {}),
    // A picture wins over a flat fill, on any node type — a frame with a
    // photograph behind its children is the ordinary way a hero is built.
    background:
      isText || isPath || isSvg
        ? "transparent"
        : node.src
          ? `url("${imageSrc(node.src)}") ${node.backgroundPosition ?? "center"}/` +
            `${node.backgroundFit ?? "cover"} no-repeat`
          : node.gradient
            ? gradientCss(node.gradient)
            : rgba(node.fill, 1),
    opacity: node.opacity,
  };

  // A property whose value is undefined must not be *present*.
  //
  // React does not skip an undefined style value — it clears the property,
  // and clearing a shorthand clears its longhands with it. So writing
  // `overflow: undefined` after the node's own CSS had set overflow-x and
  // overflow-y wiped both of them, and a box that had asked to clip stopped
  // clipping. That is how a collapsed accordion panel — zero height, overflow
  // hidden, the standard 0fr trick — spilled its whole contents down the page
  // over the section beneath it.
  //
  // The same shape was one line above: `color: undefined` on any non-text
  // node would have cleared a colour the node was passing through.
  //
  // Verified by exporting the node and rendering it in a browser, which
  // clipped correctly — the CSS was right and the renderer was overwriting it.
  if (isText && node.fill !== undefined) style.color = node.fill;
  if (node.clipContent) style.overflow = "hidden";

  return style;
}

export function selectionColours(
  nodes: Record<string, SceneNode>,
  rootIds: string[],
): Array<{ color: string; opacity: number; count: number }> {
  const tally = new Map<string, { color: string; opacity: number; count: number }>();
  const add = (color: string, opacity: number) => {
    const key = `${color.toUpperCase()}|${opacity}`;
    const hit = tally.get(key);
    if (hit) hit.count += 1;
    else tally.set(key, { color, opacity, count: 1 });
  };
  const walk = (id: string) => {
    const n = nodes[id];
    if (!n) return;
    add(n.fill, n.opacity);
    (n.shadows ?? []).forEach((s) => add(s.color, s.opacity));
    n.children.forEach(walk);
  };
  rootIds.forEach(walk);
  return [...tally.values()].sort((a, b) => b.count - a.count);
}
