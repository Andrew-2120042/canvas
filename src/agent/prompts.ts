/**
 * Turning an agent's prose into an answerable prompt.
 *
 * Interactive commands ask questions as text — a line introducing the choice,
 * then the choices, sometimes numbered with descriptions:
 *
 *   Select login method:
 *   1. Claude account with subscription · Pro, Max, Team, or Enterprise
 *   2. Anthropic Console account · API usage billing
 *
 * or inline:
 *
 *   Usage: /model <name>. Available: sonnet, opus, haiku, ...
 *
 * Both are the same thing to a person, so both parse to the same shape and
 * render through one control.
 */

export interface PromptOption {
  /** What gets sent when picked. */
  value: string;
  /** What the person reads. */
  label: string;
  /** Trailing detail after a separator, if the agent gave one. */
  note?: string;
}

export interface Prompt {
  /** The line that introduces the choice, e.g. "Select login method". */
  question?: string;
  options: PromptOption[];
  /** The slash command this answers, so a pick can be sent as one. */
  command?: string;
}

/** Descriptions follow the name after one of these. */
const SEPARATORS = /\s+[·—–-]\s+/;

function splitNote(text: string): { label: string; note?: string } {
  const m = SEPARATORS.exec(text);
  if (!m) return { label: text.trim() };
  return {
    label: text.slice(0, m.index).trim(),
    note: text.slice(m.index + m[0].length).trim() || undefined,
  };
}

/** "1. Name · detail" style, the shape interactive commands use. */
function parseNumbered(text: string): Prompt | null {
  const lines = text.split("\n");
  const options: PromptOption[] = [];
  let firstIndex = -1;

  lines.forEach((line, i) => {
    const m = /^\s*(?:[›>❯]\s*)?(\d+)[.)]\s+(.+)$/.exec(line);
    if (!m) return;
    const { label, note } = splitNote(m[2]);
    if (!label) return;
    if (firstIndex === -1) firstIndex = i;
    options.push({ value: label, label, note });
  });

  if (options.length < 2) return null;

  // The question is the last non-empty line before the list.
  let question: string | undefined;
  for (let i = firstIndex - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t) { question = t.replace(/:$/, ""); break; }
  }
  return { question, options };
}

/** "Available: a, b, c" style, which slash commands use headless. */
function parseInline(text: string): Prompt | null {
  const m = /Available:\s*([^.\n]+)/i.exec(text);
  if (!m) return null;

  const options = m[1]
    .split(/,|\bor\b/)
    .map((p) => p.trim().replace(/^`|`$/g, ""))
    .filter((p) => p && p.length < 40 && !/\s{2,}/.test(p))
    // "or a full model ID" is guidance about the field, not something to pick.
    .filter((p) => !/^a\s|\bID\b/i.test(p))
    .map((value) => ({ value, label: value }));

  if (options.length < 2) return null;

  // Prefer a "Select ...:" line if the reply had one.
  const q = /^\s*(Select[^\n:]*|Choose[^\n:]*)/im.exec(text);
  return { question: q ? q[1].trim() : undefined, options };
}

export function parsePrompt(text: string): Prompt | null {
  return parseNumbered(text) ?? parseInline(text);
}
