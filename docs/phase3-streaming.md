# Phase 3 — live agent builds

## What streams

Structured tool calls, not HTML.

The plan described streaming markup into frames. That was reconsidered and
dropped, for one decisive reason and two supporting ones:

- **It reopens the subtree-splice problem.** Streaming HTML means repeatedly
  re-parsing a chunk of text and replacing a subtree as more arrives. That is
  exactly what the flat node map in 1.3 exists to prevent, and in Phase 4 a
  human editing inside that frame mid-stream would have their work silently
  replaced by the next chunk.
- **It needs a healing subsystem** — tag balancing, cutting unclosed
  `<script>`, auto-closing `<style>`. Structured calls have no equivalent
  problem: there is no half-written `create_node`.
- **It is lossy.** HTML and CSS are unbounded; the node schema is enumerated.
  Flexbox and grid have no representation in it today.

The visual payoff was never tied to the format. A pulsing border and a status
chip render the same whether they react to arriving markup or arriving tool
calls — so the build plays out from the structured writes that already exist,
with no parser, no healing, and no second document representation.

HTML is not abandoned, only relocated: as a **one-shot import** (Phase 10) it
is atomic, needs no healing, and splices once. Everything expensive about it
came from the streaming, not the format.

## What is paced

Appearance, not the document.

Writes land in the store immediately, so an agent reading the canvas back
always sees what it just wrote, ids are returned correctly, and undo behaves.
What is staggered is how nodes *appear*: each arrival is delayed by its
position in the queue, so a burst of tool calls plays as a build instead of
snapping to the finished state in one frame.

The tradeoff is that the layer tree updates immediately while the canvas
fills in over about a second. That is the safe side of the trade: the
alternative is a queue that can serve an agent a canvas missing its own work.

## Undo

One press per build. See `src/mcp/buildScope.ts`.

A build is one instruction that happened to produce many writes. Time-based
coalescing could not express this — an agent may pause longer than any
sensible window, so the same instruction would undo differently depending on
how fast it thought. Builds are an explicit scope: opened by the first write,
closed when the turn ends, and closed by an idle timer if no end arrives.

## Feedback

- **Entrance animation** on nodes the agent just created, staggered.
- **Pulsing border** on nodes in the build still in progress.
- **Status chip** on the canvas — the panel can be closed or docked away, so
  the canvas says for itself that something is happening to it.

All of it lives in `src/state/activity.ts`, deliberately outside the
document: it is presentation, and none of it should be persisted, undone or
synced.
