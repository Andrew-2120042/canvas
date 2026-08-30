# Tool descriptions — proposed edits

Pillar three of the instruction layer. Most descriptions in `index.js` are
already doing their job; these are the ones that changed my behaviour, or
failed to, when I built a full landing page through this server.

A tool description is not parameter documentation. It is the last thing read
before a call, so it is where a behavioural steer actually lands.

---

## 1. `get_guide` — register the new topic

Adding the `craft` topic to `guide.proposed.js` requires the enum to accept it,
or the topic is unreachable:

```js
inputSchema: {
  topic: z.enum(["design-basics", "craft", "layout", "css", "icons"]).optional(),
},
```

And the description should name what is in it, since the topic list is the
only index the agent gets:

> "How to design well on this canvas: craft, colour, type, spacing, flex
> layout, the exact CSS supported, and how to draw icons. Read this before
> your first build. Omit topic for all of it."

---

## 2. `create_node` — the one description with no steer

Current:

> "Add a node to the current page. Coordinates are relative to parentId when
> given, otherwise to the page."

This is accurate and tells me nothing about when to use it. `write_html` is
the build primitive, but nothing in `create_node` says so, and it is the
lower-effort call for a single element — which is exactly how a design ends
up placed node by node. Proposed:

> "Add one node at a coordinate. This is for a single element in a position
> you have already worked out — a badge, a divider, a spacer. To build
> anything with structure, use write_html instead: it lays out with real
> flexbox, so you describe the arrangement rather than computing it.
> Coordinates are relative to parentId when given, otherwise to the page."

---

## 3. `finish_working` — say that it is expected

Current description is fine but passive. The agent has to already know the
convention exists. Adding "when you stop" to INSTRUCTIONS covers most of it;
making the description imperative closes the rest:

> "Call this when you are done — always, including when you stop early or
> hand back. Clears the working indicator, so the user can tell a finished
> design from one that stopped halfway."

---

## 4. `get_status` — resolve the font list, or say it is unresolved

Not a wording change; a correctness one.

`get_status` reports `fontFamilies` as the families **in use**. On the test
file it listed `"Archivo, ui-sans-serif, system-ui, sans-serif"`, while
`get_font_info` reported Archivo as `available: false`. Both cannot be true.

It is reporting the *requested* stack, not the *resolved* one. Since
INSTRUCTIONS tells the agent that this list is what a new section should
match, the agent will set type in a family that does not exist here — the
precise failure `get_font_info` was built to prevent.

Either resolve each family before reporting it, or mark the ones that fell
back:

```json
"fontFamilies": [
  { "requested": "Archivo, ui-sans-serif, system-ui, sans-serif",
    "resolved": "ui-sans-serif", "fellBack": true },
  { "requested": "Helvetica", "resolved": "Helvetica", "fellBack": false }
]
```

---

## 5. `write_html` — one sentence worth adding

The description is now accurate about CSS support. What it does not carry is
the incremental rule, which currently lives only in INSTRUCTIONS. Paper
states it in both places, and the repetition is deliberate: INSTRUCTIONS is
read once at connection, this is read immediately before every call.

Add near the front:

> "Write incrementally — one visual group per call, so the user sees the
> design appear rather than waiting on a finished screen. A card is a
> container, then its rows, then its footer; not one call."

---

## What is already right, and worth not changing

- **`get_layout`** — states the cost trade against a screenshot, and says
  `ok: true` means the subtree fits. This is the best description in the set
  and has no equivalent in Paper.
- **`set_text_content`** — "use this rather than rewriting HTML" is exactly
  the kind of steer that prevents wasted calls.
- **`update_nodes`** — "prefer this over repeated update_node calls: one
  round trip and one undo step" gives the reason, not just the rule.
- **`create_artboard`** — "prefer this over create_node for a new screen",
  plus the auto-height escape hatch, both land.
- **`get_font_info`** — "a missing family does not error, it silently falls
  back" is the sentence that makes the tool get called.
- **`find_nodes`** — "costs the matches, not the page" is the right framing.

---

## Ordering, if you only do some

1. `get_status` font resolution — a correctness bug, and it actively
   misleads.
2. `get_guide` enum — without it the new topic cannot be fetched.
3. `create_node` — the only description that leaves the wrong default in
   place.
4. `write_html` incremental line and `finish_working` imperative — both
   cheap reinforcement of things INSTRUCTIONS now says.
