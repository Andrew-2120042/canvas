import { useDoc } from "../document/store";
import type { SceneNode } from "../document/types";
import { useViewport } from "../state/viewport";
import { ColorField, NumberField, Section } from "../panels/fields";

/** Shared value across a multi-selection, or null when they disagree. */
function common<T>(nodes: SceneNode[], pick: (n: SceneNode) => T): T | null {
  if (nodes.length === 0) return null;
  const first = pick(nodes[0]);
  return nodes.every((n) => pick(n) === first) ? first : null;
}

/**
 * Properties for the current selection, or the page when nothing is selected.
 *
 * Sections are chosen per node type — the reference varies them by type (text
 * has no radius, frames gain guides, and so on). Phase 1 ships position, size,
 * fill and opacity; the rest register here as they arrive.
 */
export function RightPanel() {
  const zoom = useViewport((s) => s.zoom);
  const doc = useDoc((s) => s.doc);
  const selection = useDoc((s) => s.selection);
  const currentPageId = useDoc((s) => s.currentPageId);

  const nodes = selection
    .map((id) => doc.nodes[id])
    .filter((n): n is SceneNode => !!n);

  const setAll = (patch: Partial<SceneNode>) => {
    const st = useDoc.getState();
    nodes.forEach((n) => st.updateNode(n.id, patch));
  };

  return (
    <aside className="right-panel">
      <div className="right-panel-header">
        <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
      </div>

      {nodes.length === 0 ? (
        <Section title="Page">
          <ColorField
            value={doc.pages[currentPageId].background}
            onCommit={(hex) => useDoc.getState().setPageBackground(currentPageId, hex)}
          />
        </Section>
      ) : (
        <>
          <Section title="Layout">
            <div className="field-row">
              <NumberField label="X" value={common(nodes, (n) => n.x)}
                onCommit={(v) => setAll({ x: v })} />
              <NumberField label="Y" value={common(nodes, (n) => n.y)}
                onCommit={(v) => setAll({ y: v })} />
            </div>
            <div className="field-row">
              <NumberField label="W" value={common(nodes, (n) => n.width)}
                onCommit={(v) => setAll({ width: Math.max(1, v) })} />
              <NumberField label="H" value={common(nodes, (n) => n.height)}
                onCommit={(v) => setAll({ height: Math.max(1, v) })} />
            </div>
          </Section>

          <Section title="Blending">
            <div className="field-row">
              <NumberField
                label="◍"
                value={(() => {
                  const o = common(nodes, (n) => n.opacity);
                  return o === null ? null : Math.round(o * 100);
                })()}
                suffix="%"
                onCommit={(v) => setAll({ opacity: Math.min(100, Math.max(0, v)) / 100 })}
              />
            </div>
          </Section>

          <Section title="Fill">
            <ColorField
              value={common(nodes, (n) => n.fill)}
              onCommit={(hex) => setAll({ fill: hex })}
            />
          </Section>
        </>
      )}
    </aside>
  );
}
