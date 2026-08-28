# Right panel — section sets per node type

From `screenshots/10-image-sections.png`, `20`-`25`. Sections render in this
order; an empty one is a header row with `+`, a populated one expands.

| Section | Frame | Shape | Image | Text |
|---|:--:|:--:|:--:|:--:|
| Layout | collapsible (`Layout ⌄`) | fixed | fixed | fixed |
| Flex | `Add flex` | `Wrap in flex` | `Wrap in flex` | `Wrap in flex` |
| Clip content | yes | — | — | — |
| Radius | yes | yes | yes | **no** |
| Blending | yes | yes | yes | yes |
| Fill | yes | yes | yes (Image) | yes |
| Outline | yes | yes | yes | — |
| Border | yes | yes | yes | — |
| Underline | — | — | — | yes |
| Stroke | — | — | — | yes |
| Shadow | yes (4 fields) | yes (4) | yes (4) | yes (**3**) |
| Inner shadow | yes | yes | yes | — |
| Filters | yes | yes | yes | yes |
| Guides | **yes** | — | — | — |
| Other styles | — | — | — | yes |
| Video | **yes** (Pro upsell) | — | — | — |
| Export | yes | yes | yes | yes |
| Selection colors | when it has children | — | — | — |

Text shadow has only X/Y/blur — no spread — because CSS `text-shadow` has no
spread. A direct consequence of the real-DOM/real-CSS bet.

## Control details

- **Layout**: X, Y, angle; W, H (each a dropdown for Fixed/Fit/Fill); rotate,
  flip-h, flip-v; horizontal + vertical constraint dropdowns; 3x3 constraint pad
- **Flex** (when added): direction row/column, 3x3 alignment pad, gap, padding,
  a sliders icon, and `-` to remove
- **Radius**: slider + numeric, plus a per-corner toggle icon
- **Blending**: opacity %, blend mode dropdown, eye
- **Fill**: Solid / Gradient / Image segmented; hex + opacity %; image variant
  shows thumbnail + intrinsic size (`1664x1664`)
- **Outline**: width, offset, colour + opacity
- **Border**: width, side dropdown (`All`), colour + opacity
- **Shadow / Inner shadow**: X, Y, blur, spread, colour + opacity; multiple
  entries allowed (frame screenshot shows two stacked)
- **Text**: family dropdown, weight dropdown, size, line-height, letter-spacing,
  3 horizontal + 3 vertical align buttons
- **Underline**: width, offset (`Auto`), colour
- **Stroke**: width, position dropdown (`Below fill`), colour
- **Filters**: filter-type dropdown (`Blur`) + amount
- **Guides**: type dropdown (`Grid`), size, colour + opacity
- **Other styles**: `white-space: pre-wrap` checkbox
- **Export**: scale dropdown (`2x`), format dropdown (`PNG`), Export button

Most populated rows carry an eye (toggle) and a `-` (remove) on the right;
several headers carry a sliders icon for advanced options.

# Toolbar

`screenshots/30-toolbar.png`, measured against `15-unknown-doubt.png`.

| Metric | Value |
|---|---|
| Column width | 40px |
| Button pitch | **36px** |
| Icon size | 16-18px |
| Active button background | `#444444`, rounded |
| Active icon | `#EDEDED` |
| Inactive icon | `#C4C4C4` |
| Group divider | `#3F3F3F`, ~18px extra spacing |

Order as actually shipped, in three groups:

1. Move (arrow), Pan (hand)
2. Frame, Rectangle, Pen (nib), Text (`Aa`), Plus-in-circle
3. Image + sparkle, Vector/shape + sparkle, Diamond-in-square

Note this differs from the order in `claude.md`, which lists
Move, Pan, Frame, Rectangle, Pen, Text, Image, Shader, Component, Token.

# Layer tree icons

| Type | Icon |
|---|---|
| Frame | dashed corner brackets |
| Frame with flex | two columns |
| Rectangle / shape | hollow square |
| Text | `Aa` |
| Image | picture glyph |

# Canvas

- Fine pixel grid visible at 100% zoom
- Blue dashed alignment guides while dragging
- Selection size badge below selection, e.g. `Fit 404 x 70`
- Zoom % shown top-right of the right panel

---

# Additional node types (later phases)

## SVG (`60`-`63`) — Phase 5

Layer icon: square with corner nodes, labelled `SVG`, expandable.
Sections: Layout, `Wrap in flex`, **Clip content** (checked), Radius, Blending,
Fill, Outline, Border, Shadow, Inner shadow, Filters, **Selection colors**, Export.

## Shader (`50`-`52`) — Phase 8

The diamond toolbar icon is the **shader tool**. It opens a modal picker with a
4-column thumbnail grid: Mesh Gradient, Static Mesh Gradient, Static Radial
Gradient, Dithering, Grain Gradient, Dot Orbit, Dot Grid, Warp, Spiral, Swirl,
Waves, Neuro Noise, Perlin Noise, Simplex Noise, Voronoi, Pulsing Border, more
below the fold.

Panel gains **Presets** (Default / Jungle / Droplet / Swirl) and **Parameters**
(all slider + numeric): Speed, Scale, Rotation, Softness, Density, Distortion,
Stroke width, Stroke taper, Stroke cap, Noise frequency, Noise power, Offset X,
Offset Y — varying per shader — plus a **Foreground** colour, then the normal
Fill/Outline/Border/Shadow/Filters/Video/Export set.

## Selection colors

Not frame-only: appears on any node whose subtree holds colours (frames, SVG).
Rows are `hex + opacity + a count badge`, ordered by usage count descending.

# Gradient fill (`90`)

Selecting the Gradient tab replaces the hex row with:
- a gradient preview bar with draggable end stops and a midpoint diamond
- three gradient-type buttons (linear / radial / angular)
- a sliders icon, a rotate icon, and `+` to add a stop
- one row per stop: colour hex + opacity + `-`

# Filters menu (`91`)

Two groups of the same eight entries: **Layer** (CSS `filter`) and **Backdrop**
(CSS `backdrop-filter`) — Blur, Brightness, Contrast, Grayscale, Hue rotate,
Invert, Saturation, Sepia. Active entry carries a checkmark.

# Theme tab (`40`, `41`) — Phase 6

Empty state: header reads `No tokens` with a search icon and `+`; centred
illustration, "Theme tokens", "Create tokens to get started, or explore the
starter theme.", and a `Create token` button.

`Create token` opens a menu in three groups:
1. Color, Radius
2. Spacing, Container, Breakpoint
3. Font family, Font weight, Font size, Line height, Letter spacing

Matches the token list in `claude.md` Phase 6 exactly.

# Dashboard (`80`) — needed for 1.8

Same tab bar. Left sidebar stays **240px**:
- account row: avatar, name, chevron
- `Search` with `⌘F`
- `Recents` (selected), `Learn`
- divider
- team name, `Files`, `Archive`, `Settings`
- `Upgrade` card, spacer, `Using agents` card with a `Get started` button
- footer `What's new · Feedback`

Main area: `Recents` heading, a light `+ New file` button, grid/list view
toggle, then file cards — title, subtitle (`Edited 29 minutes ago`), owner
avatar, and a thumbnail of the canvas.

Phase 1 needs only: Recents, New file, and the file cards. Team, Archive,
Settings, Upgrade and agents are all out of scope until Phase 4+.
