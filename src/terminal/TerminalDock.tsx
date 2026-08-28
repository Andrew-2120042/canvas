import { useCallback, useRef, useState } from "react";
import { useUi } from "../state/ui";
import { TerminalPanel } from "./TerminalPanel";

/**
 * Panel chrome around the terminal: a drag handle, a title strip and a close
 * control, styled from the app's own tokens so the panel reads as part of the
 * app rather than an emulator dropped into it.
 */
export function TerminalDock() {
  const open = useUi((s) => s.terminalOpen);
  const height = useUi((s) => s.terminalHeight);
  const setHeight = useUi((s) => s.setTerminalHeight);
  const toggle = useUi((s) => s.toggleTerminal);
  const [ready, setReady] = useState(false);
  const [metrics, setMetrics] = useState("");
  const dragging = useRef(false);

  const onReady = useCallback(() => setReady(true), []);
  const onMetrics = useCallback((m: string) => setMetrics(m), []);

  if (!open) return null;

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startY = e.clientY;
    const startH = height;
    const move = (m: PointerEvent) => {
      if (dragging.current) setHeight(startH - (m.clientY - startY));
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
    <section className="terminal-dock" style={{ height }}>
      <div className="terminal-resize" onPointerDown={startResize} />
      <header className="terminal-bar">
        <span className="terminal-title">Agent</span>
        <span className={`terminal-status${ready ? " is-ready" : ""}`}>
          {ready ? "connected" : "starting"}{metrics ? ` · ${metrics}` : ""}
        </span>
        <button className="terminal-close" onClick={toggle} title="Hide terminal">
          ×
        </button>
      </header>
      <TerminalPanel onReady={onReady} onMetrics={onMetrics} />
    </section>
  );
}
