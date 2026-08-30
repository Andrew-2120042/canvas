/**
 * What the agent is told about designing on this canvas.
 *
 * The tools were never the thing holding output quality back. The same model
 * given the same task produces a polished screen or a rough one depending
 * almost entirely on whether it was told to work like a designer: decide a
 * palette and a type scale before drawing, build one group at a time, look at
 * what it made, and fix what does not sit right. None of that is discoverable
 * from a tool schema, so it is stated here.
 *
 * INSTRUCTIONS is sent once at connection and is deliberately short — it is
 * spent on every request, so it carries only what changes behaviour. The
 * guide topics carry the depth and are fetched when relevant.
 */

export const INSTRUCTIONS = `This server is a design canvas. The user is watching it change as you work.

The canvas is real DOM and real CSS. write_html is how you build: one call carries a whole component, and flexbox lays it out exactly as a browser would. Do not place a design node by node.

Images: put an absolute file path in <img src>. The app reads the file. Never base64 one into a data URL and never downscale one to make it fit — that destroys the image and costs thousands of tokens for something a path does in forty characters.

How to work here:

1. Read first — get_tree_summary for the page, get_selection for what the user is looking at.
2. Build one visual group per write_html call — a header, a card, a list. Not a whole screen in one shot. The user is watching it appear.
3. Look at what you made. get_screenshot after each group and check it actually rendered as intended: nothing clipped, nothing overlapping, columns lining up between rows. Fix it before moving on.
4. Read ignoredCss in every write_html result. Anything listed there did not take effect.
5. get_layout before get_screenshot. "Did the frame hug its content, is anything clipped, do the columns line up" are questions about numbers, and get_layout answers them as text for a fraction of what an image costs. Screenshot when the question is genuinely how something looks.
6. find_nodes to locate something by name, text or type — it costs the matches, not the page. Reach for it before get_canvas_state.
7. move_nodes to restructure and set_text_content to retext — both keep node ids, so rewriting HTML for either is wasted work.
8. focus_node to show the user what you are talking about.
9. get_jsx when the design needs to become code — it emits the same styles the canvas renders with.

Two mechanical rules that cause most misalignment here:
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

## Write ordinary CSS
This canvas renders real DOM with real CSS. Properties without special
handling are passed to the browser unchanged, so they behave exactly as they
would on a web page — display:grid, margin, padding:0 5%, background:url(...),
and anything else you would normally reach for.

ignoredCss lists only what genuinely could not be applied, and is normally
empty. Read it when it is not.`,

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
