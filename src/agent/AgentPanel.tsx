import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActive } from "../document/store";
import { FrameIcon, ImageIcon, RectIcon, TextIcon } from "../ui/icons";
import { prettyToolName, useAgent, type Block } from "./session";

function ToolGlyph({ type }: { type: string }) {
  switch (type) {
    case "frame": return <FrameIcon />;
    case "text": return <TextIcon />;
    case "image": return <ImageIcon />;
    default: return <RectIcon />;
  }
}

/** Thinking is collapsed by default: present, but not in the way. */
function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="agent-thinking">
      <button className="agent-thinking-head" onClick={() => setOpen(!open)}>
        <span className="agent-dim">Thought</span>
        <span className="agent-dimmer">{open ? "hide" : "briefly"}</span>
      </button>
      {open && <div className="agent-thinking-body">{text}</div>}
    </div>
  );
}

/** A tool call, summarised. The raw arguments are available but folded away. */
function ToolCall({ block }: { block: Extract<Block, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const args = block.input as Record<string, unknown> | undefined;

  // Lead with the argument that says what the call is about.
  const summary =
    (args?.name as string) ||
    (args?.id as string) ||
    (args?.type as string) ||
    "";

  return (
    <div className={`agent-tool is-${block.status}`}>
      <button className="agent-tool-head" onClick={() => setOpen(!open)}>
        <span className="agent-tool-dot" />
        <span className="agent-tool-name">{prettyToolName(block.name)}</span>
        {summary && <span className="agent-tool-summary">{summary}</span>}
        <span className="agent-tool-status">
          {block.status === "running" ? "running" : block.status === "error" ? "failed" : ""}
        </span>
      </button>
      {open && (
        <div className="agent-tool-body">
          <pre>{JSON.stringify(args, null, 2)}</pre>
          {block.result && <pre className="agent-tool-result">{block.result.slice(0, 4000)}</pre>}
        </div>
      )}
    </div>
  );
}

/**
 * The agent as a first-class panel rather than a terminal.
 *
 * The agent runs headless behind a structured event stream, so the app draws
 * the conversation itself — messages, thinking, tool calls — instead of
 * restyling a TUI it does not control.
 */
export function AgentPanel({ cwd }: { cwd: string }) {
  const { running, busy, blocks, info, error, start, send, stop, clear } = useAgent();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const selection = useActive((f) => f.selection);
  const nodes = useActive((f) => f.doc.nodes);

  useEffect(() => {
    if (cwd) void start(cwd);
  }, [cwd, start]);

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks.length, busy]);

  const submit = () => {
    if (!draft.trim()) return;
    void send(draft);
    setDraft("");
  };

  const mention = (id: string) => {
    const n = nodes[id];
    setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${id} `);
    void n; // name is shown on the chip itself
  };

  return (
    <div className="agent-panel">
      <div className="agent-scroll" ref={scrollRef}>
        {blocks.length === 0 && (
          <div className="agent-empty">
            <div className="agent-empty-title">Agent</div>
            <div className="agent-empty-body">
              Ask for a change and it will edit the canvas directly.
            </div>
          </div>
        )}

        {blocks.map((b) => {
          switch (b.kind) {
            case "user":
              return (
                <div key={b.id} className="agent-user">
                  {b.text}
                </div>
              );
            case "text":
              return <div key={b.id} className="agent-text">{b.text}</div>;
            case "thinking":
              return <Thinking key={b.id} text={b.text} />;
            case "tool":
              return <ToolCall key={b.id} block={b} />;
            case "notice":
              return <div key={b.id} className="agent-notice">{b.text}</div>;
            case "result":
              return (
                <div key={b.id} className="agent-result">
                  {b.error ? "ended with an error" : "done"}
                  {b.durationMs !== undefined && ` · ${(b.durationMs / 1000).toFixed(1)}s`}
                  {b.costUsd !== undefined && ` · $${b.costUsd.toFixed(4)}`}
                </div>
              );
          }
        })}

        {busy && <div className="agent-busy"><span /><span /><span /></div>}
      </div>

      {selection.length > 0 && (
        <div className="agent-mentions">
          {selection.slice(0, 5).map((id: string) => {
            const n = nodes[id];
            if (!n) return null;
            return (
              <button key={id} className="selection-tag" onClick={() => mention(id)}
                      title={`Mention ${n.name}`}>
                <span className="selection-tag-icon"><ToolGlyph type={n.type} /></span>
                <span className="selection-tag-name">{n.name}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="agent-composer">
        <textarea
          className="agent-input"
          placeholder="Ask the agent to change the canvas…"
          value={draft}
          rows={2}
          disabled={!running}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Enter sends; Shift+Enter is a newline, as in every chat box.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="agent-composer-bar">
          {/* The agent only announces itself once it has a first message, so
              a running session with no model yet is ready, not connecting. */}
          <span className="agent-model">
            {info.model ?? (running ? "ready" : "starting")}
          </span>
          <span className="agent-spacer" />
          {blocks.length > 0 && (
            <button className="agent-ghost-btn" onClick={clear} title="Clear the transcript">
              Clear
            </button>
          )}
          {busy ? (
            <button className="agent-send is-stop" onClick={() => void stop()} title="Stop">
              <span className="agent-stop-glyph" />
            </button>
          ) : (
            <button className="agent-send" onClick={submit} disabled={!running || !draft.trim()}
                    title="Send  ⏎">
              ↑
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="agent-error">
          {error}
          <button className="agent-ghost-btn" onClick={() => void invoke("agent_start", {})
            .catch(() => {})}>retry</button>
        </div>
      )}
    </div>
  );
}
