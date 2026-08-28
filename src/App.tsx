import { useEffect, useState } from "react";
import { useDoc } from "./document/store";
import { loadSaved, startAutosave } from "./document/persist";
import { startMcp, stopMcp } from "./mcp/bridge";
import { registerReadTools } from "./mcp/readTools";
import { registerScreenshotTool } from "./mcp/screenshot";
import { registerWriteTools } from "./mcp/writeTools";

// Tool implementations register once, before any connection can call them.
registerReadTools();
registerScreenshotTool();
registerWriteTools();
import { TabBar } from "./shell/TabBar";
import { LeftPanel } from "./shell/LeftPanel";
import { Toolbar } from "./shell/Toolbar";
import { CanvasRegion } from "./shell/CanvasRegion";
import { RightPanel } from "./shell/RightPanel";
import { Dashboard } from "./shell/Dashboard";
import "./App.css";

export default function App() {
  const showDashboard = useDoc((s) => s.showDashboard);
  const [ready, setReady] = useState(false);

  // Restore before the first paint of real content, then start autosaving.
  // Autosave only arms after the load so restoring cannot itself trigger a
  // write of the default document over the saved one.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void loadSaved().finally(() => {
      setReady(true);
      stop = startAutosave();
    });
    return () => stop?.();
  }, []);

  // The MCP server runs while a file is open, not as an always-on service.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void startMcp()
      .then((port) => { if (!cancelled) console.info(`[mcp] serving on port ${port}`); })
      .catch((e) => console.warn("[mcp] could not start:", e));
    return () => {
      cancelled = true;
      void stopMcp().catch(() => {});
    };
  }, [ready]);

  if (!ready) return <div className="shell" />;

  return (
    <div className="shell">
      <TabBar />
      {showDashboard ? (
        <Dashboard />
      ) : (
        <div className="shell-body">
          <LeftPanel />
          <Toolbar />
          <CanvasRegion />
          <RightPanel />
        </div>
      )}
    </div>
  );
}
