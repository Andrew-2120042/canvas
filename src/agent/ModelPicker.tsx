import { useEffect, useRef, useState } from "react";

/**
 * Descriptions for models we recognise.
 *
 * The list of *names* always comes from the agent, so it cannot go stale.
 * These blurbs are a nicety layered on top: an unknown name still shows, just
 * without a description, rather than being hidden because this table is old.
 */
const NOTES: Record<string, { label: string; note: string }> = {
  default: { label: "Default", note: "Recommended · follows your account setting" },
  sonnet: { label: "Sonnet", note: "Efficient for routine tasks" },
  opus: { label: "Opus", note: "Best for everyday, complex tasks · ~2× usage vs Sonnet" },
  haiku: { label: "Haiku", note: "Fastest for quick answers" },
  fable: { label: "Fable", note: "Most capable for the hardest, longest tasks" },
  best: { label: "Best", note: "Picks the strongest model available to you" },
  opusplan: { label: "Opus Plan", note: "Opus while planning, Sonnet to execute" },
  "sonnet[1m]": { label: "Sonnet 1M", note: "Sonnet with a 1M-token context" },
  "opus[1m]": { label: "Opus 1M", note: "Opus with a 1M-token context" },
  "fable[1m]": { label: "Fable 1M", note: "Fable with a 1M-token context" },
};

function describe(name: string) {
  return NOTES[name] ?? { label: name, note: "" };
}

/**
 * The model picker the agent shows in its own terminal, drawn here instead.
 *
 * Headless mode answers /model with prose rather than an interactive list, so
 * a panel that only forwards text can never offer the real thing. This is
 * that control, built from the agent's own list of accepted names.
 */
export function ModelPicker({
  models,
  current,
  onPick,
  onCancel,
}: {
  models: string[];
  current?: string;
  onPick: (name: string) => void;
  onCancel: () => void;
}) {
  // Only claim a model is current when we actually know which one is.
  // Defaulting the tick to the first row would assert something false.
  const currentIndex = current
    ? models.findIndex((m) => current.toLowerCase().includes(m.split("[")[0]))
    : -1;
  // Start the cursor on the current model, or the top when it is unknown.
  const [index, setIndex] = useState(Math.max(0, currentIndex));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => ref.current?.focus(), []);

  return (
    <div
      className="mp-card"
      tabIndex={-1}
      ref={ref}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => (i + 1) % models.length); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => (i - 1 + models.length) % models.length); }
        else if (e.key === "Enter") { e.preventDefault(); onPick(models[index]); }
        else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
    >
      <div className="mp-head">
        <span className="mp-title">Select model</span>
        <button className="mp-close" onClick={onCancel}>×</button>
      </div>
      <p className="mp-sub">
        Switch between models for this session.
      </p>

      <div className="mp-list">
        {models.map((m, i) => {
          const d = describe(m);
          const isCurrent = i === currentIndex;
          return (
            <button
              key={m}
              className={`mp-row${i === index ? " is-active" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => onPick(m)}
            >
              <span className="mp-num">{i + 1}</span>
              <span className="mp-name">
                {d.label}
                {isCurrent && <span className="mp-check">✓</span>}
              </span>
              <span className="mp-note">{d.note}</span>
            </button>
          );
        })}
      </div>

      <div className="mp-foot">
        <span>↑↓ to move</span>
        <span>Enter to select</span>
        <span>Esc to cancel</span>
      </div>
    </div>
  );
}
