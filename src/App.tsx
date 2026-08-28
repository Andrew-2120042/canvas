import { useDoc } from "./document/store";
import { TabBar } from "./shell/TabBar";
import { LeftPanel } from "./shell/LeftPanel";
import { Toolbar } from "./shell/Toolbar";
import { CanvasRegion } from "./shell/CanvasRegion";
import { RightPanel } from "./shell/RightPanel";
import { Dashboard } from "./shell/Dashboard";
import "./App.css";

export default function App() {
  const showDashboard = useDoc((s) => s.showDashboard);

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
