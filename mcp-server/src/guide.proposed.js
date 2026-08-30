/**
 * PROPOSED — diff against guide.js, take what you want.
 *
 * What changed and why, from the agent's side:
 *
 * INSTRUCTIONS gained five things it did not tell me to do. In the Paper
 * build I did all five, and only because Paper's own instructions said to.
 * Working from the current text I would have skipped every one:
 *
 *   1. get_status first. Its own description says "call this first"; nothing
 *      the agent reads before its first call repeats that.
 *   2. get_font_info before setting type. The tool exists and is good. Nothing
 *      says to use it, so type gets set in a family that may silently fall
 *      back — which is exactly the failure the tool was built to prevent.
 *   3. Commit to a palette and a type scale before the first write_html.
 *      This is process, not house style: it says decide once, not what to
 *      decide. It is the largest single difference between a screen that
 *      looks designed and one that looks assembled.
 *   4. create_artboard for a new screen. The tool prefers itself; the
 *      instructions never mention it, so create_node stays the default.
 *   5. finish_working when stopping. Same gap — good tool, never requested.
 *
 * The per-group check became a named list. "Check it rendered as intended"
 * is easy to satisfy with a glance. Five named checks have to be answered
 * one at a time, which is the point.
 *
 * A `craft` topic was added. It is deliberately not a house style: no mood
 * words, no palette tables, no prescribed look. It covers only the things
 * that are wrong in any style — unreadable contrast, flat hierarchy, uniform
 * spacing, text too small to read. Drop the topic if you disagree; the rest
 * of the file does not depend on it.
 *
 * INSTRUCTIONS is now ~30% longer, and it is spent on every request. That is
 * the trade. If it needs to come back down, the first four numbered steps
 * are the ones earning their place; the editing list could move to a topic.
 */

export const INSTRUCTIONS = `This server is a design canvas. The user is watching it change as you work.

The canvas is real DOM and real CSS. write_html is how you build: one call carries a whole component, and flexbox lays it out exactly as a browser would. Do not place a design node by node.

Images: put an absolute file path in <img src>. The app reads the file. Never base64 one into a data URL and never downscale one to make it fit — that destroys the image and costs thousands of tokens for something a path does in forty characters.

## Before the first write_html

1. get_status — the open file, its artboards and their sizes, the fonts already in use, the selection. Artboard width is what tells you whether this is a phone or a desktop.
2. get_font_info on any family you intend to set. A family that is not installed does not error; it silently falls back, and the type you designed is not the type that renders.
3. Decide a palette and a type scale, and say what you chose before you build. Two or three colours and four or five sizes, chosen once and used throughout, is most of what separates a designed screen from an assembled one.
4. create_artboard for a new screen — it is placed clear of existing work and lays its children out in flow. Prefer it over create_node.

## While building

5. One visual group per write_html call — a header, a card, a list. Not a whole screen in one shot. The user is watching it appear.
6. Read ignoredCss in every result. Anything listed there did not take effect.
7. get_layout before get_screenshot. "Did it fit, is anything clipped, do the columns line up" are questions about numbers, and get_layout answers them as text for a fraction of what an image costs. Screenshot when the question is genuinely how something looks.
8. Check each group before starting the next, against all five: spacing even and rhythmic; hierarchy clear between heading, body and caption; contrast readable at a glance; columns aligned across repeated rows; nothing clipped at a frame edge. Fix what is wrong now, not at the end.

## Editing what is already there

9. find_nodes to locate something by name, text or type — it costs the matches, not the page. Reach for it before get_canvas_state.
10. move_nodes to restructure, set_text_content to retext, update_nodes to restyle. All three keep node ids, so rewriting HTML for any of them is wasted work.
11. <x-clone node-id="…"/> inside write_html repeats a node that already exists. Twelve identical rows cost twelve lines, not twelve blocks.
12. focus_node to show the user what you are talking about.
13. get_jsx when the design needs to become code — it emits the same styles the canvas renders with.

## When you stop

Call finish_working, so the user can tell a finished design from one that stopped halfway.

## Two mechanical rules that cause most misalignment here

- In a row of repeated items, give icons and trailing controls a fixed width with flex-shrink:0, and let the text column take the rest with flex:1 and min-width:0. Gap alone does not align columns across rows.
- A frame with a fixed height clips. If content outgrows it, set sizeH to "auto" so it hugs, rather than guessing a taller number.

The design is yours to make — this server has no house style. Call get_guide for what the renderer supports and where it differs from a browser.`;

const TOPICS = {
  "design-basics": `# How this canvas renders

Everything here is real DOM and real CSS, so what you know about a browser
applies. What follows is only where this renderer differs, or where something
fails quietly.

## Nothing is inherited
Set font-size, font-weight and color explicitly on every text node. There is no
cascade from a parent — an unset property takes the node default, not the value
you set on the container above it.

## Sizing
- A pixel length is a fixed size.
- 100% fills the parent on that axis.
- Omitting width or height sizes the node to its content.
Other percentages resolve against the containing block, as they do in CSS.

## Text sizing and wrapping
A text node with no width is measured from its content, so its width is decided
by the string, the font size, the weight and the letter spacing. Change any of
those and the node changes width — which is what moves a row out of alignment.
Give a text node that shares a row with other elements an explicit width, or
flex:1 with min-width:0, rather than letting it size itself.

## Fonts fail silently
A family that is not installed does not raise anything — the text renders in a
fallback, at different widths, and the design you checked is not the design
that shipped. get_font_info before setting type for the first time. It also
reports the weights that are genuinely distinct and whether a real italic
exists, so you can use them with confidence rather than guessing.

## Write ordinary CSS
This canvas renders real DOM with real CSS. Properties without special
handling are passed to the browser unchanged, so they behave exactly as they
would on a web page — display:grid, margin, padding:0 5%, background:url(...),
and anything else you would normally reach for.

ignoredCss lists only what genuinely could not be applied, and is normally
empty. Read it when it is not.`,

  craft: `# Craft

Not a house style — this server has none, and the look is yours to choose.
These are the things that read as wrong in any style.

## Hierarchy is size and weight, not just position
A screen where the heading, the body and the caption are 24, 18 and 16 has no
hierarchy; it has three similar greys. Put real distance between the levels —
a display size that is several times the caption size — and let the small text
stay genuinely small. Contrast of scale is what makes a page scannable before
it is read.

## Spacing carries meaning
Uniform spacing everywhere tells the reader nothing. Tighten it between things
that belong together — a label and its value, a heading and its subhead — and
open it up between groups. The gap is the grouping.

## Contrast is not negotiable
Muted text is a legitimate tool for hierarchy and is easy to overspend. Ask of
every colour pairing whether it reads at a glance, without squinting, and give
anything under 16px more contrast than feels necessary. Style and legibility
are never actually in tension; if they seem to be, the style is wrong.

## Restraint
When choosing between adding an element and removing one, remove. White space
is a feature. One deliberate accent colour is stronger than four competing
ones. A page that does less, more precisely, reads as more considered.

## Do not repeat a grid
Equal cards in an equal grid at equal weight is the default output shape, and
it looks like default output. Vary something deliberately — one card larger,
one column wider, one heading much bigger than the rest — so the eye is given
somewhere to land first.`,

  layout: `# Layout

Flexbox here is the browser's own flexbox. Declaring a container is enough; nothing computes positions.

## Rows of repeated items
The most common defect in generated UI is a list whose columns drift. Structure every repeated row the same way:

  <div style="display:flex;align-items:center;gap:12px;width:100%;">
    <div style="width:28px;flex-shrink:0;">…icon…</div>
    <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;">…text…</div>
    <div style="width:52px;flex-shrink:0;display:flex;justify-content:flex-end;">…control…</div>
  </div>

Fixed-width slots on both ends, a growing middle. Gap alone does not align anything across rows, because each row's text is a different length.

## min-width:0
A flex child will not shrink below its content by default, so one long label pushes the trailing control off the row. min-width:0 on the growing column is what lets text wrap or truncate instead.

## Sizing
- A pixel length is a fixed size.
- 100% fills the parent on that axis.
- Omitting width or height sizes to the content.
Other percentages resolve the way CSS resolves them, against the containing
block. The panel shows a computed pixel number for anything it cannot hold as
a percentage, but what renders is the percentage.

## Frames that clip
Artboard height is a starting point. When content grows past it the frame clips — a half-cut title is the usual symptom. Remove the height so the frame hugs its content, or set the height once you know the real number. Do not guess a bigger one.

## Check the numbers, not the picture
get_layout returns every box plus a flat list of anything overflowing or
clipped, as text. Ask it first. A screenshot costs tokens in proportion to its
pixels and answers a different question — how something looks, not whether it
fits.
`,

  css: `# CSS

This is a real browser. Write the CSS you would write for a web page.

Styles can go in a style attribute or in a <style> block — a stylesheet is
resolved by the browser before parsing, so real page markup can be pasted in
as it stands, class names and all.

Grid works: display:grid, grid-template-columns, gap, justify-items. So do
margin (including collapsing), percentage padding and margins, aspect-ratio,
backdrop-filter, and position:absolute with left/top/right/bottom in pixels
or percentages — all with their ordinary meanings, because the engine
computing them is the same one a browser uses.

The panel has first-class fields for a subset of this, which is what it can
edit by hand; everything else is held as raw CSS on the node and rendered
unchanged. The distinction affects the panel, not the result.

Two places the model, rather than the browser, has the last word:
- A transform renders but does not move the node's recorded position, so
  anything reading geometry sees the untransformed box.
- Nothing is inherited. Set font-size, weight and color on the text node
  itself; a value set on a container above it does not cascade down.

Layout: display:flex, flex-direction, gap, flex-wrap, justify-content, align-items, align-self, flex-grow, flex-shrink, the flex shorthand, padding (and per-side), width, height, min-width, min-height.
Paint: background (colour, linear-gradient, radial-gradient), color, opacity, border, per-side borders, box-shadow, border-radius including per-corner, overflow:hidden, transform:rotate().
Text: font-size, font-weight, line-height, letter-spacing, text-align, color,
font-family, white-space (normal, pre, pre-wrap, nowrap — use nowrap on a
button or chip label so it cannot break onto a second line and overflow).

Images: <img src="/absolute/path/to/photo.jpg"> loads the file straight from
disk. Do NOT base64 a local image into a data URL — the file is read by the
app, so a path costs nothing and keeps the image at full resolution, while
inlining one has to destroy it to fit. Remote https:// URLs work too.

Reuse: <x-clone node-id="f3_abc"/> inserts a deep copy of a node that already
exists, instead of describing it again. Styles on the clone element override
the copy. Twelve identical rows cost twelve lines rather than twelve blocks.
SVG: inline <svg> is kept verbatim — this is how icons and illustrations are drawn. Draw real paths — a placeholder rectangle renders as exactly that.

layer-name="…" names the layer in the user's tree. Unnamed frames all show as "Frame", which makes the layer list unreadable.

ignoredCss lists declarations that did not take effect. It is normally empty,
and it means exactly what it says — a property held as raw CSS rather than a
panel field is rendering, and is not listed. When something is in there, it is
genuinely not there.`,

  icons: `# Icons

Icons are inline <svg>, drawn with real paths, on a 24×24 viewBox:

  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="…" stroke="#111111" stroke-width="1.6"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>

Stroke width and viewBox are yours to choose; what matters mechanically is that the svg carries its own width/height so it holds its slot.

Set the size on the svg element itself (width/height attributes) so it holds its slot, and give the slot flex-shrink:0.

A shape with no path data renders as a plain box, so an icon slot left as a bare div renders as a bare div.`,
};

export function guideTopics() {
  return Object.keys(TOPICS);
}

export function guide(topic) {
  if (!topic) {
    return Object.values(TOPICS).join("\n\n---\n\n");
  }
  return TOPICS[topic] ?? `No guide topic "${topic}". Available: ${guideTopics().join(", ")}.`;
}
