import { TabBar } from "./shell/TabBar";
import { LeftPanel } from "./shell/LeftPanel";
import { CanvasRegion } from "./shell/CanvasRegion";
import { RightPanel } from "./shell/RightPanel";
import "./App.css";

export default function App() {
  return (
    <div className="shell">
      <TabBar />
      <div className="shell-body">
        <LeftPanel />
        <CanvasRegion />
        <RightPanel />
      </div>
    </div>
  );
}
