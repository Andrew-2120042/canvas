import type { CSSProperties } from "react";
import type { SceneNode } from "./types";

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
export function nodeCss(node: SceneNode): CSSProperties {
  const isText = node.type === "text";
  const css: CSSProperties = {};

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
    css.whiteSpace = node.preWrap === false ? "normal" : "pre-wrap";

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
