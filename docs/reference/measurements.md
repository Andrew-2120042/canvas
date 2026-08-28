# Reference UI measurements

Taken from Paper's own UI, screenshots in `screenshots/`. Source captures are
3024x1964 physical on a 2x display, so every number below is **CSS px**
(physical / 2). Values are measured from pixel data, not estimated.

Research reference only — see `claude.md`, "Using outside tools to look at
reference UI while building is fine."

## Shell

| Region | Size |
|---|---|
| Tab bar height | **38px** (window top 34 -> bottom border 72) |
| Left panel width | **240px** (1px border at x=240) |
| Toolbar column width | **40px** (x=241..281) |
| Right panel width | **280px** (1px border at x=1231) |

## Left panel

| Element | Size |
|---|---|
| File title row ("Welcome to Paper") | 40px (y=73..113) |
| Design/Theme segmented control | 24px tall |
| Pages row / layer tree row | **28px** |
| Indent per nesting level | ~18-20px (needs confirming at 1.5) |
| Depth-0 disclosure chevron | x=8..11.5 |
| Depth-1 row icon | x=36 |

## Right panel

| Element | Size |
|---|---|
| Collapsed section header row | **33px** (32 + 1px border) |
| Input field height | **26px** |
| Field row pitch | **32px** (26 field + 6 gap) |
| Segmented control (Solid/Gradient/Image) | 24px tall |
| "Copy link" button | 26px tall |

## Colours

| Token | Hex |
|---|---|
| Panel / chrome background | `#2A2A2A` |
| Divider / border | `#373737` |
| Input field background | `#383838` (1px top highlight `#464646`) |
| Segmented control track | `#353535` |
| Layer row hover | `#333333` |
| Selected row background | `#3C3C3C` |
| Toolbar active button | `#444444` |
| Toolbar icon (inactive / active) | `#C4C4C4` / `#EDEDED` |
| Menu highlight | macOS accent blue |
| Primary text | `#EAEAEA` |
| Canvas backdrop (= page fill) | `#999999` |

## Right panel sections are per node type

Sections appear conditionally on what is selected:

| Selection | Sections shown |
|---|---|
| Nothing | Page (fill swatch only) |
| Frame | Layout (collapsible, `Add flex`, `Clip content`), Radius, Blending, Fill, Outline, Border, Shadow, Inner shadow, Filters, **Selection colors** |
| Rectangle | Layout (`Wrap in flex`), Radius, Blending, Fill, Outline, Border, Shadow, Inner shadow, Filters, Export |
| Image / Background | same as Rectangle, Fill switched to Image with thumbnail + pixel dims |
| Text | Layout, Blending, Fill, **Text** (family, weight, size, line-height, letter-spacing, 3 h-align + 3 v-align), Underline, Stroke, Shadow, Filters, **Other styles** (`white-space: pre-wrap` checkbox) |

Note: **no Radius section for text**. Empty sections render as a header row
with a `+` on the right; populated ones expand with controls.

## Layer row states

- Default: icon + name
- Hover: lock and eye icons appear right-aligned
- Locked: filled lock icon stays visible (e.g. `Background`)
- Selected: background `#3C3C3C`

## Still needed

- Exact indent per nesting level
- Hover states for buttons and inputs (layer row hover is captured)

## Font

Use the platform UI stack, per instruction to match what the shell already
uses. Paper appears to ship a custom typeface; not reproducing it.
