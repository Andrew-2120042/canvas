import { TabBar } from "./shell/TabBar";
import { LeftPanel } from "./shell/LeftPanel";
import { Toolbar } from "./shell/Toolbar";
import { CanvasRegion } from "./shell/CanvasRegion";
import { RightPanel } from "./shell/RightPanel";
import "./App.css";

export default function App() {
  return (
    <div className="shell">
      <TabBar />
      <div className="shell-body">
        <LeftPanel />
        <Toolbar />
        <CanvasRegion />
        <RightPanel />
      </div>
    </div>
  );
}
