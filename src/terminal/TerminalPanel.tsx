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
 * Character cell size, measured from the same font the terminal renders with.
 *
 * xterm's fit addon reported 441 columns for a panel that visibly fits about
 * 184 — its internal metric disagreed with what it actually drew, and the pty
 * was told the wrong width. Measuring the font directly and calling
 * `term.resize` explicitly keeps the renderer and the pty in agreement by
 * construction instead of trusting a second measurement.
 */
function cellSize(): { width: number; height: number } {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return { width: 8, height: 18 };
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  // A wide glyph in a monospace face is one full advance.
  const width = ctx.measureText("M").width || 8;
  return { width, height: Math.ceil(FONT_SIZE * LINE_HEIGHT) };
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

    /** Size the terminal to the panel, and tell the pty the same numbers. */
    let settled = false;
    const tryFit = (attempt = 0): void => {
      if (disposed) return;
      // clientWidth/Height are the content box and, with overflow hidden,
      // are set by the layout rather than by what xterm has drawn.
      const boxW = host.clientWidth - 24; // horizontal padding
      const boxH = host.clientHeight - 10; // bottom padding
      if (boxW < 40 || boxH < 20) {
        if (attempt < 20) requestAnimationFrame(() => tryFit(attempt + 1));
        return;
      }
      const cell = cellSize();
      const cols = Math.max(20, Math.floor(boxW / cell.width));
      let rows = Math.max(4, Math.floor(boxH / cell.height));
      if (cols === term.cols && rows === term.rows && settled) return;

      term.resize(cols, rows);

      // The measured cell height is an estimate of what xterm will draw with;
      // when it rounds differently the last row is clipped, which hides the
      // agent's own input box. Ask the rendered element instead and shed rows
      // until it genuinely fits.
      const screen = host.querySelector(".xterm-screen") as HTMLElement | null;
      let guard = 0;
      while (screen && rows > 4 && screen.offsetHeight > boxH && guard++ < 8) {
        rows -= 1;
        term.resize(cols, rows);
      }

      onMetrics?.(`${cols}x${rows}`);
      lastSize = { cols, rows };
      settled = true;
      void invoke("pty_resize", { id: SESSION, cols, rows }).catch(() => {});
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
      tryFit();
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
    const resize = () => tryFit();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener("resize", resize);

    return () => {
      disposed = true;
      off.dispose();
      observer.disconnect();
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
