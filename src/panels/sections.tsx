import { useActive } from "../document/store";
import {
  FILTER_FNS, selectionColours,
  type BorderSide, type FilterStyle, type ShadowStyle,
} from "../document/style";
import type { SceneNode } from "../document/types";
import { EyeIcon, PlusIcon } from "../ui/icons";
import {
  CheckRow, ColorField, IconButton, NumberField, Section, SelectField, SliderField,
} from "./fields";

/** Defaults taken from the reference UI's own initial values. */
export const DEFAULTS = {
  outline: { width: 1, offset: 0, color: "#000000", opacity: 1, visible: true },
  border: { width: 1, side: "All" as BorderSide, color: "#000000", opacity: 1, visible: true },
  shadow: { x: 0, y: 2, blur: 3, spread: 0, color: "#000000", opacity: 0.2, visible: true },
  filter: { fn: "Blur" as const, amount: 4, backdrop: false, visible: true },
  underline: { width: 1, offset: null, color: "#000000", opacity: 1, visible: true },
  textStroke: { width: 1, position: "Below fill" as const, color: "#000000", opacity: 1, visible: true },
  guides: { kind: "Grid" as const, size: 8, color: "#003880", opacity: 0.1, visible: true },
};

type Patch = (patch: Partial<SceneNode>) => void;

const Minus = () => <span className="glyph-minus">−</span>;

function AddRemove({ present, onAdd, onRemove }: {
  present: boolean; onAdd: () => void; onRemove: () => void;
}) {
  return present ? (
    <IconButton title="Remove" onClick={onRemove}><Minus /></IconButton>
  ) : (
    <IconButton title="Add" onClick={onAdd}><PlusIcon /></IconButton>
  );
}

/** An empty section is just a header with a `+`, as in the reference. */
export function OutlineSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  const o = node.outline;
  return (
    <Section
      title="Outline"
      action={
        <AddRemove
          present={!!o}
          onAdd={() => patch({ outline: { ...DEFAULTS.outline } })}
          onRemove={() => patch({ outline: undefined })}
        />
      }
    >
      {o && (
        <>
          <div className="field-row">
            <NumberField label="≡" value={o.width}
              onCommit={(v) => patch({ outline: { ...o, width: Math.max(0, v) } })} />
            <NumberField label="⊡" value={o.offset}
              onCommit={(v) => patch({ outline: { ...o, offset: v } })} />
            <IconButton title="Toggle" active={o.visible}
              onClick={() => patch({ outline: { ...o, visible: !o.visible } })}>
              <EyeIcon off={!o.visible} />
            </IconButton>
          </div>
          <ColorField value={o.color} opacity={o.opacity}
            onCommit={(c) => patch({ outline: { ...o, color: c } })}
            onOpacityCommit={(a) => patch({ outline: { ...o, opacity: a } })} />
        </>
      )}
    </Section>
  );
}

export function BorderSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  const b = node.border;
  return (
    <Section
      title="Border"
      action={
        <AddRemove
          present={!!b}
          onAdd={() => patch({ border: { ...DEFAULTS.border } })}
          onRemove={() => patch({ border: undefined })}
        />
      }
    >
      {b && (
        <>
          <div className="field-row">
            <NumberField label="≡" value={b.width}
              onCommit={(v) => patch({ border: { ...b, width: Math.max(0, v) } })} />
            <SelectField value={b.side}
              options={["All", "Top", "Right", "Bottom", "Left"] as const}
              onCommit={(side) => patch({ border: { ...b, side } })} />
            <IconButton title="Toggle" active={b.visible}
              onClick={() => patch({ border: { ...b, visible: !b.visible } })}>
              <EyeIcon off={!b.visible} />
            </IconButton>
          </div>
          <ColorField value={b.color} opacity={b.opacity}
            onCommit={(c) => patch({ border: { ...b, color: c } })}
            onOpacityCommit={(a) => patch({ border: { ...b, opacity: a } })} />
        </>
      )}
    </Section>
  );
}

/** Shadow and inner shadow share everything but the key and the spread field. */
export function ShadowSection({
  node, patch, title, field, withSpread,
}: {
  node: SceneNode;
  patch: Patch;
  title: string;
  field: "shadows" | "innerShadows";
  withSpread: boolean;
}) {
  const list = node[field] ?? [];
  const write = (next: ShadowStyle[]) =>
    patch({ [field]: next.length ? next : undefined } as Partial<SceneNode>);
  const update = (i: number, s: ShadowStyle) =>
    write(list.map((old, j) => (j === i ? s : old)));

  return (
    <Section
      title={title}
      action={
        <IconButton title="Add" onClick={() => write([...list, { ...DEFAULTS.shadow }])}>
          <PlusIcon />
        </IconButton>
      }
    >
      {list.map((s, i) => (
        <div key={i}>
          <div className="field-row">
            <NumberField label="X" value={s.x} onCommit={(v) => update(i, { ...s, x: v })} />
            <NumberField label="Y" value={s.y} onCommit={(v) => update(i, { ...s, y: v })} />
            <NumberField label="◌" value={s.blur} onCommit={(v) => update(i, { ...s, blur: Math.max(0, v) })} />
            {withSpread && (
              <NumberField label="⊡" value={s.spread} onCommit={(v) => update(i, { ...s, spread: v })} />
            )}
            <IconButton title="Toggle" active={s.visible}
              onClick={() => update(i, { ...s, visible: !s.visible })}>
              <EyeIcon off={!s.visible} />
            </IconButton>
            <IconButton title="Remove" onClick={() => write(list.filter((_, j) => j !== i))}>
              <Minus />
            </IconButton>
          </div>
          <ColorField value={s.color} opacity={s.opacity}
            onCommit={(c) => update(i, { ...s, color: c })}
            onOpacityCommit={(a) => update(i, { ...s, opacity: a })} />
        </div>
      ))}
    </Section>
  );
}

export function FiltersSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  const list = node.filters ?? [];
  const write = (next: FilterStyle[]) =>
    patch({ filters: next.length ? next : undefined });
  const update = (i: number, f: FilterStyle) =>
    write(list.map((old, j) => (j === i ? f : old)));

  return (
    <Section
      title="Filters"
      action={
        <IconButton title="Add" onClick={() => write([...list, { ...DEFAULTS.filter }])}>
          <PlusIcon />
        </IconButton>
      }
    >
      {list.map((f, i) => (
        <div className="field-row" key={i}>
          <SelectField value={f.fn} options={FILTER_FNS}
            onCommit={(fn) => update(i, { ...f, fn })} />
          <NumberField label="" value={f.amount}
            onCommit={(v) => update(i, { ...f, amount: v })} />
          {/* Layer vs Backdrop is CSS filter vs backdrop-filter. */}
          <IconButton title={f.backdrop ? "Backdrop" : "Layer"} active={f.backdrop}
            onClick={() => update(i, { ...f, backdrop: !f.backdrop })}>
            <span className="glyph-small">{f.backdrop ? "BD" : "L"}</span>
          </IconButton>
          <IconButton title="Toggle" active={f.visible}
            onClick={() => update(i, { ...f, visible: !f.visible })}>
            <EyeIcon off={!f.visible} />
          </IconButton>
          <IconButton title="Remove" onClick={() => write(list.filter((_, j) => j !== i))}>
            <Minus />
          </IconButton>
        </div>
      ))}
    </Section>
  );
}

export function RadiusSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  return (
    <Section title="Radius">
      <SliderField value={node.radius} min={0} max={200}
        onCommit={(v) => patch({ radius: Math.max(0, v) })} />
    </Section>
  );
}

export function TextSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  return (
    <Section title="Text">
      <div className="field-row">
        <SelectField value={node.fontFamily ?? "System"}
          options={["System", "Serif", "Monospace"] as const}
          onCommit={(v) => patch({ fontFamily: v === "System" ? undefined :
            v === "Serif" ? "Georgia, serif" : "ui-monospace, monospace" })} />
      </div>
      <div className="field-row">
        <NumberField label="⇕A" value={node.fontSize ?? 16}
          onCommit={(v) => patch({ fontSize: Math.max(1, v) })} />
        <NumberField label="A̲" value={node.lineHeight ?? 21}
          onCommit={(v) => patch({ lineHeight: Math.max(1, v) })} />
        <NumberField label="|A|" value={node.letterSpacing ?? 0}
          onCommit={(v) => patch({ letterSpacing: v })} />
      </div>
      <div className="field-row align-row">
        {(["left", "center", "right"] as const).map((a) => (
          <IconButton key={a} title={a} active={(node.textAlign ?? "left") === a}
            onClick={() => patch({ textAlign: a })}>
            <span className="glyph-small">{a === "left" ? "◧" : a === "center" ? "◫" : "◨"}</span>
          </IconButton>
        ))}
      </div>
    </Section>
  );
}

export function UnderlineSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  const u = node.underline;
  return (
    <Section
      title="Underline"
      action={
        <AddRemove present={!!u}
          onAdd={() => patch({ underline: { ...DEFAULTS.underline } })}
          onRemove={() => patch({ underline: undefined })} />
      }
    >
      {u && (
        <>
          <div className="field-row">
            <NumberField label="≡" value={u.width}
              onCommit={(v) => patch({ underline: { ...u, width: Math.max(0, v) } })} />
            <NumberField label="↧" value={u.offset}
              onCommit={(v) => patch({ underline: { ...u, offset: v } })} />
            <IconButton title="Toggle" active={u.visible}
              onClick={() => patch({ underline: { ...u, visible: !u.visible } })}>
              <EyeIcon off={!u.visible} />
            </IconButton>
          </div>
          <ColorField value={u.color} opacity={u.opacity}
            onCommit={(c) => patch({ underline: { ...u, color: c } })}
            onOpacityCommit={(a) => patch({ underline: { ...u, opacity: a } })} />
        </>
      )}
    </Section>
  );
}

export function TextStrokeSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  const t = node.textStroke;
  return (
    <Section
      title="Stroke"
      action={
        <AddRemove present={!!t}
          onAdd={() => patch({ textStroke: { ...DEFAULTS.textStroke } })}
          onRemove={() => patch({ textStroke: undefined })} />
      }
    >
      {t && (
        <>
          <div className="field-row">
            <NumberField label="≡" value={t.width}
              onCommit={(v) => patch({ textStroke: { ...t, width: Math.max(0, v) } })} />
            <SelectField value={t.position} options={["Below fill", "Above fill"] as const}
              onCommit={(position) => patch({ textStroke: { ...t, position } })} />
            <IconButton title="Toggle" active={t.visible}
              onClick={() => patch({ textStroke: { ...t, visible: !t.visible } })}>
              <EyeIcon off={!t.visible} />
            </IconButton>
          </div>
          <ColorField value={t.color} opacity={t.opacity}
            onCommit={(c) => patch({ textStroke: { ...t, color: c } })}
            onOpacityCommit={(a) => patch({ textStroke: { ...t, opacity: a } })} />
        </>
      )}
    </Section>
  );
}

export function OtherStylesSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  return (
    <Section title="Other styles">
      <CheckRow
        checked={node.preWrap !== false}
        label={<code>white-space: pre-wrap</code>}
        onToggle={() => patch({ preWrap: node.preWrap === false })}
      />
    </Section>
  );
}

export function GuidesSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  const g = node.guides;
  return (
    <Section
      title="Guides"
      action={
        <AddRemove present={!!g}
          onAdd={() => patch({ guides: { ...DEFAULTS.guides } })}
          onRemove={() => patch({ guides: undefined })} />
      }
    >
      {g && (
        <>
          <div className="field-row">
            <SelectField value={g.kind} options={["Grid", "Columns", "Rows"] as const}
              onCommit={(kind) => patch({ guides: { ...g, kind } })} />
            <NumberField label="⊞" value={g.size}
              onCommit={(v) => patch({ guides: { ...g, size: Math.max(1, v) } })} />
            <IconButton title="Toggle" active={g.visible}
              onClick={() => patch({ guides: { ...g, visible: !g.visible } })}>
              <EyeIcon off={!g.visible} />
            </IconButton>
          </div>
          <ColorField value={g.color} opacity={g.opacity}
            onCommit={(c) => patch({ guides: { ...g, color: c } })}
            onOpacityCommit={(a) => patch({ guides: { ...g, opacity: a } })} />
        </>
      )}
    </Section>
  );
}

/** Read-only tally of the colours used inside the selection. */
export function SelectionColoursSection({ nodeIds }: { nodeIds: string[] }) {
  const nodes = useActive((f) => f.doc.nodes);
  const colours = selectionColours(nodes, nodeIds);
  if (colours.length === 0) return null;
  return (
    <Section title="Selection colors">
      {colours.map((c, i) => (
        <div className="swatch-row" key={i}>
          <span className="colour-swatch" style={{ background: c.color }} />
          <span className="swatch-hex">{c.color.replace("#", "").toUpperCase()}</span>
          <span className="swatch-pct">{Math.round(c.opacity * 100)} %</span>
          <span className="swatch-count">{c.count}</span>
        </div>
      ))}
    </Section>
  );
}

/** Visual stub: export is Phase 9, so nothing is wired up behind it. */
export function ExportSection() {
  return (
    <Section title="Export" action={<span className="section-stub">Phase 9</span>}>
      <div className="field-row is-stub">
        <SelectField value="2x" options={["1x", "2x", "3x"] as const} onCommit={() => {}} />
        <SelectField value="PNG" options={["PNG", "WebP", "AVIF"] as const} onCommit={() => {}} />
      </div>
    </Section>
  );
}

/** Stroke width and colour for a vector path. */
export function PathStrokeSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  return (
    <Section title="Stroke">
      <div className="field-row">
        <NumberField
          label="≡"
          value={node.strokeWidth ?? 2}
          onCommit={(v) => patch({ strokeWidth: Math.max(0, v) })}
        />
      </div>
      <ColorField
        value={node.strokeColor ?? "#222222"}
        opacity={node.strokeOpacity ?? 1}
        onCommit={(c) => patch({ strokeColor: c })}
        onOpacityCommit={(a) => patch({ strokeOpacity: a })}
      />
    </Section>
  );
}

/** Closed/open toggle — a closed path takes a fill, an open one does not. */
export function PathShapeSection({ node, patch }: { node: SceneNode; patch: Patch }) {
  return (
    <Section title="Path">
      <CheckRow
        checked={!!node.closed}
        label="Closed"
        onToggle={() => patch({ closed: !node.closed })}
      />
    </Section>
  );
}
