/**
 * Markup with a stylesheet, flattened to inline styles.
 *
 * Real pages keep their design in a `<style>` block and reference it by
 * class. The parser reads inline styles only, so handing it a real page's
 * markup produced correctly-nested boxes with none of its design — the hero
 * image came back 1440x0 because every dimension lived in a rule the parser
 * never saw. The agent's only recourse was to hand-translate the stylesheet,
 * and whatever it did not translate was simply lost.
 *
 * Nothing here parses CSS. The markup is mounted in the real document with
 * its stylesheet attached, the browser applies the cascade, and each
 * element's resolved style is read back and written onto it inline. What the
 * browser decided a rule means is, by definition, what that rule means.
 */

/**
 * Properties worth carrying over.
 *
 * A computed style has hundreds of entries, nearly all of them defaults.
 * Copying them all would bury the real design in noise and defeat the
 * comparison below, so this is the set that describes how something looks.
 */
const CARRIED = [
  "display", "flex-direction", "flex-wrap", "justify-content", "align-items",
  "align-self", "flex-grow", "flex-shrink", "flex-basis", "gap", "row-gap",
  "column-gap", "grid-template-columns", "grid-template-rows", "grid-column",
  "grid-row", "position", "left", "top", "right", "bottom", "z-index",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "background-color", "background-image", "background-size",
  "background-position", "background-repeat", "color", "opacity",
  "border-radius", "border-top-left-radius", "border-top-right-radius",
  "border-bottom-right-radius", "border-bottom-left-radius",
  "border-top-width", "border-right-width", "border-bottom-width",
  "border-left-width", "border-top-color", "border-right-color",
  "border-bottom-color", "border-left-color", "border-top-style",
  "box-shadow", "overflow", "transform", "font-family", "font-size",
  "font-weight", "font-style", "font-stretch", "line-height",
  "letter-spacing", "text-align", "text-transform", "text-decoration-line",
  "white-space", "object-fit", "backdrop-filter", "filter", "mix-blend-mode",
] as const;

/** One hidden host, reused, so a build does not churn the document. */
let host: HTMLElement | null = null;

function getHost(): HTMLElement {
  if (host && host.isConnected) return host;
  host = document.createElement("div");
  // Off-screen rather than hidden: `display: none` leaves computed styles
  // unresolved, and the resolved values are the whole point.
  host.style.cssText =
    "position:absolute;left:-99999px;top:0;pointer-events:none;" +
    "contain:layout style;visibility:hidden";
  document.body.appendChild(host);
  return host;
}

/** A bare element of the same tag, for comparison against the defaults. */
const referenceCache = new Map<string, Record<string, string>>();

function referenceStyle(tag: string, root: HTMLElement): Record<string, string> {
  const cached = referenceCache.get(tag);
  if (cached) return cached;
  const probe = document.createElement(tag);
  root.appendChild(probe);
  const computed = getComputedStyle(probe);
  const out: Record<string, string> = {};
  for (const prop of CARRIED) out[prop] = computed.getPropertyValue(prop);
  probe.remove();
  referenceCache.set(tag, out);
  return out;
}

/**
 * Whether a fragment carries its own stylesheet.
 *
 * Markup written with inline styles is left alone — it needs no resolving,
 * and mounting it would cost a layout pass for nothing.
 */
export function hasStylesheet(html: string): boolean {
  return /<style[\s>]/i.test(html);
}

/**
 * Mount `html`, let the browser resolve its stylesheet, and return the same
 * markup with every rule written inline and the stylesheet removed.
 *
 * `width` is the box the markup will finally live in, so that percentages and
 * flex resolve against the same width they will have on the canvas.
 */
export function inlineStylesheet(html: string, width: number): string {
  const root = getHost();
  root.style.width = `${Math.max(1, Math.round(width))}px`;
  root.innerHTML = html;

  // Force layout once, so every computed value below is resolved.
  void root.offsetWidth;

  const elements = Array.from(root.querySelectorAll<HTMLElement>("*"));
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (tag === "style" || tag === "script") continue;

    const computed = getComputedStyle(el);
    const reference = referenceStyle(tag, root);
    const own = el.getAttribute("style") ?? "";

    // Only what differs from a bare element of the same tag: everything else
    // is a default the parser would apply anyway.
    let extra = "";
    for (const prop of CARRIED) {
      const value = computed.getPropertyValue(prop);
      if (!value || value === reference[prop]) continue;
      extra += `${prop}:${value};`;
    }
    // The element's own inline style goes last so it still wins, exactly as
    // the cascade had it.
    el.setAttribute("style", extra + own);
  }

  for (const tag of Array.from(root.querySelectorAll("style, script"))) {
    tag.remove();
  }

  const out = root.innerHTML;
  root.innerHTML = "";
  return out;
}
