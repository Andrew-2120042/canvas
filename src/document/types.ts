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

export type NodeType = "frame" | "rect" | "text" | "image";

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

  /** Presentation. CSS-shaped on purpose — see the real-DOM bet in claude.md. */
  fill: string;
  opacity: number;
  radius: number;

  /** Optional style groups. Absent means the section is empty in the panel;
   *  present means it renders. Each maps to real CSS in style.ts. */
  outline?: OutlineStyle;
  border?: BorderStyle;
  shadows?: ShadowStyle[];
  innerShadows?: ShadowStyle[];
  filters?: FilterStyle[];

  /** Frames only. */
  guides?: GuideStyle;
  clipContent?: boolean;

  /** Text nodes only. */
  text?: string;
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
  preWrap?: boolean;
  underline?: UnderlineStyle;
  textStroke?: TextStrokeStyle;
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
    fill: type === "frame" ? "#FFFFFF" : type === "text" ? "#222222" : "#D9D9D9",
    opacity: 1,
    radius: 0,
    ...(type === "text"
      ? {
          text: "Text",
          fontSize: 16,
          lineHeight: 21,
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
  }
}
