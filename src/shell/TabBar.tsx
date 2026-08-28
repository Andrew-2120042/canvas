import { useDoc } from "../document/store";
import { useUi } from "../state/ui";
import { useViewport } from "../state/viewport";
import { PageIcon, PlusIcon } from "../ui/icons";

/** Prompt glyph for the agent terminal toggle. */
function TerminalGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
         stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M3 4.5 5.5 7 3 9.5M7.5 10h3.5" />
    </svg>
  );
}

/** Grid glyph for the Dashboard tab. */
function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1">
      <rect x="2" y="2" width="4" height="4" rx="0.8" />
      <rect x="8" y="2" width="4" height="4" rx="0.8" />
      <rect x="2" y="8" width="4" height="4" rx="0.8" />
      <rect x="8" y="8" width="4" height="4" rx="0.8" />
    </svg>
  );
}

/**
 * Dashboard tab plus one tab per open file.
 *
 * Sits at the very top of the window: the native title bar is removed
 * (titleBarStyle "Overlay") so the traffic lights sit inside this bar. Empty
 * space drags the window.
 */
export function TabBar() {
  const files = useDoc((s) => s.files);
  const fileOrder = useDoc((s) => s.fileOrder);
  const activeFileId = useDoc((s) => s.activeFileId);
  const showDashboard = useDoc((s) => s.showDashboard);
  const terminalOpen = useUi((s) => s.terminalOpen);

  /** Each file keeps its own viewport, so hand the current one back before
   *  leaving and restore the incoming file's on arrival. */
  const switchTo = (id: string) => {
    const st = useDoc.getState();
    const vp = useViewport.getState();
    st.files[st.activeFileId].viewport = { x: vp.x, y: vp.y, zoom: vp.zoom };
    st.openFile(id);
    const next = useDoc.getState().files[id].viewport;
    useViewport.setState({ x: next.x, y: next.y, zoom: next.zoom });
  };

  return (
    <div className="tabbar" data-tauri-drag-region>
      <button
        className={`tab tab--dashboard${showDashboard ? " is-active" : ""}`}
        onClick={() => useDoc.getState().setShowDashboard(true)}
      >
        <GridIcon />
        <span>Dashboard</span>
      </button>

      {fileOrder.map((id: string) => (
        <button
          key={id}
          className={`tab${!showDashboard && id === activeFileId ? " is-active" : ""}`}
          onClick={() => switchTo(id)}
        >
          <PageIcon />
          <span className="tab-name">{files[id].name}</span>
          {fileOrder.length > 1 && (
            <span
              className="tab-close"
              title="Close"
              onPointerDown={(e) => {
                e.stopPropagation();
                useDoc.getState().closeFile(id);
              }}
            >
              ×
            </span>
          )}
        </button>
      ))}

      <button
        className="tab tab--new"
        title="New file"
        onClick={() => useDoc.getState().newFile()}
      >
        <PlusIcon />
      </button>

      <div className="tabbar-drag" data-tauri-drag-region />

      <button
        className={`tab tab--terminal${terminalOpen ? " is-active" : ""}`}
        title="Agent terminal  ⌘J"
        onClick={() => useUi.getState().toggleTerminal()}
      >
        <TerminalGlyph />
        <span>Agent</span>
      </button>
    </div>
  );
}
