import { useActive, useDoc } from "../document/store";
import type { SceneNode } from "../document/types";
import { useViewport } from "../state/viewport";
import { CheckRow, ColorField, IconButton, NumberField, Section } from "../panels/fields";
import {
  AlignBottomIcon, AlignHCenterIcon, AlignLeftIcon, AlignRightIcon,
  AlignTopIcon, AlignVCenterIcon, DistributeHIcon, DistributeVIcon,
} from "../ui/icons";
import {
  BorderSection, ExportSection, FiltersSection, GuidesSection, OtherStylesSection,
  OutlineSection, RadiusSection, SelectionColoursSection, ShadowSection,
  TextSection, TextStrokeSection, UnderlineSection,
} from "../panels/sections";

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
  const doc = useActive((f) => f.doc);
  const selection = useActive((f) => f.selection);
  const currentPageId = useActive((f) => f.currentPageId);

  const nodes = (selection as string[])
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
          <Section
            title="Layout"
            action={
              // Align needs two nodes, distribute needs three.
              <div className="align-bar">
                {([
                  ["left", AlignLeftIcon], ["hcenter", AlignHCenterIcon],
                  ["right", AlignRightIcon], ["top", AlignTopIcon],
                  ["vcenter", AlignVCenterIcon], ["bottom", AlignBottomIcon],
                ] as const).map(([edge, Icon]) => (
                  <IconButton
                    key={edge}
                    title={`Align ${edge}`}
                    onClick={() => useDoc.getState().align(selection, edge)}
                  >
                    <span className={nodes.length < 2 ? "is-disabled" : ""}><Icon /></span>
                  </IconButton>
                ))}
                <IconButton
                  title="Distribute horizontally"
                  onClick={() => useDoc.getState().distribute(selection, "h")}
                >
                  <span className={nodes.length < 3 ? "is-disabled" : ""}><DistributeHIcon /></span>
                </IconButton>
                <IconButton
                  title="Distribute vertically"
                  onClick={() => useDoc.getState().distribute(selection, "v")}
                >
                  <span className={nodes.length < 3 ? "is-disabled" : ""}><DistributeVIcon /></span>
                </IconButton>
              </div>
            }
          >
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

          {nodes[0].type !== "text" && (
            <RadiusSection node={nodes[0]} patch={(p) => setAll(p)} />
          )}

          {nodes[0].type === "frame" && (
            <Section title="Clip content">
              <CheckRow
                checked={!!nodes[0].clipContent}
                label="Clip content"
                onToggle={() => setAll({ clipContent: !nodes[0].clipContent })}
              />
            </Section>
          )}

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

          {/* Per-type sections. Editing a multi-selection applies to all, but
              the controls read from the first node — the reference does the
              same rather than trying to merge structured styles. */}
          {(() => {
            const n = nodes[0];
            const patch = (p: Partial<SceneNode>) => setAll(p);
            const isText = n.type === "text";
            const isFrame = n.type === "frame";
            return (
              <>
                {isText ? (
                  <>
                    <TextSection node={n} patch={patch} />
                    <UnderlineSection node={n} patch={patch} />
                    <TextStrokeSection node={n} patch={patch} />
                    <ShadowSection node={n} patch={patch} title="Shadow"
                      field="shadows" withSpread={false} />
                    <FiltersSection node={n} patch={patch} />
                    <OtherStylesSection node={n} patch={patch} />
                  </>
                ) : (
                  <>
                    <OutlineSection node={n} patch={patch} />
                    <BorderSection node={n} patch={patch} />
                    <ShadowSection node={n} patch={patch} title="Shadow"
                      field="shadows" withSpread />
                    <ShadowSection node={n} patch={patch} title="Inner shadow"
                      field="innerShadows" withSpread />
                    <FiltersSection node={n} patch={patch} />
                    {isFrame && <GuidesSection node={n} patch={patch} />}
                  </>
                )}
                {n.children.length > 0 && (
                  <SelectionColoursSection nodeIds={[n.id]} />
                )}
                <ExportSection />
              </>
            );
          })()}
        </>
      )}
    </aside>
  );
}
