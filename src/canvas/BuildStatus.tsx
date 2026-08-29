import { useActivity } from "../state/activity";

/**
 * What the agent is doing, shown on the canvas rather than only in the panel.
 *
 * The panel can be closed, docked away, or scrolled elsewhere while the agent
 * works — so the canvas says for itself that something is happening to it.
 */
export function BuildStatus() {
  const status = useActivity((a) => a.status);
  const building = useActivity((a) => a.building);
  const count = useActivity((a) => a.touched.length);

  if (!status) return null;

  return (
    <div className={`build-chip${building ? "" : " is-done"}`}>
      <span className="build-dot" />
      <span>{status}</span>
      {count > 0 && (
        <span className="build-count">
          {count} {count === 1 ? "layer" : "layers"}
        </span>
      )}
    </div>
  );
}
