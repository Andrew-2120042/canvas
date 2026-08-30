import { useEffect, useState } from "react";
import { useDoc } from "./document/store";
import { useUi } from "./state/ui";
import { loadSaved, startAutosave } from "./document/persist";
import { startMcp, stopMcp } from "./mcp/bridge";
import { registerReadTools } from "./mcp/readTools";
import { registerScreenshotTool } from "./mcp/screenshot";
import { registerWriteTools } from "./mcp/writeTools";
import { registerHtmlTool } from "./mcp/htmlTool";
import { registerViewTools } from "./mcp/viewTool";
import { registerReviewTools } from "./mcp/reviewTools";
import { registerFontTools } from "./mcp/fontTools";
import { registerExportTools } from "./mcp/exportTools";
import { registerCompareTools } from "./mcp/compareTools";

// Tool implementations register once, before any connection can call them.
registerReadTools();
registerScreenshotTool();
registerWriteTools();
registerHtmlTool();
registerViewTools();
registerReviewTools();
registerFontTools();
registerExportTools();
registerCompareTools();
import { TabBar } from "./shell/TabBar";
import { LeftPanel } from "./shell/LeftPanel";
import { Toolbar } from "./shell/Toolbar";
import { CanvasRegion } from "./shell/CanvasRegion";
import { RightPanel } from "./shell/RightPanel";
import { Dashboard } from "./shell/Dashboard";
import { TerminalDock } from "./terminal/TerminalDock";
import "./App.css";

export default function App() {
  const showDashboard = useDoc((s) => s.showDashboard);
  const dockSide = useUi((s) => s.terminalDock === "right" && s.terminalOpen);
  const panelsHidden = useUi((s) => s.panelsHidden);
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
        <>
          <div
            className={
              `shell-body${dockSide ? " has-side-dock" : ""}` +
              `${panelsHidden ? " panels-hidden" : ""}`
            }
          >
            {!panelsHidden && <LeftPanel />}
            <Toolbar />
            <CanvasRegion />
            {!panelsHidden && <RightPanel />}
            {dockSide && <TerminalDock />}
          </div>
          {!dockSide && <TerminalDock />}
        </>
      )}
    </div>
  );
}
