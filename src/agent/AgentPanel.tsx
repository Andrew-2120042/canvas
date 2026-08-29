import { useEffect, useMemo, useRef, useState } from "react";
import { useActive } from "../document/store";
import { FrameIcon, ImageIcon, RectIcon, TextIcon } from "../ui/icons";
import { Markdown } from "./markdown";
import { prettyToolName, useAgent, type Block } from "./session";
import { ModelPicker } from "./ModelPicker";

/** Models offered before the agent has told us its own list. */
const DEFAULT_MODELS = ["opus", "sonnet", "haiku", "fable", "best", "default"];

function TypeGlyph({ type }: { type: string }) {
  switch (type) {
    case "frame": return <FrameIcon />;
    case "text": return <TextIcon />;
    case "image": return <ImageIcon />;
    default: return <RectIcon />;
  }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
         stroke="currentColor" strokeWidth="1.3"
         style={{ transform: open ? "rotate(90deg)" : undefined }}>
      <path d="M3.5 2 6.5 5 3.5 8" />
    </svg>
  );
}

/** Thinking reads as a line of narrative, not a boxed aside. */
function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ag-step">
      <button className="ag-step-head" onClick={() => setOpen(!open)}>
        <span className="ag-label">Thought</span>
        <span className="ag-meta">briefly</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="ag-step-detail">
          {text.split("\n").filter((l) => l.trim()).map((l, i) => (
            <div key={i} className="ag-detail-line">{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A tool call as one line of activity: what happened, to what. */
function ToolStep({ block }: { block: Extract<Block, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const args = block.input as Record<string, unknown> | undefined;
  const subject =
    (args?.name as string) || (args?.id as string) || (args?.type as string) || "";

  return (
    <div className="ag-step">
      <button className="ag-step-head" onClick={() => setOpen(!open)}>
        <span className={`ag-dot is-${block.status}`} />
        <span className="ag-label">{prettyToolName(block.name)}</span>
        {subject && <span className="ag-meta">{subject}</span>}
        {block.status === "error" && <span className="ag-meta is-error">failed</span>}
        <Chevron open={open} />
      </button>
      {open && (
        <div className="ag-step-detail">
          <pre className="ag-pre">{JSON.stringify(args, null, 2)}</pre>
          {block.result && <pre className="ag-pre is-result">{block.result.slice(0, 4000)}</pre>}
        </div>
      )}
    </div>
  );
}

/**
 * The agent panel: a conversation the app renders itself from a structured
 * event stream, laid out as a running narrative rather than a stack of cards.
 */
export function AgentPanel({ cwd }: { cwd: string }) {
  const { running, busy, blocks, info, models, error, start, send, stop, clear } = useAgent();
  /**
   * Choices always surface in one place: attached above the composer, never
   * inline in the transcript. A prompt buried in scrollback is a prompt that
   * scrolls away mid-answer.
   */
  const [choice, setChoice] = useState<{ command?: string; options: string[] } | null>(null);
  /** Blocks whose choices have already been offered or dismissed. */
  const seenChoices = useRef(new Set<string>());
  const [draft, setDraft] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  /** Escape dismisses the command menu without discarding what was typed. */
  const [menuDismissed, setMenuDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selection = useActive((f) => f.selection);
  const nodes = useActive((f) => f.doc.nodes);

  useEffect(() => { if (cwd) void start(cwd); }, [cwd, start]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks.length, busy]);

  // Raise the newest set of choices to the composer, once.
  useEffect(() => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.kind !== "text" || !b.options?.length) continue;
      if (seenChoices.current.has(b.id)) break;
      seenChoices.current.add(b.id);
      setChoice({ command: b.optionCommand, options: b.options });
      break;
    }
  }, [blocks]);

  // Slash commands, offered as soon as the draft is a bare "/word".
  const slashQuery = /^\/(\S*)$/.exec(draft);
  const commands = useMemo(() => {
    if (!slashQuery || menuDismissed) return [];
    const q = slashQuery[1].toLowerCase();
    return (info.slashCommands ?? [])
      .filter((c) => c.toLowerCase().startsWith(q))
      .slice(0, 8);
  }, [slashQuery, info.slashCommands, menuDismissed]);

  useEffect(() => { setMenuIndex(0); setMenuDismissed(false); }, [draft]);

  const submit = (text = draft) => {
    if (!text.trim()) return;
    setChoice(null); // any open prompt is answered or abandoned by sending
    void send(text);
    setDraft("");
  };

  const choose = (option: string) =>
    submit(choice?.command ? `/${choice.command} ${option}` : option);

  const pickCommand = (cmd: string) => {
    setDraft(`/${cmd} `);
    inputRef.current?.focus();
  };

  const mention = (id: string) =>
    setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${id} `);

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
              return <div key={b.id} className="agent-user">{b.text}</div>;
            case "text":
              return (
                <div key={b.id} className="agent-text"><Markdown text={b.text} /></div>
              );
            case "thinking":
              return <Thinking key={b.id} text={b.text} />;
            case "tool":
              return <ToolStep key={b.id} block={b} />;
            case "notice":
              return <div key={b.id} className="ag-meta">{b.text}</div>;
            case "result":
              return (
                <div key={b.id} className="ag-meta">
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
                <span className="selection-tag-icon"><TypeGlyph type={n.type} /></span>
                <span className="selection-tag-name">{n.name}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="agent-composer-wrap">
        {choice && (
          <div className="ag-attached">
            {choice.command === "model" ? (
              <ModelPicker
                models={choice.options}
                current={info.model}
                onPick={choose}
                onCancel={() => setChoice(null)}
              />
            ) : (
              <div className="ag-choice-card">
                <div className="mp-head">
                  <span className="mp-title">
                    {choice.command ? `/${choice.command}` : "Choose"}
                  </span>
                  <button className="mp-close" onClick={() => setChoice(null)}>×</button>
                </div>
                <div className="ag-options">
                  {choice.options.map((opt) => (
                    <button key={opt} className="ag-option" onClick={() => choose(opt)}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {commands.length > 0 && (
          <div className="ag-slash-menu">
            {commands.map((c, i) => (
              <button
                key={c}
                className={`ag-slash-item${i === menuIndex ? " is-active" : ""}`}
                onMouseEnter={() => setMenuIndex(i)}
                onClick={() => pickCommand(c)}
              >
                /{c}
              </button>
            ))}
          </div>
        )}

        <div className="agent-composer">
          <textarea
            ref={inputRef}
            className="agent-input"
            placeholder="Ask the agent to change the canvas…"
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (commands.length > 0) {
                // While the menu is up, the arrows and Enter belong to it.
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMenuIndex((i) => (i + 1) % commands.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMenuIndex((i) => (i - 1 + commands.length) % commands.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  pickCommand(commands[menuIndex]);
                  return;
                }
                if (e.key === "Escape") {
                  // Close the menu, keep the text — losing a half-typed
                  // message to a dismissal is its own small betrayal.
                  e.preventDefault();
                  setMenuDismissed(true);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="agent-composer-bar">
            <div className="ag-model-wrap">
              <button
                className="ag-model-btn"
                onClick={() =>
                  setChoice((c) =>
                    c?.command === "model"
                      ? null
                      : { command: "model", options: models.length ? models : DEFAULT_MODELS },
                  )
                }
                title="Change model"
              >
                {info.model ?? (running ? "ready" : "starting")}
                <Chevron open={choice?.command === "model"} />
              </button>
            </div>
            <span className="agent-spacer" />
            {blocks.length > 0 && (
              <button className="agent-ghost-btn" onClick={clear}>Clear</button>
            )}
            {busy ? (
              <button className="agent-send is-stop" onClick={() => void stop()} title="Stop">
                <span className="agent-stop-glyph" />
              </button>
            ) : (
              <button className="agent-send" onClick={() => submit()}
                      disabled={!draft.trim()} title="Send  ⏎">↑</button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="agent-error">{error}</div>}
    </div>
  );
}
