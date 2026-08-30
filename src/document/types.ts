/**
 * Document model.
 *
 * Deliberately plain JSON: no classes, no Map/Set, no cyclic references.
 * Three later phases depend on that shape —
 *   1.9  persistence is JSON.stringify of `Doc`
 *   1.10 undo/redo diffs plain objects
 *   P4   Yjs maps `nodes` to a Y.Map and each `children` to a Y.Array
 *
 * Nodes are held in one flat map rather than a nested tree so that reparenting
 * is a field edit instead of a subtree splice, which is what makes concurrent
 * edits merge sanely later.
 */

import type {
  BorderStyle, FilterStyle, GuideStyle, OutlineStyle, ShadowStyle,
  TextStrokeStyle, UnderlineStyle,
} from "./style";

export type NodeId = string;
export type PageId = string;

export type NodeType = "frame" | "rect" | "text" | "image" | "path" | "svg";

/**
 * How a node arranges its children.
 *
 * "absolute" places them at their own x/y — the original behaviour, and what
 * a hand-drawn canvas wants. "flex" hands the job to CSS flexbox.
 *
 * Nothing here implements layout. The canvas is real DOM, so the browser
 * already lays out flex containers; the renderer's job is to stop overriding
 * it with position:absolute, not to compute anything.
 */
/**
 * How a node arranges its children.
 *
 * "absolute" is the design-tool default: children sit where their x/y say,
 * which is what a frame drawn by hand should do. "flow" is CSS block layout —
 * children stack and size themselves — and is what an element parsed from
 * HTML does unless it says otherwise. "flex" is flexbox.
 */
export type LayoutMode = "absolute" | "flex" | "flow";

/** How a node is placed inside its parent. */
export type Placement = "flow" | "absolute";

/** How a node's box is sized on one axis. */
export type SizeMode = "fixed" | "auto" | "fill";

export interface FlexLayout {
  direction: "row" | "column" | "row-reverse" | "column-reverse";
  gap: number;
  /** CSS `gap` takes two values: row first, then column. `gap` above is the
   *  single-value case; this carries the second when one was given. */
  columnGap?: number;
  wrap?: boolean | "reverse";
  /** Along the main axis. */
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  /** Across the main axis. */
  align?: "start" | "center" | "end" | "stretch" | "baseline";
}

/**
 * Space inside or outside a box.
 *
 * A side is a number of pixels, or a CSS length the model cannot reduce to
 * one — `5%` resolves against the parent's width, which is not knowable when
 * the markup is parsed. The canvas is real CSS, so such a value is passed
 * through and the browser resolves it exactly as it would on a page.
 */
export type SpacingValue = number | string;

export interface Padding {
  top: SpacingValue;
  right: SpacingValue;
  bottom: SpacingValue;
  left: SpacingValue;
}

export type GradientKind = "linear" | "radial";

export interface GradientStop {
  color: string;
  /** 0 to 1 along the gradient. */
  at: number;
}

export interface Gradient {
  kind: GradientKind;
  /** Degrees, for a linear gradient. 180 points down the page. */
  angle?: number;
  stops: GradientStop[];
}

/** Corner radii, clockwise from the top left. */
export type CornerRadii = [number, number, number, number];

/**
 * One anchor on a vector path. Coordinates are relative to the node origin.
 * `in`/`out` are control-handle offsets *from the anchor*, so moving an
 * anchor carries its handles without touching them.
 * A handle of null makes that side a corner.
 */
export interface PathPoint {
  x: number;
  y: number;
  inX: number | null;
  inY: number | null;
  outX: number | null;
  outY: number | null;
}

export interface SceneNode {
  id: NodeId;
  type: NodeType;
  name: string;

  /** Parent node, or null when the node sits directly on a page. */
  parent: NodeId | null;
  /** Child ids in paint order: last entry paints on top. */
  children: NodeId[];

  /** Geometry in world units, relative to the parent's origin. */
  x: number;
  y: number;
  width: number;
  height: number;

  visible: boolean;
  locked: boolean;

  // --- layout ------------------------------------------------------------
  // Absent means the original behaviour: children at their own x/y, this node
  // placed at its own x/y, box sized by width/height.

  /** How this node arranges its children. */
  layout?: LayoutMode;
  /** Flex settings, when `layout` is "flex". */
  flex?: FlexLayout;
  /** Space inside this node's box. */
  padding?: Padding;
  /** Space outside the box. Real CSS margin — the browser collapses and
   *  resolves it. Agents reach for it constantly, and refusing it only moved
   *  the work to them without making the layout any more predictable. */
  margin?: Padding;

  /** How this node sits in its parent. Defaults to "flow" inside a flex
   *  parent and "absolute" otherwise. */
  placement?: Placement;
  /** Share of leftover space along the parent's main axis. */
  grow?: number;
  /** Whether this node may shrink below its size. Defaults to true. */
  shrink?: boolean;
  /** Overrides the parent's cross-axis alignment for this node alone. */
  alignSelf?: FlexLayout["align"];

  /** How the box is sized on each axis. Defaults to "fixed". */
  sizeW?: SizeMode;
  sizeH?: SizeMode;

  /** Presentation. CSS-shaped on purpose — see the real-DOM bet in claude.md. */
  fill: string;
  /** A gradient fill, which takes precedence over `fill` when present. */
  gradient?: Gradient;
  opacity: number;
  radius: number;
  /** Per-corner radii, which take precedence over `radius` when present. */
  radii?: CornerRadii;
  /** Rotation in degrees. */
  rotate?: number;

  /** Optional style groups. Absent means the section is empty in the panel;
   *  present means it renders. Each maps to real CSS in style.ts. */
  outline?: OutlineStyle;
  border?: BorderStyle;
  shadows?: ShadowStyle[];
  innerShadows?: ShadowStyle[];
  filters?: FilterStyle[];

  /** Path nodes: anchors in node-local space. */
  points?: PathPoint[];
  closed?: boolean;
  strokeWidth?: number;
  strokeColor?: string;
  strokeOpacity?: number;

  /** SVG nodes: the markup, rendered as-is.
   *
   *  Kept as markup rather than decomposed into path nodes: SVG is already a
   *  vector format, and re-modelling it would lose exactly the parts (masks,
   *  gradients, groups) that make icons look right. Pen-drawn paths stay
   *  `path` nodes, which are editable. */
  svg?: string;

  /**
   * A picture painted into this node — an absolute path on disk, an http URL,
   * or a data URL.
   *
   * Not only for image nodes. A frame carrying a photograph behind its own
   * children is how essentially every hero section is built, and CSS says
   * that with `background: url(...)` on the container rather than a separate
   * element, so any node can hold one.
   */
  src?: string;
  /** How the picture fills the box, mirroring `background-size`. */
  backgroundFit?: "cover" | "contain";
  /** Where it sits, mirroring `background-position`. Defaults to centre. */
  backgroundPosition?: string;
  naturalWidth?: number;
  naturalHeight?: number;

  /**
   * CSS this model has no first-class field for, kept verbatim.
   *
   * The product bet is that the canvas is real DOM and real CSS. An
   * enumerated schema quietly broke that bet: any property the enum did not
   * name was dropped, so ordinary CSS an agent had every reason to expect —
   * `display: grid`, `margin`, `padding: 0 5%`, `background: url(...)` —
   * silently did nothing, and the only remedy was to keep adding fields one
   * at a time forever.
   *
   * Everything the panel edits stays a real field, because the panel needs to
   * read and write it. Everything else lands here and is handed to the
   * browser, which is the only correct authority on what CSS means.
   */
  css?: Record<string, string>;

  /** Frames only. */
  guides?: GuideStyle;
  clipContent?: boolean;

  /** Text nodes only. */
  text?: string;
  /**
   * The same words, with their formatting, when the run is not uniform.
   *
   * A heading like `<i>JOIN</i> THE THRILL` is one text layer in any design
   * tool — not three — but it is not one *style*. The model held a single
   * style per text node, so collapsing the run to plain text threw the italic
   * and its weight away and the heading came out flat. Splitting it into
   * separate nodes would have kept the look and wrecked the layer tree.
   *
   * So the runs are kept as the inline markup they already are. The canvas is
   * real DOM; this renders verbatim, the same way an icon's SVG does. `text`
   * stays the plain-text form — what the layer is named from, what tools read
   * and write, and what editing falls back to.
   */
  richText?: string;
  /** The node's CSS transform, verbatim. Kept as a string rather than picked
   *  apart into fields: the canvas is real CSS, so anything the browser can
   *  express here should survive. `rotate` stays alongside it because the
   *  properties panel edits that one directly. */
  transform?: string;
  fontFamily?: string;
  /** Floor on the layout size. `minWidth: 0` is the flex idiom that lets a
   *  growing column shrink below its content instead of shoving its siblings
   *  out of the row, so it has to be expressible. */
  minWidth?: number;
  minHeight?: number;
  fontWeight?: number;
  fontSize?: number;
  /** Absolute px. Left unset for automatic leading, which tracks fontSize —
   *  a fixed value frozen at creation stops matching the moment the font size
   *  changes, and the glyphs then spill out of the node's own bounds. */
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
  /** Legacy two-state wrapping flag, kept so documents saved before
   *  `whiteSpace` existed still load. New writes set `whiteSpace`. */
  preWrap?: boolean;
  /** How the node wraps. `nowrap` is the one the boolean could not express,
   *  and it is the common case: a button label or a chip that must stay on
   *  one line rather than breaking and overflowing its box. */
  whiteSpace?: "normal" | "pre" | "pre-wrap" | "nowrap";
  underline?: UnderlineStyle;
  textStroke?: TextStrokeStyle;
}

/** A pinned comment thread. Anchored in world space so it tracks the canvas
 *  through pan and zoom. Single-player for now; authorship and resolution
 *  across people arrive with multiplayer in Phase 4. */
export interface Comment {
  id: string;
  pageId: PageId;
  x: number;
  y: number;
  body: string;
  createdAt: number;
  resolved: boolean;
}

export interface Page {
  id: PageId;
  name: string;
  /** Top-level node ids on this page, in paint order. */
  children: NodeId[];
  background: string;
}

export interface Doc {
  nodes: Record<NodeId, SceneNode>;
  pages: Record<PageId, Page>;
  pageOrder: PageId[];
  comments: Comment[];
}

let counter = 0;
/** Ids only need to be unique within a document; Phase 4 swaps this for a
 *  client-prefixed id so two peers cannot collide. */
export function newId(prefix = "n"): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createNode(
  type: NodeType,
  rect: { x: number; y: number; width: number; height: number },
  overrides: Partial<SceneNode> = {},
): SceneNode {
  return {
    id: newId(type[0]),
    type,
    name: defaultName(type),
    parent: null,
    children: [],
    ...rect,
    visible: true,
    locked: false,
    // For text, `fill` is the glyph colour and the box stays transparent.
    // A freshly drawn path is a stroke, not a filled shape.
    fill: type === "frame" ? "#FFFFFF"
      : type === "text" ? "#222222"
      : type === "path" ? "transparent"
      : "#D9D9D9",
    opacity: 1,
    radius: 0,
    ...(type === "path"
      ? {
          points: [],
          closed: false,
          strokeWidth: 2,
          strokeColor: "#222222",
          strokeOpacity: 1,
        }
      : {}),
    ...(type === "text"
      ? {
          text: "Text",
          fontSize: 16,
          letterSpacing: 0,
          textAlign: "left" as const,
          preWrap: true,
        }
      : {}),
    ...overrides,
  };
}

function defaultName(type: NodeType): string {
  switch (type) {
    case "frame": return "Frame";
    case "rect":  return "Rectangle";
    case "text":  return "Text";
    case "image": return "Image";
    case "path":  return "Path";
    case "svg":   return "SVG";
  }
}
