import {
  BaseDirectory, exists, mkdir, readTextFile, writeTextFile,
} from "@tauri-apps/plugin-fs";
import { useDoc, type FileId, type FileState } from "./store";
import { useViewport } from "../state/viewport";
import { useUi } from "../state/ui";
import { useAgent } from "../agent/session";

const DIR = "canvas";
const PATH = `${DIR}/state.json`;
const VERSION = 1;
/** Quiet period after the last edit before writing. */
const DEBOUNCE_MS = 600;

interface PersistedState {
  version: number;
  files: Record<FileId, FileState>;
  fileOrder: FileId[];
  activeFileId: FileId;
  /** Panel layout. Where someone put their panels is part of their workspace,
   *  not a transient; losing it on every launch is its own small annoyance. */
  /** The agent conversation, so the terminal can still resume it after a
   *  restart and a reload does not strand it. */
  agentSessionId?: string;
  layout?: {
    terminalOpen: boolean;
    terminalDock: "bottom" | "right";
    agentMode: "agent" | "terminal";
    panelsHidden: boolean;
    terminalHeight: number;
    terminalWidth: number;
  };
}

/** The live viewport lives in its own store; fold it back into the active
 *  file so what gets written matches what is on screen. */
function snapshot(): PersistedState {
  const s = useDoc.getState();
  const vp = useViewport.getState();
  const files = {
    ...s.files,
    [s.activeFileId]: {
      ...s.files[s.activeFileId],
      viewport: { x: vp.x, y: vp.y, zoom: vp.zoom },
    },
  };
  const ui = useUi.getState();
  return {
    version: VERSION,
    agentSessionId: useAgent.getState().sessionId || undefined,
    files,
    fileOrder: s.fileOrder,
    activeFileId: s.activeFileId,
    layout: {
      terminalOpen: ui.terminalOpen,
      terminalDock: ui.terminalDock,
      agentMode: ui.agentMode,
      panelsHidden: ui.panelsHidden,
      terminalHeight: ui.terminalHeight,
      terminalWidth: ui.terminalWidth,
    },
  };
}

export async function saveNow(): Promise<void> {
  const json = JSON.stringify(snapshot());
  await mkdir(DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(PATH, json, { baseDir: BaseDirectory.AppData });
}

/** Cheap structural check. A half-written or hand-edited file should start a
 *  fresh session, never crash the app on launch. */
function isValid(v: unknown): v is PersistedState {
  if (!v || typeof v !== "object") return false;
  const s = v as PersistedState;
  if (s.version !== VERSION) return false;
  if (!s.files || typeof s.files !== "object") return false;
  if (!Array.isArray(s.fileOrder) || s.fileOrder.length === 0) return false;
  if (!s.files[s.activeFileId]) return false;
  return s.fileOrder.every((id) => {
    const f = s.files[id];
    return (
      f && f.doc && typeof f.doc.nodes === "object" &&
      typeof f.doc.pages === "object" && Array.isArray(f.doc.pageOrder) &&
      f.doc.pages[f.currentPageId] !== undefined
    );
  });
}

export async function loadSaved(): Promise<boolean> {
  try {
    if (!(await exists(PATH, { baseDir: BaseDirectory.AppData }))) return false;
    const raw = await readTextFile(PATH, { baseDir: BaseDirectory.AppData });
    const parsed: unknown = JSON.parse(raw);
    if (!isValid(parsed)) {
      console.warn("[persist] saved state unusable; starting fresh");
      return false;
    }
    useDoc.setState({
      files: parsed.files,
      fileOrder: parsed.fileOrder,
      activeFileId: parsed.activeFileId,
      showDashboard: false,
    });
    const vp = parsed.files[parsed.activeFileId].viewport;
    useViewport.setState({ x: vp.x, y: vp.y, zoom: vp.zoom });
    if (parsed.layout) useUi.setState(parsed.layout);
    if (parsed.agentSessionId) {
      useAgent.setState({ sessionId: parsed.agentSessionId });
    }
    return true;
  } catch (err) {
    console.warn("[persist] load failed; starting fresh", err);
    return false;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function schedule() {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    dirty = false;
    void saveNow().catch((e) => console.warn("[persist] save failed", e));
  }, DEBOUNCE_MS);
}

/** Autosave on every document change, plus a final flush on the way out so a
 *  quit inside the debounce window does not lose the last edit. */
export function startAutosave(): () => void {
  const unsubDoc = useDoc.subscribe(schedule);
  const unsubView = useViewport.subscribe(schedule);
  const unsubUi = useUi.subscribe(schedule);
  const unsubAgent = useAgent.subscribe(schedule);

  const flush = () => {
    if (!dirty) return;
    if (timer) clearTimeout(timer);
    timer = null;
    dirty = false;
    void saveNow();
  };
  window.addEventListener("beforeunload", flush);
  window.addEventListener("blur", flush);

  return () => {
    unsubDoc();
    unsubView();
    unsubUi();
    unsubAgent();
    window.removeEventListener("beforeunload", flush);
    window.removeEventListener("blur", flush);
  };
}
