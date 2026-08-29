import { useEffect, useRef, useState } from "react";
import type { Prompt, PromptOption } from "./prompts";

/**
 * Descriptions for models, since the headless reply lists names only.
 *
 * Enrichment, never a gate: an option the agent offers that is missing here
 * still renders, just without a note. The names always come from the agent so
 * the list cannot go stale.
 */
const MODEL_NOTES: Record<string, { label: string; note: string }> = {
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

function enrich(option: PromptOption, command?: string): PromptOption {
  if (command !== "model") return option;
  const known = MODEL_NOTES[option.value];
  return known ? { ...option, label: known.label, note: option.note ?? known.note } : option;
}

function titleFor(prompt: Prompt): string {
  if (prompt.question) return prompt.question;
  if (prompt.command === "model") return "Select model";
  return prompt.command ? `/${prompt.command}` : "Choose";
}

/**
 * One control for every question the agent asks: the question, then the
 * options beneath it, keyboard-navigable and answerable in one click.
 */
export function PromptCard({
  prompt,
  current,
  onPick,
  onCancel,
}: {
  prompt: Prompt;
  /** Marks the option already in effect, when one is known. */
  current?: string;
  onPick: (option: PromptOption) => void;
  onCancel: () => void;
}) {
  const options = prompt.options.map((o) => enrich(o, prompt.command));

  // Only claim an option is current when it genuinely is; defaulting the tick
  // onto the first row would assert something false.
  const currentIndex = current
    ? options.findIndex((o) => current.toLowerCase().includes(o.value.split("[")[0].toLowerCase()))
    : -1;

  const [index, setIndex] = useState(Math.max(0, currentIndex));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <div
      className="pc-card"
      tabIndex={-1}
      ref={ref}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => (i + 1) % options.length); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => (i - 1 + options.length) % options.length); }
        else if (e.key === "Enter") { e.preventDefault(); onPick(options[index]); }
        else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        else if (/^[1-9]$/.test(e.key)) {
          // The agent numbers its options, so the numbers should work.
          const n = Number(e.key) - 1;
          if (n < options.length) { e.preventDefault(); onPick(options[n]); }
        }
      }}
    >
      <div className="pc-head">
        <span className="pc-title">{titleFor(prompt)}</span>
        <button className="pc-close" onClick={onCancel} title="Dismiss  Esc">×</button>
      </div>

      <div className="pc-list">
        {options.map((o, i) => (
          <button
            key={o.value}
            className={`pc-row${i === index ? " is-active" : ""}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => onPick(o)}
          >
            <span className="pc-num">{i + 1}</span>
            <span className="pc-name">
              {o.label}
              {i === currentIndex && <span className="pc-check">✓</span>}
            </span>
            <span className="pc-note">{o.note}</span>
          </button>
        ))}
      </div>

      <div className="pc-foot">
        <span>↑↓ to move</span>
        <span>Enter to select</span>
        <span>Esc to cancel</span>
      </div>
    </div>
  );
}
