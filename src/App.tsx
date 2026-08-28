import { useEffect, useState } from "react";
import { useDoc } from "./document/store";
import { loadSaved, startAutosave } from "./document/persist";
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
