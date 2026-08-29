import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUi } from "../state/ui";
import { TerminalPanel, SESSION, runInTerminal } from "./TerminalPanel";
import { SelectionTags } from "./SelectionTags";
import { AgentPanel } from "../agent/AgentPanel";
import { useAgent } from "../agent/session";

function DockBottomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1">
      <rect x="2" y="2" width="10" height="10" rx="1.5" /><path d="M2 8.5h10" />
    </svg>
  );
}
function DockRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1">
      <rect x="2" y="2" width="10" height="10" rx="1.5" /><path d="M8.5 2v10" />
    </svg>
  );
}

/**
 * The dock hosting the agent.
 *
 * Two surfaces share it: the structured agent panel, which the app draws from
 * a headless event stream, and the raw terminal, kept because claude.md's
 * promise is that the user runs whatever agent they already use — and only the
 * pty can host an arbitrary CLI.
 */
export function TerminalDock() {
  const open = useUi((s) => s.terminalOpen);
  const dock = useUi((s) => s.terminalDock);
  const setDock = useUi((s) => s.setTerminalDock);
  const mode = useUi((s) => s.agentMode);
  const setMode = useUi((s) => s.setAgentMode);
  const height = useUi((s) => s.terminalHeight);
  const width = useUi((s) => s.terminalWidth);
  const setHeight = useUi((s) => s.setTerminalHeight);
  const setWidth = useUi((s) => s.setTerminalWidth);
  const toggle = useUi((s) => s.toggleTerminal);

  const [ready, setReady] = useState(false);
  const [metrics, setMetrics] = useState("");
  const [cwd, setCwd] = useState("");
  const dragging = useRef(false);
  const sessionId = useAgent((s) => s.sessionId);
  const reload = useAgent((s) => s.reload);
  /** Set while the terminal holds the conversation, so returning to the
   *  panel picks up whatever happened there. */
  const handedOff = useRef(false);

  const onReady = useCallback(() => setReady(true), []);
  const onMetrics = useCallback((m: string) => setMetrics(m), []);

  useEffect(() => {
    void invoke<string>("workspace_dir").then(setCwd).catch(() => setCwd(""));
  }, []);

  /**
   * Carry a command into the terminal on the same conversation.
   *
   * The panel and the terminal are separate processes and cannot share one,
   * but they can share a *conversation*: the agent runs under an id this app
   * owns, and the terminal resumes that id. So the interactive session opens
   * knowing everything said in the panel, and anything done there is waiting
   * when you come back.
   */
  const handoff = async (command: string) => {
    handedOff.current = true;
    setMode("terminal");

    // Resume only a conversation that is actually on disk. Having sent a
    // message is not proof it was saved, and resuming a missing one fails
    // outright — so ask, then fall back to opening the session under this id.
    const onDisk = await invoke<boolean>("agent_session_exists", {
      cwd,
      sessionId,
    }).catch(() => false);

    const start = onDisk
      ? ["claude", "--resume", sessionId]
      : ["claude", "--session-id", sessionId];

    // Run the agent as the session's own process rather than typing at a
    // shell prompt. Typing fought whatever was already on the line, and the
    // shell inserted control characters literally instead of acting on them.
    await runInTerminal(start, cwd).then(() => {
      // Offer the command at the agent's prompt, unsent, once it is up.
      setTimeout(() => {
        void invoke("pty_write", { id: SESSION, data: command }).catch(() => {});
      }, 2500);
    });
  };

  /** Returning to the panel after a handoff reloads the conversation. */
  const showAgent = () => {
    setMode("agent");
    if (handedOff.current && cwd) {
      handedOff.current = false;
      void reload(cwd);
    }
  };

  if (!open) return null;
  const isSide = dock === "right";

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    const start = isSide ? e.clientX : e.clientY;
    const startSize = isSide ? width : height;
    const move = (m: PointerEvent) => {
      if (!dragging.current) return;
      // The panel grows away from the edge it is docked to.
      if (isSide) setWidth(startSize - (m.clientX - start));
      else setHeight(startSize - (m.clientY - start));
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section
      className={`terminal-dock terminal-dock--${dock}`}
      style={isSide ? { width } : { height }}
    >
      <div className="terminal-resize" onPointerDown={startResize} />

      <header className="terminal-bar">
        <div className="dock-tabs">
          <button
            className={`dock-tab${mode === "agent" ? " is-active" : ""}`}
            onClick={showAgent}
          >
            Agent
          </button>
          <button
            className={`dock-tab${mode === "terminal" ? " is-active" : ""}`}
            onClick={() => setMode("terminal")}
          >
            Terminal
          </button>
        </div>

        <span className="terminal-status">
          {mode === "terminal" && (ready ? metrics : "starting")}
        </span>

        <button
          className="terminal-icon-btn"
          title={isSide ? "Dock to the bottom" : "Dock to the right"}
          onClick={() => setDock(isSide ? "bottom" : "right")}
        >
          {isSide ? <DockBottomIcon /> : <DockRightIcon />}
        </button>
        <button className="terminal-icon-btn" onClick={toggle} title="Hide panel">×</button>
      </header>

      {/* The pty stays mounted while hidden: switching tabs must not kill a
          running shell or lose its scrollback. */}
      <div className="dock-surface" hidden={mode !== "agent"}>
        {cwd && <AgentPanel cwd={cwd} onHandoff={handoff} />}
      </div>
      <div className="dock-surface" hidden={mode !== "terminal"}>
        <SelectionTags sessionId={SESSION} />
        <TerminalPanel onReady={onReady} onMetrics={onMetrics} />
      </div>
    </section>
  );
}
