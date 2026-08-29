# Open: panel → terminal handoff

Parked mid-verification. The mechanism is built and the pieces check out
individually; the end-to-end flow in the app is unverified.

## What is known to work

- The agent runs headless behind `--input-format/--output-format stream-json`.
- The conversation id is minted on first use and persisted with the document,
  so it survives a reload and a restart.
- Transcripts are written while a session runs, verified directly.
- The handoff asks the filesystem whether a transcript exists and picks
  `--resume` or `--session-id` accordingly.
- A handoff replaces the pty's process with the agent rather than typing at a
  shell prompt — no line to clear, no control characters to be swallowed.
- Two processes sharing one id do share history: verified at the CLI by
  writing a value in one, reading it from another, and reading both back.

## What is unverified

The same loop inside the app. Repeated attempts to drive it with synthetic
clicks failed because the dock had moved and the clicks landed on stale
coordinates, so no turn ever reached the agent.

## What to check first

Send a message in the Agent panel, confirm a transcript appears at
`~/.claude/projects/<slug>/<id>.jsonl`, then use the handoff. If it fails,
the terminal's own output names the reason.

## A correction worth keeping

An intermediate commit blamed inherited `CLAUDE_*` environment variables for
transcripts not being written. That was wrong: the test behind it had dropped
`--verbose`, so the CLI failed for an unrelated reason. The variables produce
a visible warning and nothing more. They are still cleared, for the warning.
