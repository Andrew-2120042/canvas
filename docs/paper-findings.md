# What Paper's MCP actually does

Notes from building a full page through Paper's own server — nine sections of
`archimedes-wind/index.html`, checking the stored styles after each write.

## The finding that explains everything

**Paper does not have a node schema that CSS is translated into. A node's style
*is* a CSS object.** Every property written survives, verbatim, and the browser
decides what it means.

Verified by writing deliberately awkward CSS and reading the stored styles back:

| Written | Paper stored |
|---|---|
| `display: grid; grid-template-columns: 1fr 1fr` | kept exactly |
| `font-size: clamp(34px, 4.6vw, 68px)` | kept as the literal `clamp(...)` |
| `height: 100vh` / `min-height: 600px` | kept |
| `background-size: 120%` | kept |
| `background-position: center 82%` | `50% 82%` |
| `margin-top: 12px` | kept |
| `padding: 0 5%` | `paddingInline: 5%` |
| `text-transform: uppercase` | kept |
| `border-radius: 50%` | kept |
| `white-space: nowrap` | kept |

Their guide says "do NOT use margin / grid / tables" — that is **design advice
about their editing UI**, not a parser limitation. The parser takes all of it.

Consequences:

- Paper's `write_html` returns no `ignoredCss` field at all. There is nothing
  to report, because nothing is dropped.
- Shorthands are expanded to longhands rather than collapsed into custom
  fields: `border-top` becomes `borderTopWidth/Style/Color`, `inset` becomes
  `top/right/bottom/left`, `background` becomes
  `backgroundImage/Size/Position/Repeat`.
- Colours in gradients are converted to `oklab`.

## Images

`background: url('paper-asset:///absolute/path.png')` works on **any** element,
and so does `<img src="paper-asset://...">`. Both end up as the same thing: a
node with a `backgroundImage`.

Paper **ingests the file**. The stored URL is not the path that was written —
it is rewritten to Paper's own asset store:

    written:  paper-asset:///Users/…/hero.png
    stored:   https://app.paper.design/file-assets/<file>/<hash>.png

So the document never holds image bytes, and the file survives being moved or
deleted on disk.

Images are also **auto-named from their content**: an `<img>` of a machine came
back as a layer named "Black and white machine". Something is looking at the
picture and naming the layer.

## Other behaviours worth copying

- `create_artboard` places the artboard in the best free spot automatically.
- The prescribed fix for clipped content is `height: "fit-content"` on the
  artboard, never a guessed pixel height.
- `update_styles` returns `ignoredStyles` — the keys that were inert in that
  node's context. That is a per-call answer to "did what I asked land?".
- Text nodes default to `display:inline-block`, `width:max-content`,
  `white-space:pre-wrap`.
- `get_computed_styles` returns resolved `CSSProperties` per node id, batched —
  the correct source when moving a design into code.

## What this means for us

We built an enumerated `SceneNode` and a parser mapping CSS onto it. Anything
the enum did not name was dropped, which is the root of every "silent drop"
bug chased so far — and the reason an agent that writes ordinary CSS sees
nothing appear, retries, and eventually falls back to base64.

The fix is not more fields. It is to stop enumerating: keep real fields only
for what the properties panel edits, and pass everything else through to the
browser untouched.
