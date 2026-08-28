import { useDoc } from "../document/store";
import { PlusIcon } from "../ui/icons";

function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "Edited just now";
  if (mins < 60) return `Edited ${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Edited ${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return `Edited ${Math.floor(hrs / 24)} day${hrs < 48 ? "" : "s"} ago`;
}

/**
 * Local file list. The reference's dashboard also carries team, archive,
 * settings and agent panels — those are Phase 4 and later, so they are left
 * out rather than stubbed.
 */
export function Dashboard() {
  const files = useDoc((s) => s.files);
  const fileOrder = useDoc((s) => s.fileOrder);

  return (
    <div className="dashboard">
      <div className="dashboard-head">
        <h1 className="dashboard-title">Recents</h1>
        <button className="new-file-button" onClick={() => useDoc.getState().newFile()}>
          <PlusIcon />
          <span>New file</span>
        </button>
      </div>

      <div className="file-grid">
        {fileOrder.map((id: string) => {
          const f = files[id];
          const nodeCount = Object.keys(f.doc.nodes).length;
          return (
            <button key={id} className="file-card" onClick={() => useDoc.getState().openFile(id)}>
              <div className="file-card-head">
                <span className="file-card-name">{f.name}</span>
                <span className="file-card-meta">{relativeTime(f.updatedAt)}</span>
              </div>
              <div className="file-card-thumb">
                <span className="file-card-count">
                  {nodeCount} layer{nodeCount === 1 ? "" : "s"} ·{" "}
                  {f.doc.pageOrder.length} page{f.doc.pageOrder.length === 1 ? "" : "s"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
