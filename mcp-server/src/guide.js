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

The canvas is real DOM and real CSS. write_html is how you build: you write markup, flexbox lays it out exactly as a browser would, and one call carries a whole visual group rather than a single box. Do not place a design node by node — and do not go the other way and emit the whole screen at once either. See rule 2.

Images: put an absolute file path in <img src>. The app reads the file. Never base64 one into a data URL and never downscale one to make it fit — that destroys the image and costs thousands of tokens for something a path does in forty characters.

Before the first write_html:

1. get_status — the open file, its artboards and their sizes, the fonts already in use, the selection. Artboard width is what tells you whether you are designing a phone or a desktop. Then get_tree_summary for what is on the page.
2. get_font_info on any family you intend to set. A family that is not installed does not error, it silently falls back, and the type you designed is not the type that renders.
3. Decide a palette and a type scale before you build, and say what you chose. Which colours and which sizes are entirely yours — this server has no house style. Choosing once and holding to it is what separates a designed screen from an assembled one.
4. create_artboard for a new screen. It is placed clear of existing work and lays its children out in flow. Prefer it over create_node.

While building:

5. Build ONE visual group per write_html call — a header, a card, one row, a footer. Not a whole screen, and not a whole component: a card with a header, four rows and a footer is six calls. The user is watching the canvas as you work; a design that lands all at once after a minute of silence is a black box they can neither follow nor interrupt. If a single call is getting long, that is the signal to split it.
6. Read ignoredCss in every write_html result. Anything listed there did not take effect.
7. get_layout before get_screenshot. "Did the frame hug its content, is anything clipped, do the columns line up" are questions about numbers, and get_layout answers them as text for a fraction of what an image costs. Screenshot when the question is genuinely how something looks.
8. Check each group before starting the next, against all five: spacing even and rhythmic; hierarchy clear between heading, body and caption; contrast readable at a glance; columns aligned across repeated rows; nothing clipped at a frame edge. Fix what is wrong now, not at the end.

Editing what is already there — all of these keep node ids, so rewriting a section's HTML to change one thing is wasted work and throws away the user's undo history:

9. find_nodes to locate by name, text or type; set_text_content to retext; update_nodes to restyle; move_nodes to restructure; <x-clone node-id="…"/> to repeat a node you already built. focus_node to show the user what you mean. get_jsx when the design needs to become code.

When you stop, call finish_working — including when you stop early or hand back, so the user can tell a finished design from one that stopped halfway.

Two mechanical rules that cause most misalignment here:
- In a row of repeated items, give icons and trailing controls a fixed width with flex-shrink:0, and let the text column take the rest with flex:1 and min-width:0. Gap alone does not align columns across rows.
- A frame with a fixed height clips. If content outgrows it, set sizeH to "auto" so it hugs, rather than guessing a taller number.

The design is yours to make — this server has no house style. Call get_guide: "building" for how to sequence a build, "craft" for what reads as wrong in any style, and the rest for what the renderer supports.`;

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

  craft: `# What reads as wrong in any style

This server has no house style and takes no position on how a design should
look. Minimalism is a style. So is density; so is a strict uniform grid — a
dashboard full of equal cards at equal weight is a deliberate, correct answer
for a dashboard. None of that is prescribed here.

What follows is not taste. It is how human vision works, so it holds whatever
the design is trying to be.

## Hierarchy needs real distance
Heading, body and caption at 24, 18 and 16 are not three levels — they are
three similar greys, and the eye cannot rank them at a glance. Levels have to
differ enough to be told apart without comparing them side by side, in size or
weight or both. How far apart is yours to choose; that they are separable is
not.

## Proximity is grouping
Space is what says which things belong together, and it says it before any
label does. Equal spacing everywhere states that everything is equally
related, which is almost never what a design means. Tighten within a group —
a label and its value, a heading and its subhead — and open up between groups.
If two things are related and spaced like strangers, the reader believes the
spacing.

## Contrast is legibility, not preference
Muted text is a real tool and easy to overspend. Every colour pairing has to
be readable at a glance, without squinting, and small text needs more contrast
than looks necessary at the size you are designing it. This is the one place
where a choice can simply be wrong rather than different: text nobody can read
has failed at the only thing text does.`,

  building: `# How to build here

The canvas is in front of the user while you work. That is the whole reason
this reads the way it does — everything below follows from someone watching.

## One visual group per call
A write_html call should add one thing a person would name: a header, a card,
a single row, a footer. Not a screen. Not a whole component either — a card
with a header, four rows and a footer is six calls, not one.

Two reasons, and the second is the one that matters:

The user sees a design assemble instead of waiting through a minute of nothing
and then being handed a finished page. A build they can watch is one they can
interrupt when it is going the wrong way, which is the only cheap moment to
redirect it.

And you see each group land before you commit to the next. A mistake in the
third of six calls costs one call to fix. The same mistake inside a single
call that built everything costs the whole screen, because there is no way to
fix a part of a call you have already made.

If a call is getting long, that is the signal to split it, not to push on.

## Look at what you built
After each group, check it before moving on:
- get_layout answers "does it fit, did the frame hug, is anything clipped,
  do the columns line up" as text, for a fraction of an image.
- get_screenshot when the question is genuinely how it looks.
- ignoredCss in the write_html result lists declarations that did not take
  effect. It is normally empty; read it when it is not.

Fix what is wrong in the group you just made, while it is one call's worth of
markup, before you build on top of it.

## Edit rather than rewrite
Every write_html result hands back the id of every node it made. Those ids are
how you change one thing without re-emitting the design around it:
- set_text_content to retext, update_nodes to restyle, move_nodes to
  restructure, rename_nodes to label — all keep node identity.
- find_nodes locates something by name, text or type without reading the page.
- <x-clone node-id="…"/> repeats a node you already built instead of
  describing it again.

Rewriting a section's HTML to change one number throws away the user's
selection and undo history along with the nodes.`,

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
