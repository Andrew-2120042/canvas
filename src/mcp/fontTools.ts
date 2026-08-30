import { registerTool } from "./bridge";

/**
 * Which typefaces will actually render here.
 *
 * Without an answer, the safe move is a system stack at 400 and 700 — and
 * typography is most of what separates a designed page from a template. A
 * variable font's axes are the part worth knowing: a width axis is what lets
 * a display heading be genuinely condensed rather than merely bold, and no
 * one risks an axis they cannot confirm exists.
 *
 * The question is deliberately "will this render on this machine", not "does
 * this font exist somewhere", so it is asked of the engine that will do the
 * rendering rather than of a list.
 */

/** Weights worth probing. A family rarely ships more than these. */
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/**
 * Whether a family renders as itself rather than falling back.
 *
 * Measured, because a browser reports no error for a missing font — it
 * silently substitutes one. Two strings set in the candidate against a known
 * fallback will measure identically if the candidate never loaded.
 */
function available(family: string): boolean {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const probe = "MWQ_iljI 0123456789 mmmmwwww";

  const widthIn = (stack: string): number => {
    ctx.font = `72px ${stack}`;
    return ctx.measureText(probe).width;
  };

  // A generic keyword or web-safe face is available by definition.
  if (/^(system-ui|sans-serif|serif|monospace|cursive|fantasy|ui-\w+)$/i.test(family.trim())) {
    return true;
  }

  const quoted = `"${family.replace(/"/g, "")}"`;
  // Compared against two different fallbacks: matching one could be
  // coincidence, matching both means nothing of the candidate was used.
  const mono = widthIn("monospace");
  const serif = widthIn("serif");
  return widthIn(`${quoted}, monospace`) !== mono
    || widthIn(`${quoted}, serif`) !== serif;
}

/** The weights and styles that actually differ from one another. */
function faces(family: string): { weights: number[]; hasItalic: boolean } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { weights: [400], hasItalic: false };
  const probe = "Handgloves 123";
  const quoted = `"${family.replace(/"/g, "")}"`;

  const width = (spec: string): number => {
    ctx.font = `${spec} 72px ${quoted}, monospace`;
    return ctx.measureText(probe).width;
  };

  // A weight the family does not have renders as the nearest one it does, so
  // identical measurements mean the same face was used twice.
  const seen = new Map<number, number>();
  for (const w of WEIGHTS) seen.set(w, width(`${w}`));
  const distinct: number[] = [];
  const widths = new Set<number>();
  for (const [w, px] of seen) {
    if (!widths.has(px)) { widths.add(px); distinct.push(w); }
    else if (w === 400 || w === 700) distinct.push(w);
  }

  return {
    weights: [...new Set(distinct)].sort((a, b) => a - b),
    hasItalic: width("italic 400") !== width("400"),
  };
}

/** Whether a variable width axis responds, and roughly over what range. */
function widthAxis(family: string): { min: number; max: number } | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const el = document.createElement("span");
  el.style.cssText =
    "position:absolute;left:-99999px;white-space:pre;font-size:72px;visibility:hidden";
  el.style.fontFamily = `"${family.replace(/"/g, "")}", monospace`;
  el.textContent = "Handgloves 123";
  document.body.appendChild(el);

  const at = (pct: number): number => {
    el.style.fontStretch = `${pct}%`;
    return el.offsetWidth;
  };
  const normal = at(100);
  let min = 100;
  let max = 100;
  for (const pct of [62, 75, 87]) if (at(pct) !== normal) { min = Math.min(min, pct); }
  for (const pct of [112, 125]) if (at(pct) !== normal) { max = Math.max(max, pct); }
  el.remove();
  return min === 100 && max === 100 ? null : { min, max };
}

export function registerFontTools(): void {
  registerTool("get_font_info", (args) => {
    const raw = args.families ?? args.familyNames ?? args.family;
    const families = (Array.isArray(raw) ? raw : [raw])
      .filter(Boolean)
      .map(String);
    if (families.length === 0) throw new Error("families is required");

    return {
      families: families.map((family) => {
        if (!available(family)) {
          return {
            family,
            available: false,
            note: "Not installed and not loaded — text set in it will silently fall back to something else.",
          };
        }
        const { weights, hasItalic } = faces(family);
        const width = widthAxis(family);
        return {
          family,
          available: true,
          weights,
          hasItalic,
          // Present only when the family really responds to the axis.
          ...(width ? { widthAxis: width } : {}),
        };
      }),
    };
  });
}
