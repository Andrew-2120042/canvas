import { useViewport } from "../state/viewport";

/** Position/size/fill/opacity for the selection. Built in 1.6. */
export function RightPanel() {
  const zoom = useViewport((s) => s.zoom);

  return (
    <aside className="right-panel">
      <div className="right-panel-header">
        <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
      </div>
    </aside>
  );
}
