import { useEffect, useState, type ReactNode } from "react";

/** A collapsed-or-populated section header, matching the reference. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="prop-section">
      <div className="prop-section-head">
        <span className="prop-section-title">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * Numeric input that writes on every valid keystroke, so the canvas tracks
 * typing rather than waiting for blur.
 *
 * `value` is null when a multi-selection disagrees; the field shows "Mixed"
 * and still applies whatever gets typed to every selected node.
 */
export function NumberField({
  label,
  value,
  onCommit,
  suffix,
}: {
  label: ReactNode;
  value: number | null;
  onCommit: (n: number) => void;
  suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  // Follow the store while not being edited, so canvas drags update the field.
  useEffect(() => {
    setDraft(null);
  }, [value]);

  const shown =
    draft ?? (value === null ? "" : String(round(value))) + (suffix ?? "");

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        value={draft ?? (value === null ? "" : String(round(value)))}
        placeholder={value === null ? "Mixed" : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onCommit(n);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep canvas shortcuts out of the field
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
          const step = e.shiftKey ? 10 : 1;
          if (e.key === "ArrowUp" && value !== null) { e.preventDefault(); onCommit(value + step); }
          if (e.key === "ArrowDown" && value !== null) { e.preventDefault(); onCommit(value - step); }
        }}
      />
      {suffix && <span className="field-suffix">{suffix}</span>}
      {shown === "" && null}
    </label>
  );
}

/** Hex colour with a swatch. Applies as soon as the hex is complete. */
export function ColorField({
  value,
  onCommit,
  opacity,
  onOpacityCommit,
}: {
  value: string | null;
  onCommit: (hex: string) => void;
  opacity?: number | null;
  onOpacityCommit?: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { setDraft(null); }, [value]);

  const text = draft ?? (value ? value.replace("#", "").toUpperCase() : "");

  return (
    <div className="field colour-field">
      <span
        className="colour-swatch"
        style={{ background: value ?? "transparent" }}
      />
      <input
        className="field-input"
        value={text}
        placeholder={value === null ? "Mixed" : undefined}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
          setDraft(raw);
          if (raw.length === 3 || raw.length === 6) onCommit(`#${raw}`);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {onOpacityCommit && (
        <input
          className="field-input field-input--pct"
          value={opacity === null || opacity === undefined ? "" : Math.round(opacity * 100)}
          placeholder={opacity === null ? "—" : undefined}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onOpacityCommit(Math.min(100, Math.max(0, n)) / 100);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
      )}
      {onOpacityCommit && <span className="field-suffix">%</span>}
    </div>
  );
}

function round(n: number) {
  return Math.abs(n % 1) < 0.005 ? Math.round(n) : Math.round(n * 100) / 100;
}

/** Dropdown styled like the reference's select fields. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onCommit,
}: {
  label?: ReactNode;
  value: T;
  options: readonly T[];
  onCommit: (v: T) => void;
}) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <select
        className="field-input field-select"
        value={value}
        onChange={(e) => onCommit(e.target.value as T)}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

/** Slider paired with a numeric field, as the Radius section uses. */
export function SliderField({
  value,
  min = 0,
  max = 100,
  onCommit,
}: {
  value: number | null;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
}) {
  return (
    <div className="field-row slider-row">
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        value={value ?? 0}
        onChange={(e) => onCommit(parseFloat(e.target.value))}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <NumberField label="" value={value} onCommit={onCommit} />
    </div>
  );
}

/** Small square icon button used for section add/remove/visibility. */
export function IconButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`icon-button${active ? " is-active" : ""}`}
      title={title}
      onClick={onClick}
      tabIndex={-1}
    >
      {children}
    </button>
  );
}

export function CheckRow({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: ReactNode;
  onToggle: () => void;
}) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span>{label}</span>
    </label>
  );
}
