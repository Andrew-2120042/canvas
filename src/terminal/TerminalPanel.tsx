import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { terminalTheme } from "./theme";

export const SESSION = "main";

/** The live terminal, so a mention inserted from elsewhere can hand focus
 *  straight back and the user keeps typing without reaching for the mouse. */
let active: Terminal | null = null;
export function focusTerminal(): void {
  active?.focus();
}

/** Last known geometry, so a respawn keeps the same size. */
let lastSize = { cols: 80, rows: 24 };

/**
 * Replace whatever the terminal is running with a specific command.
 *
 * Used for the handoff: the interactive agent becomes the session's own
 * process rather than something typed at a shell prompt, so there is no line
 * to clear and no control characters to be swallowed.
 */
export async function runInTerminal(program: string[], cwd: string): Promise<void> {
  active?.clear();
  await invoke("pty_kill", { id: SESSION }).catch(() => {});
  await invoke("pty_spawn", {
    id: SESSION,
    cols: lastSize.cols,
    rows: lastSize.rows,
    cwd,
    program,
  });
  active?.focus();
}
const FONT_SIZE = 13;
const LINE_HEIGHT = 1.35;
const FONT_FAMILY =
  '"SF Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';

/**
 * Character cell size.
 *
 * Starts as a measurement of the font, then is replaced by what xterm
 * actually drew. Estimates never quite match: the fit addon once reported 441
 * columns for a panel that fits 185, and a font advance is not the same as a
 * rendered cell. Reading the real geometry back removes the guess entirely,
 * so the pty and the renderer cannot disagree.
 */
function estimateCell(): { width: number; height: number } {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return { width: 8, height: 18 };
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  return { width: ctx.measureText("M").width || 8, height: Math.ceil(FONT_SIZE * LINE_HEIGHT) };
}

/** True cell size, read from the rendered screen once there is one. */
function measuredCell(host: HTMLElement, cols: number, rows: number) {
  const screen = host.querySelector(".xterm-screen") as HTMLElement | null;
  if (!screen || cols < 1 || rows < 1) return null;
  const w = screen.offsetWidth / cols;
  const h = screen.offsetHeight / rows;
  // Reject nonsense from a mid-layout read rather than caching it forever.
  if (w < 3 || w > 40 || h < 6 || h > 60) return null;
  return { width: w, height: h };
}

/**
 * A real pty in a panel of this app.
 *
 * xterm.js renders; the shell itself runs behind a Tauri command against
 * portable-pty. Output arrives as events rather than by polling, so the
 * panel tracks a long-running program in real time.
 */
export function TerminalPanel({ onReady, onMetrics }: { onReady?: () => void; onMetrics?: (m: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      theme: terminalTheme,
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      allowProposedApi: true,
      scrollback: 5000,
    });
    term.open(host);
    termRef.current = term;
    active = term;

    let disposed = false;

    let settled = false;
    let cell = estimateCell();

    /** Size the terminal to the panel, and tell the pty the same numbers. */
    const fit = (attempt = 0): void => {
      if (disposed) return;

      // A hidden tab has no size. Fitting against zero would resize the pty
      // to nothing and force the running program to redraw when it reappears.
      if (host.offsetParent === null) return;

      const boxW = host.clientWidth - 24;  // horizontal padding
      const boxH = host.clientHeight - 12; // bottom padding
      if (boxW < 40 || boxH < 20) {
        if (attempt < 20) requestAnimationFrame(() => fit(attempt + 1));
        return;
      }

      // Prefer what xterm actually drew over what the font suggests.
      const real = measuredCell(host, term.cols, term.rows);
      if (real) cell = real;

      const cols = Math.max(20, Math.floor(boxW / cell.width));
      const rows = Math.max(4, Math.floor(boxH / cell.height));
      if (settled && cols === term.cols && rows === term.rows) return;

      term.resize(cols, rows);
      settled = true;
      lastSize = { cols, rows };
      onMetrics?.(`${cols}x${rows}`);
      void invoke("pty_resize", { id: SESSION, cols, rows }).catch(() => {});

      // The first fit runs against an estimate; once there is a rendered
      // screen to measure, correct it exactly once rather than looping.
      if (attempt === 0 && !real) requestAnimationFrame(() => fit(1));
    };

    const unlisteners: Array<() => void> = [];

    void (async () => {
      const offOut = await listen<{ id: string; data: string }>("pty:output", (e) => {
        if (e.payload.id === SESSION) term.write(e.payload.data);
      });
      const offExit = await listen<{ id: string }>("pty:exit", (e) => {
        if (e.payload.id !== SESSION) return;
        term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
        // Leaving the agent should return the shell, not a dead panel.
        void invoke<string>("workspace_dir")
          .then((dir) =>
            invoke("pty_spawn", {
              id: SESSION, cols: lastSize.cols, rows: lastSize.rows, cwd: dir,
            }),
          )
          .catch(() => {});
      });
      unlisteners.push(offOut, offExit);
      if (disposed) return;

      // Wait for the font before measuring, then spawn at a real size.
      try {
        await document.fonts.ready;
      } catch {
        // Font loading is unavailable in some contexts; fall through.
      }
      if (disposed) return;
      fit();
      // Start in the workspace rather than wherever the app happens to be,
      // so the agent has a sensible place to work.
      const cwd = await invoke<string>("workspace_dir").catch(() => undefined);
      lastSize = { cols: term.cols, rows: term.rows };
      await invoke("pty_spawn", { id: SESSION, cols: term.cols, rows: term.rows, cwd });
      onReady?.();
    })();

    const off = term.onData((data) => {
      void invoke("pty_write", { id: SESSION, data }).catch(() => {});
    });

    // Keep the pty's idea of the window in step with the panel, or full-screen
    // programs draw to the wrong size.
    // Coalesce to one fit per frame: a drag fires the observer continuously,
    // and resizing the pty on every event makes the running program redraw
    // over and over, which is what reads as flicker.
    let pending = 0;
    const resize = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        fit();
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener("resize", resize);

    // Coming back from a hidden tab: the size may not have changed, so the
    // resize observer stays quiet, but the renderer skipped every update
    // while it was display:none and needs to be told to repaint.
    const visibility = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      fit();
      try {
        term.refresh(0, term.rows - 1);
      } catch {
        // A refresh against a torn-down renderer is not worth failing over.
      }
    });
    visibility.observe(host);

    return () => {
      disposed = true;
      if (pending) cancelAnimationFrame(pending);
      off.dispose();
      observer.disconnect();
      visibility.disconnect();
      window.removeEventListener("resize", resize);
      unlisteners.forEach((u) => u());
      term.dispose();
      if (active === term) active = null;
      termRef.current = null;
      // The shell keeps running: closing the panel should not lose the
      // session, and it is torn down with the window.
    };
  }, [onReady, onMetrics]);

  return <div className="terminal-host" ref={hostRef} />;
}
