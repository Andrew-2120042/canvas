import { useCallback, useRef, useState } from "react";
import { useUi } from "../state/ui";
import { TerminalPanel, SESSION } from "./TerminalPanel";
import { SelectionTags } from "./SelectionTags";

/** Dock-side glyphs, so the control shows where the panel will go. */
function DockBottomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1">
      <rect x="2" y="2" width="10" height="10" rx="1.5" />
      <path d="M2 8.5h10" />
    </svg>
  );
}
function DockLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1">
      <rect x="2" y="2" width="10" height="10" rx="1.5" />
      <path d="M5.5 2v10" />
    </svg>
  );
}

/**
 * Panel chrome around the terminal: a drag handle, a title strip, the dock
 * switch and the selection chips.
 */
export function TerminalDock() {
  const open = useUi((s) => s.terminalOpen);
  const dock = useUi((s) => s.terminalDock);
  const setDock = useUi((s) => s.setTerminalDock);
  const height = useUi((s) => s.terminalHeight);
  const width = useUi((s) => s.terminalWidth);
  const setHeight = useUi((s) => s.setTerminalHeight);
  const setWidth = useUi((s) => s.setTerminalWidth);
  const toggle = useUi((s) => s.toggleTerminal);
  const [ready, setReady] = useState(false);
  const [metrics, setMetrics] = useState("");
  const dragging = useRef(false);

  const onReady = useCallback(() => setReady(true), []);
  const onMetrics = useCallback((m: string) => setMetrics(m), []);

  if (!open) return null;
  const isLeft = dock === "left";

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    const start = isLeft ? e.clientX : e.clientY;
    const startSize = isLeft ? width : height;
    const move = (m: PointerEvent) => {
      if (!dragging.current) return;
      // The panel grows away from the edge it is docked to.
      if (isLeft) setWidth(startSize + (m.clientX - start));
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
      style={isLeft ? { width } : { height }}
    >
      <div className="terminal-resize" onPointerDown={startResize} />
      <header className="terminal-bar">
        <span className="terminal-title">Agent</span>
        <span className={`terminal-status${ready ? " is-ready" : ""}`}>
          {ready ? metrics || "connected" : "starting"}
        </span>
        <button
          className="terminal-icon-btn"
          title={isLeft ? "Dock to the bottom" : "Dock to the left"}
          onClick={() => setDock(isLeft ? "bottom" : "left")}
        >
          {isLeft ? <DockBottomIcon /> : <DockLeftIcon />}
        </button>
        <button className="terminal-icon-btn" onClick={toggle} title="Hide terminal">
          ×
        </button>
      </header>
      <SelectionTags sessionId={SESSION} />
      <TerminalPanel onReady={onReady} onMetrics={onMetrics} />
    </section>
  );
}
