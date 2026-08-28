import { useDoc } from "../document/store";
import { useUi } from "../state/ui";
import { LayerRow } from "../panels/LayerRow";
import { ChevronIcon, PageIcon, PlusIcon } from "../ui/icons";

/** Title, Design/Theme switcher, Pages list, and the layer tree. */
export function LeftPanel() {
  const doc = useDoc((s) => s.doc);
  const currentPageId = useDoc((s) => s.currentPageId);
  const clearSelection = useDoc((s) => s.clearSelection);
  const { pagesOpen, togglePages, panelTab, setPanelTab } = useUi();

  const page = doc.pages[currentPageId];

  return (
    <aside className="left-panel">
      <div className="panel-title">
        <span className="panel-title-name">Untitled</span>
      </div>

      <div className="segmented">
        <button
          className={panelTab === "design" ? "is-active" : ""}
          onClick={() => setPanelTab("design")}
        >
          Design
        </button>
        <button
          className={panelTab === "theme" ? "is-active" : ""}
          onClick={() => setPanelTab("theme")}
        >
          Theme
        </button>
      </div>

      {panelTab === "theme" ? (
        // Theme is a visual stub until Phase 6.
        <div className="theme-empty">
          <div className="theme-empty-title">Theme tokens</div>
          <div className="theme-empty-body">
            Create tokens to get started.
          </div>
        </div>
      ) : (
        <>
          <div className="section-head">
            <button className="section-chevron" onClick={togglePages} tabIndex={-1}>
              <ChevronIcon open={pagesOpen} />
            </button>
            <span className="section-title">Pages</span>
            <button className="section-action" title="New page" tabIndex={-1}>
              <PlusIcon />
            </button>
          </div>

          {pagesOpen &&
            doc.pageOrder.map((pid) => (
              <div
                key={pid}
                className={`page-row${pid === currentPageId ? " is-selected" : ""}`}
              >
                <span className="layer-icon"><PageIcon /></span>
                <span className="layer-name">{doc.pages[pid].name}</span>
              </div>
            ))}

          <div className="panel-divider" />

          {/* Mirrors the real DOM order: first child paints first, so it
              reads top-down exactly as the document nests. */}
          <div className="layer-tree" onPointerDown={() => clearSelection()}>
            {page.children.map((id) => (
              <LayerRow key={id} id={id} depth={0} />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
