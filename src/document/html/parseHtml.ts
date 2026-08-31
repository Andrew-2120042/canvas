import type {
  CornerRadii, FlexLayout, Gradient, NodeType, Padding, SceneNode, SizeMode,
  SpacingValue,
} from "../types";
import type { BorderStyle, ShadowStyle } from "../style";
import { inlineStylesheet } from "./resolveCss";

/**
 * HTML and CSS into canvas nodes.
 *
 * The canvas is real DOM, so this is a mapping rather than a layout engine:
 * the properties below are the ones the node model holds, and the browser
 * does the arranging. Anything the model cannot hold is reported back so the
 * caller knows what was dropped instead of quietly getting something else.
 *
 * Deliberately atomic. A complete fragment is parsed once and inserted once;
 * there is no partial-markup path, so none of the tag-healing a streaming
 * parser would need exists here.
 */

export interface ParsedNode {
  type: NodeType;
  name?: string;
  props: Partial<SceneNode>;
  children: ParsedNode[];
  /**
   * Set by `<x-clone node-id="…">`: instead of describing a node, reuse one
   * that already exists. Repeating a row twelve times costs twelve lines of
   * markup rather than twelve copies of the row, and the copy is exact.
   * Resolved when the tree is built, since only the store knows the source.
   */
  cloneOf?: string;
  /**
   * True when `sizeW: "fill"` came from this element being block-level with
   * no width of its own, rather than from an explicit `width: 100%`.
   *
   * A block element fills its container — but only in flow. As a flex item in
   * a row it shrink-wraps instead, and the difference is invisible from
   * inside the element: only its parent knows. So the rule is applied here
   * and revisited by whichever parent turns out to be laying it out.
   */
  blockFill?: boolean;
}

export interface ParseResult {
  nodes: ParsedNode[];
  /** CSS declarations encountered that the model cannot express. */
  ignored: string[];
  /**
   * What the conversion did, where it is worth knowing.
   *
   * `ignoredCss` reports one property at a time, which cannot describe the
   * things that actually go missing from a real page: a stylesheet resolved
   * at one width when it has rules for four, pseudo-elements recovered, hover
   * states that have no resting equivalent. Those were silent, so nobody knew
   * to rebuild them — the loss surfaced an hour later in a screenshot, if at
   * all. Said here, in the same call that caused it, it can be acted on.
   */
  conversion: {
    /** The viewport width the stylesheet's media queries resolved against. */
    resolvedAtWidth: number;
    /** Pseudo-elements recovered as real nodes. */
    pseudoElements: number;
    /** Text nodes keeping formatted runs rather than flattening them. */
    formattedRuns: number;
    /** The page's own @font-face families, and which of them render. */
    fonts?: { declared: string[]; loaded: string[]; fellBack: string[] };
  };
}

/**
 * Properties that map onto a real field on the node.
 *
 * This is no longer a whitelist of "supported CSS" — everything else is kept
 * too, verbatim, and handed to the browser. These are only the ones the
 * properties panel edits, which therefore have to be parsed into fields it
 * can read and write.
 */
const KNOWN = new Set([
  "display", "flex-direction", "gap", "flex-wrap", "justify-content",
  "align-items", "align-self", "flex-grow", "flex-shrink", "position",
  "left", "top", "width", "height", "min-width", "min-height",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "background", "background-color", "background-image", "color",
  "background-size", "background-position", "background-repeat",
  "opacity", "border-radius", "transform", "overflow",
  "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
  "font-family", "white-space", "flex", "box-sizing", "inset",
  "border", "border-color", "border-width", "box-shadow",
  "border-top", "border-right", "border-bottom", "border-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
]);

/**
 * Container properties the flex fields claim.
 *
 * They are only the panel's to own when the element is actually a flex
 * container. On a grid they mean something the flex model cannot hold, and
 * consuming them there is how `display:grid; gap:10px` lost its gutters —
 * the gap went into a flex layout that was never built, and the grid was
 * handed to the browser without it.
 */
const FLEX_CONTAINER_PROPS = new Set([
  "gap", "row-gap", "column-gap", "flex-direction", "flex-wrap",
  "justify-content", "align-items", "align-content",
]);

function parseStyle(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of text.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (key && value) out.set(key, value);
  }
  return out;
}

/** How many pixels a font-relative unit is worth. No cascade here, so there is
 *  no inherited size to resolve against; 16 is the browser default. */
const ROOT_FONT_PX = 16;

/**
 * A CSS length in pixels, or undefined when the value is not a length.
 *
 * The unit is the whole point. `parseFloat` alone reads "1rem" as 1 and
 * "1.5" as 1.5, which turned a 16px padding into a 1px one and a normal line
 * height into a 1.5px one — the value looked applied, and was wrong by an
 * order of magnitude. Anything that is not a resolvable length returns
 * undefined so the caller can report it rather than guess.
 */
function px(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const raw = v.trim();
  const m = /^(-?[\d.]+)(px|rem|em|pt|%)?$/.exec(raw);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  switch (m[2]) {
    case undefined:
    case "px": return n;
    case "rem":
    case "em": return n * ROOT_FONT_PX;
    case "pt": return (n * 96) / 72;
    // A percentage is relative to something this function cannot see.
    case "%": return undefined;
    default: return undefined;
  }
}

/** True when a value looks like a length but is one we cannot resolve. */
function unresolvable(v: string | undefined): boolean {
  if (v === undefined) return false;
  const raw = v.trim();
  if (raw === "" || raw === "0") return false;
  return px(raw) === undefined;
}

/** A colour, or a gradient when the value is one. */
/**
 * `background` and `background-image`.
 *
 * The `url(...)` case matters more than it looks. Every hero section on the
 * web is a container with a photograph behind it, written exactly this way,
 * and reading it as a colour stored the literal text "url(…)" as a fill —
 * which paints nothing, reports nothing, and leaves an agent to conclude the
 * image simply cannot be placed. That is what sends it off to base64 the file
 * instead.
 */
function parseBackground(value: string): {
  fill?: string;
  gradient?: Gradient;
  src?: string;
  fit?: "cover" | "contain";
  position?: string;
} {
  const raw = value.trim();
  // "none" is not a colour; painted literally it is an invalid fill.
  if (/^none$/i.test(raw)) return { fill: "transparent" };

  const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(raw);
  if (url) {
    const out: { src: string; fit?: "cover" | "contain"; position?: string } = {
      src: url[1].trim(),
    };
    // The shorthand puts size after a slash, and the rest is position.
    const rest = raw.replace(url[0], " ");
    const size = /\/\s*(cover|contain)/i.exec(rest);
    if (size) out.fit = size[1].toLowerCase() as "cover" | "contain";
    const pos = /\b(top|bottom|left|right|center)(\s+(top|bottom|left|right|center))?\b/i.exec(
      rest.replace(/\/\s*(cover|contain)/i, " "),
    );
    if (pos) out.position = pos[0].toLowerCase();
    return out;
  }

  const grad = /^(linear|radial)-gradient\((.*)\)$/i.exec(value.trim());
  if (!grad) return { fill: value.trim() };

  const kind = grad[1].toLowerCase() as "linear" | "radial";
  // Split on commas that are not inside a colour function.
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of grad[2]) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);

  let angle: number | undefined;
  const stops: Gradient["stops"] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const deg = /^(-?[\d.]+)deg$/.exec(part);
    if (deg && stops.length === 0) { angle = parseFloat(deg[1]); continue; }
    if (/^(to |circle|ellipse|at )/i.test(part) && stops.length === 0) continue;
    // "colour 52%" — the position is optional and filled in evenly below.
    const m = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(part);
    if (!m) continue;
    stops.push({
      color: m[1].trim(),
      at: m[2] !== undefined ? parseFloat(m[2]) / 100 : NaN,
    });
  }
  stops.forEach((s, i) => {
    if (Number.isNaN(s.at)) s.at = stops.length === 1 ? 0 : i / (stops.length - 1);
  });

  return stops.length ? { gradient: { kind, angle, stops } } : { fill: value.trim() };
}

/**
 * One of the two size axes.
 *
 * A percentage is not a length: reading "100%" with parseFloat would make a
 * full-width row exactly 100 pixels wide. Full width is the model's "fill";
 * any other percentage has no equivalent and is reported rather than guessed.
 */
function size(
  value: string | undefined,
  prop: string,
  unmapped: Set<string>,
): { mode: SizeMode; value?: number } {
  if (!value) return { mode: "auto" };
  const v = value.trim();
  // calc()/clamp()/min()/max() resolve against a box this parser cannot see.
  if (/^(calc|clamp|min|max)\(/i.test(v)) {
    unmapped.add(`${prop}: ${v}`);
    return { mode: "auto" };
  }
  if (v === "auto" || v === "fit-content" || v === "max-content") {
    return { mode: "auto" };
  }
  if (v === "100%" || v === "stretch" || v === "-webkit-fill-available") {
    return { mode: "fill" };
  }
  if (v === "min-content") return { mode: "auto" };
  const n = px(v);
  if (n !== undefined) return { mode: "fixed", value: n };
  // calc(), clamp(), a percentage — anything the model cannot hold as a
  // number. Reported rather than silently becoming "size to content".
  unmapped.add(`${prop}: ${v}`);
  return { mode: "auto" };
}

/**
 * A colour split into the hex and opacity the style model keeps separately.
 *
 * CSS carries alpha inside the colour; the model keeps it beside it, because
 * the properties panel edits the two with different controls.
 */
function paint(value: string): { color: string; opacity: number } {
  const v = value.trim();
  // #RGBA and #RRGGBBAA put the alpha in the colour; the model keeps the two
  // apart, so an unsplit "#0003" was being stored as a colour nothing renders.
  const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(v);
  if (hex) {
    const h = hex[1];
    const short = h.length === 4;
    const part = (i: number) =>
      short ? h[i] + h[i] : h.slice(i * 2, i * 2 + 2);
    const alpha = parseInt(short ? h[3] + h[3] : h.slice(6, 8), 16) / 255;
    return { color: `#${part(0)}${part(1)}${part(2)}`, opacity: alpha };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (fn) {
    const parts = fn[1].split(/[,/]/).map((n) => n.trim());
    const [r, g, b] = parts.map((n) => parseFloat(n));
    const a = parts.length > 3 ? parseFloat(parts[3]) : 1;
    const hex = [r, g, b]
      .map((n) => Math.max(0, Math.min(255, Math.round(n || 0))).toString(16).padStart(2, "0"))
      .join("");
    return { color: `#${hex}`, opacity: Number.isFinite(a) ? a : 1 };
  }
  return { color: v, opacity: 1 };
}

/** `1px solid #E5E7EB` — the line style is not modelled, the rest is. */
function borderParts(value: string): { width?: number; colour?: string } | null {
  if (/^(none|0)$/i.test(value.trim())) return null;
  let width: number | undefined;
  let colour: string | undefined;
  for (const part of value.trim().split(/\s+(?![^(]*\))/)) {
    if (/^[\d.]+(px|rem|em)?$/.test(part)) width = parseFloat(part);
    else if (!/^(solid|dashed|dotted|none|hidden|double|groove|ridge|inset|outset)$/i.test(part)) {
      colour = part;
    }
  }
  return { width, colour };
}

/**
 * The node's border.
 *
 * The model holds one border with one side, so a box outlined differently on
 * each edge cannot be expressed. The extra sides are reported rather than
 * silently averaged into something nobody asked for.
 */
function parseBorder(
  style: Map<string, string>,
  unmapped: Set<string>,
): BorderStyle | undefined {
  const sides: Array<[BorderStyle["side"], string]> = [
    ["Top", "border-top"], ["Right", "border-right"],
    ["Bottom", "border-bottom"], ["Left", "border-left"],
  ];

  let side: BorderStyle["side"] = "All";
  let parts: { width?: number; colour?: string } | null = null;

  const shorthand = style.get("border");
  if (shorthand) parts = borderParts(shorthand);

  const given = sides.filter(([, prop]) => style.has(prop));
  for (const [name, prop] of given) {
    const p = borderParts(style.get(prop)!);
    // A transparent edge is how "no line here" is usually written; it is not
    // a border to keep, and treating it as one draws a black rule.
    const blank = p?.colour !== undefined && /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/i.test(p.colour);
    if (!p || blank) continue;
    if (parts && side !== "All") { unmapped.add(prop); continue; }
    parts = p;
    side = name;
  }
  if (given.length > 1 && side !== "All") {
    for (const [name, prop] of given) if (name !== side) unmapped.add(prop);
  }

  if (!parts) return undefined;
  const { width, colour } = parts;
  if (width === undefined && colour === undefined) return undefined;

  const bw = style.get("border-width");
  if (unresolvable(bw)) unmapped.add(`border-width: ${bw!.trim()}`);
  const w = px(bw);
  const c = style.get("border-color");
  const p = paint(c ?? colour ?? "#000000");
  return { ...p, visible: true, width: w ?? width ?? 1, side };
}

/** `0 2px 8px rgba(0,0,0,.08)`, one or more, comma separated. Inset shadows
 *  are returned separately — the model draws them with a different CSS
 *  property, and folding them together turned an inner shadow into a drop
 *  shadow pointing the wrong way. */
function parseShadows(value: string): { drop: ShadowStyle[]; inner: ShadowStyle[] } {
  if (/^none$/i.test(value.trim())) return { drop: [], inner: [] };
  const out: ShadowStyle[] = [];
  const inset: ShadowStyle[] = [];
  // Split on commas outside colour functions, as the gradient parser does.
  const chunks: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { chunks.push(cur); cur = ""; continue; }
    cur += ch;
  }
  chunks.push(cur);

  for (const chunk of chunks) {
    const parts = chunk.trim().split(/\s+(?![^(]*\))/).filter(Boolean);
    if (!parts.length) continue;
    const lengths: number[] = [];
    let colour = "#000000";
    for (const part of parts) {
      const len = px(part);
      if (len !== undefined) lengths.push(len);
      else if (!/^inset$/i.test(part)) colour = part;
    }
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    const shadow = { ...paint(colour), visible: true, x, y, blur, spread };
    (/\binset\b/i.test(chunk) ? inset : out).push(shadow);
  }
  return { drop: out, inner: inset };
}

function parseRadius(
  value: string, unmapped: Set<string>,
): { radius?: number; radii?: CornerRadii } {
  const parts = value.trim().split(/\s+/);
  // A percentage radius depends on the box's own size, which is not a number
  // this model can hold — reading "50%" as 50px is how a pill became a chip.
  // A percentage radius is relative to the box. 50% is the circle idiom and
  // 999px reaches the same place on any realistic size, so it can be honoured
  // rather than refused; other percentages have no fixed equivalent.
  if (parts.length === 1 && /^\d+(\.\d+)?%$/.test(parts[0])) {
    return { radius: parseFloat(parts[0]) >= 50 ? 9999 : 0 };
  }
  if (parts.some(unresolvable)) {
    unmapped.add(`border-radius: ${value.trim()}`);
    return {};
  }
  const nums = parts.map((v) => px(v) ?? 0);
  if (nums.length === 1) return { radius: nums[0] };
  // CSS shorthand: 2 values are TL/BR + TR/BL, 3 adds BL, 4 is all corners.
  const [a, b, c, d] = nums;
  if (nums.length === 2) return { radii: [a, b, a, b] };
  if (nums.length === 3) return { radii: [a, b, c, b] };
  return { radii: [a, b, c, d] };
}

/**
 * One side of a spacing shorthand.
 *
 * A pixel length becomes a number. Anything else that is still valid CSS —
 * a percentage, `auto` — is kept as written, because the canvas is real CSS
 * and the browser resolves it against the box this parser cannot see. Only
 * genuinely unusable values are reported.
 */
function spacingSide(raw: string, prop: string, unmapped: Set<string>): SpacingValue {
  const v = raw.trim();
  const n = px(v);
  if (n !== undefined) return n;
  if (/^(auto|[\d.]+%)$/i.test(v)) return v;
  unmapped.add(`${prop}: ${v}`);
  return 0;
}

/** `padding` / `margin`, shorthand or per-side. */
function parseSpacing(
  style: Map<string, string>,
  base: "padding" | "margin",
  unmapped: Set<string>,
): Padding | undefined {
  const all = style.get(base);
  let p: Padding | undefined;
  if (all) {
    const parts = all.trim().split(/\s+/).map((v) => spacingSide(v, base, unmapped));
    if (parts.length === 1) p = { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
    else if (parts.length === 2) p = { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
    else if (parts.length === 3) p = { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
    else p = { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  }
  const sides: Array<[keyof Padding, string]> = [
    ["top", `${base}-top`], ["right", `${base}-right`],
    ["bottom", `${base}-bottom`], ["left", `${base}-left`],
  ];
  for (const [key, prop] of sides) {
    const raw = style.get(prop);
    if (raw === undefined) continue;
    p = p ?? { top: 0, right: 0, bottom: 0, left: 0 };
    p[key] = spacingSide(raw, prop, unmapped);
  }
  return p;
}

/**
 * Tags that are block-level in CSS.
 *
 * The distinction is load-bearing, not cosmetic. A block element with no
 * declared width fills its container; an inline one shrinks to its content.
 * Treating everything as shrink-to-fit is why a full-width section arrived
 * 96px wide — the markup was right and the model simply was not applying the
 * rule the browser would have.
 */
const BLOCK_TAGS = new Set([
  "div", "section", "article", "header", "footer", "main", "aside", "nav",
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "form",
  "figure", "blockquote", "pre", "table", "fieldset", "hr",
]);

/**
 * An element's text, with line breaks preserved.
 *
 * textContent alone drops `<br>` entirely, so a two-line heading collapsed
 * onto one. Walking the nodes keeps the break as the newline it stands for,
 * and the node model already renders newlines because text nodes wrap.
 */
function textOf(el: Element): string {
  let out = "";
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) out += child.textContent ?? "";
      else if (child.nodeType === 1) {
        const tag = (child as Element).tagName.toLowerCase();
        if (tag === "br") out += "\n";
        else walk(child);
      }
    }
  };
  walk(el);
  // Collapse runs of whitespace the way HTML does, but keep real newlines.
  return out.replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").trim();
}

/** Which node type an element becomes. */
function typeFor(el: Element, hasTextOnly: boolean): NodeType {
  const tag = el.tagName.toLowerCase();
  if (tag === "svg") return "svg";
  if (tag === "img") return "image";
  // A field showing its placeholder is a box with words in it.
  if ((tag === "input" || tag === "textarea") && el.getAttribute("placeholder")) return "text";
  if (hasTextOnly) return "text";
  // A styled box with children is a frame; without children it is a rectangle.
  return el.children.length > 0 ? "frame" : "rect";
}

/** True when the element's content is just text. */
/**
 * Elements that mark up a run of text rather than box it.
 *
 * These carry meaning about the words around them, not layout, so an element
 * containing only these is still one piece of text.
 */
const INLINE_TAGS = new Set([
  "a", "b", "strong", "i", "em", "span", "small", "u", "s", "mark", "sub",
  "sup", "code", "kbd", "abbr", "cite", "q", "time", "label", "br", "wbr",
]);

/**
 * Whether an inline element is genuinely a run of words.
 *
 * The tag is not enough. `<a>` marks up a word inside a sentence and it also
 * marks up a nav pill with padding, a background and a radius — same tag,
 * completely different thing. Collapsing on the tag alone turned four
 * navigation buttons into one text node reading
 * "Programs\nAbout\nOur Courts\nGallery", which keeps every word and loses
 * every pill.
 *
 * By this point the cascade has been resolved onto each element, so the
 * answer is sitting in its own style attribute: something the browser lays
 * out as a box, or that paints or pads one, is a box.
 */
function isInlineRun(el: Element): boolean {
  const style = parseStyle(el.getAttribute("style") ?? "");

  const display = style.get("display")?.trim();
  if (display && display !== "inline") return false;

  if (paintsBox(style)) return false;

  // A width or height of its own makes it a box regardless of display.
  for (const axis of ["width", "height"] as const) {
    const value = style.get(axis)?.trim();
    if (value && value !== "auto") return false;
  }
  return true;
}

/** True when every child is inline markup rather than a box. */
function inlineOnly(el: Element): boolean {
  return Array.from(el.children).every(
    (c) => INLINE_TAGS.has(c.tagName.toLowerCase()) && isInlineRun(c),
  );
}

/**
 * True when this element's content is a run of text.
 *
 * Inline children do not disqualify it. Treating them as boxes is what threw
 * the surrounding words away: the parser walked `el.children`, which lists
 * elements only, so in `<i>JOIN</i> THE THRILL` the bare text node holding
 * "THE THRILL" was never visited and simply vanished. That is most real
 * markup — any sentence with a bold word in it.
 */
function isTextOnly(el: Element): boolean {
  if (!inlineOnly(el)) return false;
  return (el.textContent ?? "").trim().length > 0;
}

/**
 * Declarations that make an element a box rather than a run of text.
 *
 * A text node in this model has no background: its `fill` is the glyph
 * colour. So these cannot survive being folded into one, and an element
 * carrying any of them has to stay a frame.
 */
const BOX_PROPS = new Set([
  "background", "background-color", "background-image",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-width", "border-color", "border-style",
  "border-radius", "box-shadow",
]);

/** True when the element paints or pads a box of its own. */
function paintsBox(style: Map<string, string>): boolean {
  for (const [key, value] of style) {
    if (!BOX_PROPS.has(key)) continue;
    const v = value.trim().toLowerCase();
    if (v && v !== "none" && v !== "transparent" && v !== "0") return true;
  }
  return false;
}

/**
 * The words inside a box, as their own node.
 *
 * A chip is `<div style="background:…;padding:…"><span style="font-size:…">`.
 * Folded into one text node it lost both halves at once: the background became
 * the glyph colour, because that is what `fill` means on text, and the span's
 * size, weight and colour were thrown away with the span. Splitting it keeps
 * the box on the frame and the typography on the text.
 *
 * Where a single inline child holds all the words, that child *is* the text
 * and carries the styling worth having. Otherwise the wrapper's own typography
 * applies, which is read by converting it again with the box half removed —
 * so there is one implementation of what a text node is, not two.
 */
function textChildOf(
  el: Element,
  style: Map<string, string>,
  unmapped: Set<string>,
): ParsedNode | null {
  const only = el.children.length === 1 ? el.children[0] : null;
  if (only && textOf(only) === textOf(el)) {
    const node = convert(only, unmapped);
    if (node && node.type === "text") return node;
  }

  const bare = el.cloneNode(true) as Element;
  bare.setAttribute(
    "style",
    [...style]
      .filter(([k]) => !BOX_PROPS.has(k))
      .map(([k, v]) => `${k}:${v}`)
      .join(";"),
  );
  return convert(bare, unmapped);
}

/**
 * An element's children, including the words between them.
 *
 * Walking `el.children` visits elements only. Any bare text sitting beside an
 * element child was therefore never visited and simply disappeared: markup as
 * ordinary as `<div class="btn">View Classes <svg/></div>` arrived as an icon
 * in an empty button, which is exactly what a white pill with nothing in it
 * is. The all-inline case was fixed once already — this is the same deletion
 * one step out, where the text shares its parent with a real box.
 *
 * Order is preserved by walking childNodes rather than elements, so the words
 * stay where they were written. A run of text becomes a text node carrying
 * its parent's typography, minus anything that paints the parent's own box.
 */
function childNodesOf(
  el: Element,
  style: Map<string, string>,
  unmapped: Set<string>,
): ParsedNode[] {
  const out: ParsedNode[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const span = el.ownerDocument.createElement("span");
      span.setAttribute(
        "style",
        [...style]
          .filter(([k]) => !BOX_PROPS.has(k))
          .map(([k, v]) => `${k}:${v}`)
          .join(";"),
      );
      span.textContent = text;
      const node = convert(span, unmapped);
      if (node) out.push(node);
    } else if (child.nodeType === 1) {
      const node = convert(child as Element, unmapped);
      if (node) out.push(node);
    }
  }
  return out;
}

/**
 * Inline markup, reduced to what is safe and meaningful to keep.
 *
 * Only the tags that mark up a run of words, and only their style attribute —
 * which by this point carries the resolved cascade, so an `<i>` arrives
 * already knowing it is italic at weight 500. Everything else goes: scripts
 * and handlers because they must, hrefs and ids because a canvas layer has no
 * use for them.
 */
const RUN_TAGS = new Set([
  "b", "strong", "i", "em", "u", "s", "mark", "small", "sub", "sup", "span",
  "code", "kbd", "abbr", "cite", "q", "time", "br", "wbr", "a", "label",
]);

function sanitiseRuns(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (!RUN_TAGS.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      const style = child.getAttribute("style");
      for (const attr of Array.from(child.attributes)) {
        child.removeAttribute(attr.name);
      }
      if (style) child.setAttribute("style", style);
      walk(child);
    }
  };
  walk(copy);
  return copy.innerHTML;
}

/**
 * True when the words are not all styled the same.
 *
 * A run wrapped in a tag that changes nothing — a stray `<span>` around a
 * whole heading — is still one uniform run, and keeping markup for it would
 * cost the layer its editable plain text for no gain.
 */
const RUN_STYLE_PROPS = [
  "font-style", "font-weight", "font-size", "color", "text-decoration-line",
  "font-family", "letter-spacing", "background-color", "font-stretch",
] as const;

/**
 * Tags that change how their words look without being asked to.
 *
 * `<i>` is italic because it is an `<i>`, not because a rule said so. The
 * resolver deliberately carries only what differs from a bare element of the
 * same tag — which is right, and means the one property that makes an italic
 * italic is the one property it never writes down. Comparing style attributes
 * therefore found nothing to preserve on exactly the markup that needed
 * preserving, and every emphasised word in every heading came out flat.
 */
const FORMATTING_TAGS = new Set([
  "b", "strong", "i", "em", "u", "s", "mark", "sub", "sup", "code", "kbd",
  "small", "abbr", "del", "ins",
]);

function hasMixedRuns(el: Element): boolean {
  // Read from the style attribute, not getComputedStyle. These elements come
  // from DOMParser and are not in any document, so getComputedStyle has
  // nothing to compute against and answers with blanks — which compared equal
  // to the parent's blanks, so every run looked uniform and every italic was
  // thrown away. The resolved cascade is already written onto each element by
  // this point, which is the thing to compare.
  const own = parseStyle(el.getAttribute("style") ?? "");
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "br" || tag === "wbr") continue;
    if (FORMATTING_TAGS.has(tag)) return true;
    const style = parseStyle(child.getAttribute("style") ?? "");
    for (const prop of RUN_STYLE_PROPS) {
      const value = style.get(prop);
      if (value !== undefined && value !== own.get(prop)) return true;
    }
  }
  return false;
}

/**
 * Properties that place an element, as opposed to draw it.
 *
 * An icon is stored as its own markup, verbatim, because that is the only
 * faithful thing to do with a drawing. But by the time it reaches here the
 * resolver has written the whole computed cascade onto it — including where
 * the browser decided it sits, which for an absolutely-placed one is a real
 * offset from its container.
 *
 * The node then carries that placement too, so the drawing is offset twice:
 * once correctly by its node, and again by itself, inside its own clipped
 * box. On a page's decorative flourish that is 900px of offset and the icon
 * simply disappears — while every other icon on the page is fine, because a
 * static one resolves to left: 0 and the second offset is zero.
 *
 * Placement belongs to the node. The markup keeps everything that makes it a
 * drawing and gives up everything that makes it a box.
 */
const SVG_PLACEMENT = new Set([
  "position", "left", "top", "right", "bottom", "inset", "float", "clear",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "z-index", "grid-area", "grid-column", "grid-row", "grid-column-start",
  "grid-column-end", "grid-row-start", "grid-row-end", "align-self",
  "justify-self", "order", "flex", "flex-grow", "flex-shrink", "flex-basis",
]);

/** The icon's own markup, with the node's placement taken back out of it. */
function svgMarkup(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  const style = parseStyle(copy.getAttribute("style") ?? "");
  const kept = [...style]
    .filter(([k]) => !SVG_PLACEMENT.has(k))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  if (kept) copy.setAttribute("style", kept);
  else copy.removeAttribute("style");
  return copy.outerHTML;
}

function convert(el: Element, unmapped: Set<string>): ParsedNode | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "script" || tag === "style") return null;

  // Reuse an existing node rather than re-describing it. Any styles on the
  // element are applied to the copy, so a clone can be varied as it lands.
  if (tag === "x-clone") {
    const source = el.getAttribute("node-id");
    if (source) {
      const style = parseStyle(el.getAttribute("style") ?? "");
      const props: Partial<SceneNode> = {};
      const w = px(style.get("width"));
      const h = px(style.get("height"));
      if (w !== undefined) { props.width = w; props.sizeW = "fixed"; }
      if (h !== undefined) { props.height = h; props.sizeH = "fixed"; }
      const bg = style.get("background") ?? style.get("background-color");
      if (bg) {
        const parsed = parseBackground(bg);
        if (parsed.fill) props.fill = parsed.fill;
        if (parsed.gradient) props.gradient = parsed.gradient;
      }
      const op = parseFloat(style.get("opacity") ?? "");
      if (Number.isFinite(op)) props.opacity = op;
      return {
        type: "frame",
        cloneOf: source,
        name: el.getAttribute("layer-name") ?? undefined,
        props,
        children: [],
      };
    }
  }

  const style = parseStyle(el.getAttribute("style") ?? "");

  // Anything without a first-class field is passed straight through to the
  // browser rather than discarded. The canvas is real CSS; a property this
  // parser has never heard of is still something the engine understands.
  const displayValue = style.get("display")?.trim();
  const isFlexContainer =
    displayValue === "flex" || displayValue === "inline-flex";

  const passthrough: Record<string, string> = {};
  for (const [key, value] of style) {
    const ownedByPanel =
      KNOWN.has(key) && (isFlexContainer || !FLEX_CONTAINER_PROPS.has(key));
    if (!ownedByPanel) passthrough[key] = value;
  }

  // A property the panel *does* own can still carry a value no field can hold
  // — `clamp()` for a size, `100vh` for a height, `grid` for a display. Those
  // are recorded as unmapped so the caller knows the panel cannot edit them,
  // and then handed to the browser anyway, because refusing to render valid
  // CSS is what sends an agent looking for a workaround.
  const beforeCount = unmapped.size;
  const mappedProps = new Set(unmapped);

  const textOnly = isTextOnly(el);
  // Text inside something that paints or pads is a box with words in it, and
  // stays two nodes. Only a bare run of text becomes one.
  const boxed = textOnly && paintsBox(style);
  // A box that paints and holds words is a container, whatever its markup
  // looked like. typeFor calls a childless element a rect, and `<div
  // class="tag">Practice</div>` has no *element* children — so the split
  // below handed a rect a text child. A rect is a leaf shape: it never lays
  // anything out, so the text sat absolutely at its origin and the box never
  // grew to fit. With 16px of padding on a box that stayed 32 wide, the word
  // had zero room and broke mid-way, as "Pract/ice". Wrapping the same text
  // in a span produced a frame and worked, which is the tell.
  const type = boxed ? "frame" : typeFor(el, textOnly);
  const props: Partial<SceneNode> = {};

  // --- layout ------------------------------------------------------------
  // Only flex and block are modelled. Grid especially must be reported: a
  // grid container silently falling back to stacked children is the kind of
  // failure that looks like a layout bug rather than a missing feature.
  const display = style.get("display");
  if (display && !["flex", "block", "inline-flex"].includes(display.trim())) {
    unmapped.add(`display: ${display.trim()}`);
  }

  // A block lays its children out rather than leaving them to position
  // themselves, whether it says so or is a block by default. Reading only
  // the absent case meant an explicit `display: block` produced a frame that
  // positioned its children absolutely — so it did not grow to fit them, and
  // a padded box came out the height of its padding. Which is precisely what
  // this parser is handed when it reads back markup this app exported.
  const declaredBlock =
    display === "block" || display === "flow-root" || display === "inline-block";
  if (declaredBlock || (!display && BLOCK_TAGS.has(tag))) props.layout = "flow";

  if (style.get("display") === "flex" || style.get("display") === "inline-flex") {
    const dir = style.get("flex-direction")?.trim();
    const known = ["row", "column", "row-reverse", "column-reverse"];
    if (dir && !known.includes(dir)) unmapped.add(`flex-direction: ${dir}`);

    // CSS gap takes one value or two — row first, then column.
    const gaps = (style.get("gap") ?? "").trim().split(/\s+/).filter(Boolean);
    const flex: FlexLayout = {
      direction: (dir && known.includes(dir) ? dir : "row") as FlexLayout["direction"],
      gap: px(gaps[0]) ?? 0,
    };
    if (gaps.length > 1) flex.columnGap = px(gaps[1]) ?? flex.gap;

    const wrap = style.get("flex-wrap")?.trim();
    if (wrap === "wrap") flex.wrap = true;
    else if (wrap === "wrap-reverse") flex.wrap = "reverse";
    else if (wrap && wrap !== "nowrap") unmapped.add(`flex-wrap: ${wrap}`);
    const justify = style.get("justify-content");
    if (justify) {
      flex.justify = justify.replace("flex-", "") as FlexLayout["justify"];
    }
    const align = style.get("align-items");
    if (align) flex.align = align.replace("flex-", "") as FlexLayout["align"];
    props.layout = "flex";
    props.flex = flex;
  }

  // `relative` is what a flowed child already is, so it is accepted silently.
  // Sticky and fixed have no meaning on an infinite canvas with no scroller.
  const position = style.get("position")?.trim();
  if (position === "absolute") props.placement = "absolute";
  else if (position && position !== "relative" && position !== "static") {
    unmapped.add(`position: ${position}`);
  }
  // A percentage offset is not a length: reading "50%" with parseFloat would
  // pin the node at 50 pixels. The model holds absolute offsets as numbers, so
  // percentages are reported rather than quietly turned into the wrong place.
  for (const [prop, key] of [["left", "x"], ["top", "y"]] as const) {
    const raw = style.get(prop);
    if (raw === undefined) continue;
    if (raw.trim().endsWith("%")) {
      unmapped.add(`${prop}: ${raw.trim()}`);
      continue;
    }
    const v = px(raw);
    if (v !== undefined) props[key] = v;
  }

  // `flex: 1` is how a filling child is written far more often than
  // `flex-grow: 1`, so read the shorthand's first value too.
  const shorthand = style.get("flex");
  if (shorthand) {
    const g = parseFloat(shorthand.trim().split(/\s+/)[0]);
    if (Number.isFinite(g)) props.grow = g;
  }
  const grow = parseFloat(style.get("flex-grow") ?? "");
  if (Number.isFinite(grow)) props.grow = grow;
  if (style.get("flex-shrink") === "0") props.shrink = false;
  const alignSelf = style.get("align-self");
  if (alignSelf) {
    props.alignSelf = alignSelf.replace("flex-", "") as FlexLayout["align"];
  }

  // Width and height: a length is fixed, 100% fills the parent, absent means
  // content decides.
  let blockFill = false;
  const w = size(style.get("width"), "width", unmapped);
  const h = size(style.get("height"), "height", unmapped);
  props.sizeW = w.mode;
  props.sizeH = h.mode;

  // `fit-content` is not `auto`. On a block element `auto` fills the
  // container and `fit-content` shrinks to the words — opposite results from
  // the same field, and the model has only the one field. So these keep
  // their own spelling and go to the browser, which has all three.
  // Without this a button written `width: fit-content` spanned its whole
  // column, and no correct CSS the author added could shrink it.
  for (const axis of ["width", "height"] as const) {
    const raw = style.get(axis)?.trim();
    if (raw && /^(fit-content|max-content|min-content)$/.test(raw)) {
      passthrough[axis] = raw;
    }
  }

  // A block element with no width of its own fills the width available to it,
  // exactly as it would on a page. Only when it is out of flow does it shrink
  // to its content instead.
  if (
    w.mode === "auto"
    && style.get("width") === undefined
    && BLOCK_TAGS.has(tag)
    && style.get("position") !== "absolute"
    && style.get("position") !== "fixed"
    && style.get("float") === undefined
    && !["inline-block", "inline-flex", "inline-grid", "inline"]
      .includes(style.get("display")?.trim() ?? "")
  ) {
    props.sizeW = "fill";
    blockFill = true;
  }
  if (w.value !== undefined) props.width = w.value;
  if (h.value !== undefined) props.height = h.value;

  // `inset: 0` is how a full-bleed overlay is written, and it says three
  // things at once: place absolutely, at the origin, filling both axes.
  // Applied after the size block so it wins over the absent width/height that
  // would otherwise leave the node sizing itself to nothing.
  const inset = style.get("inset")?.trim();
  if (inset) {
    const parts = inset.split(/\s+/);
    if (parts.every((v) => px(v) === 0)) {
      props.placement = "absolute";
      props.x = 0;
      props.y = 0;
      props.sizeW = "fill";
      props.sizeH = "fill";
    } else unmapped.add(`inset: ${inset}`);
  }

  const padding = parseSpacing(style, "padding", unmapped);
  if (padding) props.padding = padding;
  const margin = parseSpacing(style, "margin", unmapped);
  if (margin) props.margin = margin;

  // A floor on either axis. `min-width: 0` is the one that matters: without it
  // a flex child refuses to shrink below its content and pushes the rest of
  // the row out of alignment.
  for (const [prop, key] of [["min-width", "minWidth"], ["min-height", "minHeight"]] as const) {
    const raw = style.get(prop)?.trim();
    if (!raw || raw === "auto") continue; // "auto" is already the default
    const v = px(raw);
    if (v !== undefined) props[key] = v;
    else unmapped.add(`${prop}: ${raw}`);
  }

  // Every node already lays out as border-box, so asking for it is a no-op
  // rather than something dropped. Asking for content-box is not supported.
  const box = style.get("box-sizing");
  if (box && box.trim() !== "border-box") unmapped.add(`box-sizing: ${box.trim()}`);

  // --- presentation ------------------------------------------------------
  // Colour and image are two layers, not two spellings of one property, and
  // the image is painted over the colour. Reading them in preference order
  // meant a transparent `background-color` — which every element has once the
  // cascade is resolved onto it — beat a real `background-image`, so every
  // gradient in the document was discarded. That is how the hero's scrim
  // vanished: the one box whose entire job is a gradient came through with no
  // gradient and a transparent fill.
  //
  // Combined back into the shorthand they came from, so one parser reads them
  // and the layer order is the one CSS defines.
  const bgShorthand = style.get("background");
  const bgColour = style.get("background-color");
  const bgImage = style.get("background-image");
  const bg = bgShorthand
    ?? (bgImage && bgImage.trim() !== "none"
      ? bgColour && !/^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/i.test(bgColour.trim())
        ? `${bgColour} ${bgImage}`
        : bgImage
      : bgColour);
  if (bg && /^(inherit|initial|unset|revert|currentcolor)$/i.test(bg.trim())) {
    unmapped.add(`background: ${bg.trim()}`);
    props.fill = "transparent";
  } else if (bg) {
    const parsed = parseBackground(bg);
    if (parsed.fill) props.fill = parsed.fill;
    if (parsed.gradient) props.gradient = parsed.gradient;
    if (parsed.src) {
      props.src = parsed.src;
      if (parsed.fit) props.backgroundFit = parsed.fit;
      if (parsed.position) props.backgroundPosition = parsed.position;
      // The picture is the fill; anything behind it would never be seen.
      if (!parsed.fill) props.fill = "transparent";
    }
  }

  // `background-size` and `background-position` written out longhand.
  const bgSize = style.get("background-size")?.trim().toLowerCase();
  if (bgSize === "cover" || bgSize === "contain") props.backgroundFit = bgSize;
  else if (bgSize) unmapped.add(`background-size: ${bgSize}`);
  const bgPos = style.get("background-position")?.trim();
  if (bgPos) props.backgroundPosition = bgPos;

  // A div with no background at all paints nothing. The node defaults exist
  // for boxes drawn by hand, where an invisible new shape would be a bug;
  // here the markup is explicit, and an unasked-for white fill would hide
  // whatever sits behind it.
  if (!bg && type !== "text" && props.src === undefined) {
    props.fill = "transparent";
  }

  // "50%" is valid CSS for opacity and means 0.5. Read as a bare number it is
  // 50, which clamps to fully opaque — the exact opposite of what was asked.
  const rawOpacity = style.get("opacity")?.trim();
  if (rawOpacity) {
    const pct = rawOpacity.endsWith("%");
    const o = parseFloat(rawOpacity);
    if (Number.isFinite(o)) props.opacity = Math.min(1, Math.max(0, pct ? o / 100 : o));
    else unmapped.add(`opacity: ${rawOpacity}`);
  }

  const radius = style.get("border-radius");
  if (radius) Object.assign(props, parseRadius(radius, unmapped));

  const border = parseBorder(style, unmapped);
  if (border) props.border = border;

  const shadow = style.get("box-shadow");
  if (shadow) {
    const { drop, inner } = parseShadows(shadow);
    if (drop.length) props.shadows = drop;
    if (inner.length) props.innerShadows = inner;
  }

  // Kept whole rather than reduced to a rotation. Discarding the rest was
  // quietly dropping `translate(-50%, …)`, the usual way to centre something
  // absolutely positioned — the element stayed offset by half its own size,
  // which reads as a layout bug rather than a missing feature.
  const transform = style.get("transform");
  if (transform && transform.trim() !== "none") {
    props.transform = transform.trim();
    const rot = /rotate\((-?[\d.]+)deg\)/.exec(transform);
    if (rot) props.rotate = parseFloat(rot[1]);
  }

  const overflow = style.get("overflow")?.trim();
  if (overflow === "hidden" || overflow === "clip") props.clipContent = true;
  else if (overflow && overflow !== "visible") {
    // Nothing here scrolls; a scroll container would silently become a clip.
    unmapped.add(`overflow: ${overflow}`);
  }

  // --- text --------------------------------------------------------------
  if (type === "text") {
    props.text = textOf(el);
    // Formatting inside the run, when there is any worth keeping. The words
    // survive either way; this is what keeps the italic word italic.
    if (el.children.length > 0 && hasMixedRuns(el)) {
      const runs = sanitiseRuns(el);
      if (runs.trim()) props.richText = runs;
    }
    const rawSize = style.get("font-size");
    if (unresolvable(rawSize)) unmapped.add(`font-size: ${rawSize!.trim()}`);
    const size = px(rawSize);
    if (size !== undefined) props.fontSize = size;

    // Weights arrive as numbers or as the CSS keywords. Only the keywords with
    // a fixed numeric meaning can be resolved; the relative ones depend on an
    // inherited weight that does not exist here.
    const WEIGHTS: Record<string, number> = { normal: 400, bold: 700 };
    const rawWeight = (style.get("font-weight") ?? "").trim();
    const weight = parseFloat(rawWeight);
    if (Number.isFinite(weight)) props.fontWeight = weight;
    else if (WEIGHTS[rawWeight] !== undefined) props.fontWeight = WEIGHTS[rawWeight];
    else if (rawWeight) unmapped.add(`font-weight: ${rawWeight}`);
    else if (/^(b|strong)$/.test(tag)) props.fontWeight = 700;
    else if (/^h[1-6]$/.test(tag)) props.fontWeight = 600;

    // A unitless line-height is a multiple of the font size, which is the
    // usual way it is written; the model stores px, so resolve it.
    const rawLh = (style.get("line-height") ?? "").trim();
    const unitless = /^[\d.]+$/.test(rawLh) ? parseFloat(rawLh) : NaN;
    if (Number.isFinite(unitless) && !rawLh.endsWith("px")) {
      props.lineHeight = unitless * (props.fontSize ?? 16);
    } else if (rawLh === "normal") {
      // leave it to the automatic leading
    } else {
      if (unresolvable(rawLh)) unmapped.add(`line-height: ${rawLh}`);
      const lh = px(rawLh);
      if (lh !== undefined) props.lineHeight = lh;
    }
    const ls = style.get("letter-spacing")?.trim();
    if (ls && ls !== "normal") {
      const em = /^(-?[\d.]+)em$/.exec(ls);
      if (em) props.letterSpacing = parseFloat(em[1]);
      else {
        const abs = px(ls);
        if (abs !== undefined) props.letterSpacing = abs / (props.fontSize ?? 16);
        else unmapped.add(`letter-spacing: ${ls}`);
      }
    }

    const align2 = style.get("text-align")?.trim();
    if (align2 === "left" || align2 === "center" || align2 === "right") {
      props.textAlign = align2;
    } else if (align2 && align2 !== "start") {
      // justify, end, match-parent — the model holds three alignments.
      unmapped.add(`text-align: ${align2}`);
    }
    const colour = style.get("color")?.trim();
    // On a text node `fill` is the glyph colour, so colour wins over background.
    // Keywords that resolve against an inherited value have nothing to inherit
    // from here, so they would silently paint the default.
    if (colour && /^(currentcolor|inherit|initial|unset|revert)$/i.test(colour)) {
      unmapped.add(`color: ${colour}`);
    } else if (colour) props.fill = colour;

    const family = style.get("font-family");
    if (family) props.fontFamily = family;

    // The model stores wrapping as one flag, so only the two values it can
    // actually represent are accepted; anything else is reported.
    const ws = style.get("white-space")?.trim();
    if (ws === "normal" || ws === "pre" || ws === "pre-wrap" || ws === "nowrap") {
      props.whiteSpace = ws;
      props.preWrap = ws === "pre" || ws === "pre-wrap";
    } else if (ws) unmapped.add(`white-space: ${ws}`);
    if (props.fontSize === undefined && /^h1$/.test(tag)) props.fontSize = 32;
  } else {
    // `color` is the colour of words, not of the box. On a frame it was being
    // written to `fill`, which is the background — so every container painted
    // itself in its own text colour. That was survivable while only inline
    // styles were read, because a hand-written div rarely sets `color` and
    // nothing else. Once the cascade is resolved onto every element, every
    // element has a `color`, and the result is a page of solid rectangles: a
    // nav whose links became grey slabs, and a hero that set `color: white`
    // and painted itself white over its own photograph, taking the white
    // headline with it.
    //
    // It passes through as CSS instead, where it means what it means — the
    // colour any text inside it inherits, including a formatted run.
    const colour = style.get("color");
    if (colour) passthrough.color = colour;
  }

  if (type === "svg") {
    props.svg = svgMarkup(el);
    // An SVG's own attributes carry its size when CSS does not.
    if (props.width === undefined) {
      const aw = px(el.getAttribute("width") ?? undefined);
      if (aw !== undefined) { props.width = aw; props.sizeW = "fixed"; }
    }
    if (props.height === undefined) {
      const ah = px(el.getAttribute("height") ?? undefined);
      if (ah !== undefined) { props.height = ah; props.sizeH = "fixed"; }
    }
  }

  if (type === "image") {
    const src = el.getAttribute("src");
    if (src) props.src = src;
  }

  // A form field's placeholder is its visible content when the field is
  // empty, which on a static canvas is always. It lives in an attribute
  // rather than in the text, so a walker never saw it and every input
  // converted to an empty box — the newsletter field on a real footer came
  // through as a dark rounded rectangle with nothing in it.
  if (tag === "input" || tag === "textarea") {
    const placeholder = el.getAttribute("placeholder");
    if (placeholder && !props.text) {
      props.text = placeholder;
      // Placeholder text is dimmed by convention, and its own colour lives in
      // a ::placeholder rule this parser does not read. Half the field's
      // colour is close, and much closer than the field's full colour.
      const colour = style.get("color");
      if (colour) props.fill = colour;
      props.opacity = (props.opacity ?? 1) * 0.55;
    }
  }

  // Everything the field parsers refused, given to the browser verbatim.
  if (unmapped.size > beforeCount) {
    for (const entry of unmapped) {
      if (mappedProps.has(entry)) continue;
      // Entries are recorded either as "prop" or as "prop: value".
      const prop = entry.split(":")[0].trim();
      const value = style.get(prop);
      if (value === undefined) continue;
      passthrough[prop] = value;
      // It renders. `ignoredCss` is the one channel saying what did not take
      // effect, so listing something the browser is about to apply teaches
      // the caller to distrust the whole list — and then to stop using the
      // feature it was wrongly warned about. `display:grid` was reported as
      // ignored while laying out correctly.
      unmapped.delete(entry);
    }
  }

  if (Object.keys(passthrough).length) props.css = passthrough;

  // A pseudo-element says so in the layer tree. Seeing "::after" next to a
  // hero explains a box nobody wrote, which is otherwise a small mystery.
  const pseudo = el.getAttribute("data-pseudo");
  const name = el.getAttribute("layer-name")
    ?? (pseudo ? `::${pseudo}` : undefined);

  // SVG is opaque; everything else recurses.
  // SVG is opaque, and a text node's inline markup is part of its own words
  // rather than a set of child boxes — descending into it would duplicate the
  // text it already carries.
  const children: ParsedNode[] =
    type === "svg" || type === "text"
      ? []
      : boxed
        ? [textChildOf(el, style, unmapped)].filter(
            (c): c is ParsedNode => c !== null,
          )
        : childNodesOf(el, style, unmapped);

  // A block element fills its container in flow. As a flex item it does not:
  // across a row it shrink-wraps, and down a column it is stretched by the
  // default `align-items: stretch` — which looks like the same result but is
  // not the same mechanism. Stretch yields to `align-self: flex-start` and to
  // `width: fit-content`; a hard `width: 100%` overrules both. Imposing the
  // width here is why every button came out the full width of its column and
  // no amount of correct CSS on the button could shrink it.
  //
  // So a flex parent of any direction leaves its children's width alone and
  // lets the layout do what CSS says it does.
  if (props.layout === "flex") {
    for (const child of children) {
      if (child.blockFill) {
        child.props.sizeW = "auto";
        child.blockFill = false;
      }
    }
  }

  return { type, name, props, children, blockFill };
}

/**
 * HTML has no self-closing syntax for non-void elements, so `<x-clone …/>`
 * does not end where it looks like it ends — the parser treats everything
 * after it as its children, and two clones in a row silently become one
 * nested inside the other. Closing them explicitly before parsing means the
 * obvious way to write a clone is also the correct one.
 */
function closeVoidClones(html: string): string {
  return html.replace(/<x-clone\b([^>]*?)\/>/gi, "<x-clone$1></x-clone>");
}

export async function parseHtml(
  html: string,
  containerWidth = 1440,
): Promise<ParseResult> {
  // Every fragment goes through the browser, not just the ones carrying a
  // stylesheet. Resolving only those meant two implementations of what markup
  // means — the browser's, and a set of heuristics here for everything else —
  // and the heuristics lost. They re-derived `display`, `width` and inline
  // flow that the browser had already computed correctly, and every place
  // they disagreed was a silent defect: a block filling a flex row, a
  // fit-content button spanning its column, display:block not meaning flow.
  //
  // One authority. Mounting costs a layout pass; being wrong costs the design.
  const { html: source, fonts } = await inlineStylesheet(html, containerWidth);

  const doc = new DOMParser().parseFromString(
    `<div id="__root">${closeVoidClones(source)}</div>`,
    "text/html",
  );
  const root = doc.getElementById("__root");
  // Declarations that could not become a first-class field. They are not
  // discarded — convert() hands them to the browser as raw CSS — so this is
  // reported only as a note about what the panel will not be able to edit.
  const unmapped = new Set<string>();
  if (!root) {
    return {
      nodes: [],
      ignored: [],
      conversion: {
        resolvedAtWidth: containerWidth,
        pseudoElements: 0,
        formattedRuns: 0,
      },
    };
  }

  const nodes = Array.from(root.children)
    .map((el) => convert(el, unmapped))
    .filter((n): n is ParsedNode => n !== null);

  const count = (list: ParsedNode[]): { pseudo: number; runs: number } => {
    let pseudo = 0;
    let runs = 0;
    const walk = (n: ParsedNode): void => {
      if (n.name === "::before" || n.name === "::after") pseudo += 1;
      if (n.props.richText) runs += 1;
      for (const c of n.children) walk(c);
    };
    for (const n of list) walk(n);
    return { pseudo, runs };
  };
  const tally = count(nodes);

  return {
    nodes,
    ignored: [...unmapped].sort(),
    conversion: {
      resolvedAtWidth: containerWidth,
      pseudoElements: tally.pseudo,
      formattedRuns: tally.runs,
      // Which of the page's own faces arrived. A family listed here but not
      // loaded is rendering as something else, and every measurement taken
      // of it is a measurement of the substitute.
      fonts: fonts.families.length
        ? {
            declared: fonts.families,
            loaded: fonts.loaded,
            fellBack: fonts.families.filter((f) => !fonts.loaded.includes(f)),
          }
        : undefined,
    },
  };
}
