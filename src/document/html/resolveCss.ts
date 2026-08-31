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
  // Sizing rules that decide a box rather than decorate it. Leaving
  // aspect-ratio out meant every constrained image lost its constraint and
  // rendered at its natural height — on a page of photographs that turned a
  // 6,500px page into a 29,700px one, which is not a subtle failure but was
  // a silent one. box-sizing decides whether padding is inside the width,
  // which is the difference between a 280px card and a 320px one.
  "aspect-ratio", "box-sizing", "object-position", "order", "vertical-align",
  "isolation", "z-index",
  "text-indent", "word-break", "overflow-wrap", "text-overflow",
  "border-right-style", "border-bottom-style", "border-left-style",
  // Gradient text: the fill is transparent and the gradient is clipped to
  // the glyphs, so losing either leaves a heading invisible or flat.
  "background-clip", "-webkit-background-clip", "-webkit-text-fill-color",
] as const;

/**
 * Pseudo-elements, made real.
 *
 * `::before` and `::after` are not in childNodes and not in the markup. They
 * exist only in the computed style, so a tree walker cannot see them at all —
 * they are not dropped by any rule, they were never visible to be dropped.
 * On a real page that is a large share of the design: scrims, bullets,
 * dividers, badges, the underline under a link.
 *
 * The one that hurts is a scrim. `.hero__frame::after` is the gradient that
 * makes white headline text readable over a bright photograph. Lose it and
 * the text is still there, still white, and completely invisible — which
 * reads as "the text is missing" rather than "a box is missing".
 *
 * They can only be recovered here, while the element is mounted and the
 * browser can be asked. Each one becomes an ordinary child element carrying
 * the same styles, so everything downstream treats it as the box it always
 * was. Done at this stage so nothing later needs to know pseudo-elements
 * exist.
 */
export function materialisePseudo(el: HTMLElement, root: HTMLElement): void {
  for (const which of ["::before", "::after"] as const) {
    const view = el.ownerDocument.defaultView ?? window;
    const style = view.getComputedStyle(el, which);
    const content = style.getPropertyValue("content");
    // "none" is the default and means there is no pseudo-element. An empty
    // string is not nothing: `content: ""` is exactly how a decorative box is
    // written, and it is the common case for a scrim.
    if (!content || content === "none" || content === "normal") continue;

    const node = el.ownerDocument.createElement("div");
    let decl = "";
    for (const prop of CARRIED) {
      const value = style.getPropertyValue(prop);
      if (value) decl += `${prop}:${value};`;
    }
    node.setAttribute("style", decl);
    node.setAttribute("data-pseudo", which === "::before" ? "before" : "after");

    // Text content, when the pseudo carries any. Anything else — counters,
    // attr(), an image — has no text to lift, and its box still comes across.
    const literal = /^"(.*)"$/s.exec(content);
    if (literal && literal[1]) node.textContent = literal[1];

    // A pseudo-element with a negative z-index paints behind its originating
    // element's own background and no further, because the element it belongs
    // to bounds it. A real child has no such guarantee: it escapes to behind
    // whichever ancestor happens to establish the nearest stacking context,
    // which here is the artboard — so the hero's scrim slid behind a white
    // page and disappeared, taking the legibility of every white word on top
    // of it with it.
    //
    // `isolation: isolate` establishes a stacking context and does nothing
    // else, which is precisely the containment the pseudo-element had by
    // definition.
    const zIndex = parseFloat(style.getPropertyValue("z-index"));
    if (Number.isFinite(zIndex) && zIndex < 0) {
      el.style.isolation = "isolate";
    }

    if (which === "::before") el.insertBefore(node, el.firstChild);
    else el.appendChild(node);
  }
  void root;
}

/**
 * The fonts a page brings with it.
 *
 * Everything else in this file works by resolving a rule onto an element and
 * writing it inline, then discarding the stylesheet. `@font-face` cannot work
 * that way: it is not a property of any element, it is a declaration to the
 * document that a family exists and where to fetch it. Removing the
 * stylesheet removed it, so a converted page's own fonts never loaded and
 * every text node quietly rendered in a fallback.
 *
 * That is not a cosmetic loss. A fallback family has different metrics, so
 * text wraps at a different word, so a paragraph is a different height, so
 * everything below it moves. One unloaded font shifts a whole page and
 * presents as dozens of small layout errors — and it is invisible in a
 * screenshot, because the text is all there and looks fine.
 *
 * So the faces are lifted out of the sheet before it is discarded and
 * registered with the real document, where they stay for the session. Keyed
 * by their own text so the same page converted twice does not register
 * anything twice.
 */
const registered = new Set<string>();

/**
 * Every face adopted so far, as CSS.
 *
 * The comparison rasterises both sides separately, and only one of them
 * carries the app's stylesheet — so the canvas side had the page's fonts and
 * the source side fell back to a serif. Every text pixel then differed, on
 * every page, for a reason that has nothing to do with the conversion.
 */
export function adoptedFontCss(): string {
  return [...registered].join("\n");
}

/** The @font-face blocks in a stylesheet, as written. */
function fontFaceRules(css: string): string[] {
  const out: string[] = [];
  const re = /@font-face\s*\{/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    // Brace-matched rather than regex-matched: a face carries a src with
    // url(...) in it, and a lazy match to the first } truncates mid-URL.
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    if (depth === 0) out.push(css.slice(match.index, i));
  }
  return out;
}

/** The family a face declares, for reporting and for loading. */
function familyOf(rule: string): string | null {
  const m = /font-family\s*:\s*(['"]?)([^;'"]+)\1/i.exec(rule);
  return m ? m[2].trim() : null;
}

/**
 * Register a page's faces with the document, and wait for them to load.
 *
 * The wait is the point. Reading computed styles before the font arrives
 * measures the fallback, which is the whole failure this is here to prevent —
 * so the caller has to await this before the layout pass, not alongside it.
 */
export async function adoptFonts(css: string): Promise<{
  families: string[];
  loaded: string[];
}> {
  const rules = fontFaceRules(css);
  const families = [...new Set(rules.map(familyOf).filter((f): f is string => !!f))];
  if (rules.length === 0) return { families: [], loaded: [] };

  const fresh = rules.filter((rule) => !registered.has(rule));
  if (fresh.length) {
    const tag = document.createElement("style");
    tag.setAttribute("data-adopted-fonts", "");
    tag.textContent = fresh.join("\n");
    document.head.appendChild(tag);
    for (const rule of fresh) registered.add(rule);
  }

  // A face is only fetched when something asks for it, so each family is
  // asked for explicitly. A face that fails is not fatal — the page still
  // converts, and the report says which ones did not arrive.
  const loaded: string[] = [];
  await Promise.all(
    families.map(async (family) => {
      try {
        await document.fonts.load(`400 16px "${family}"`);
        await document.fonts.load(`700 16px "${family}"`);
        await document.fonts.load(`italic 400 16px "${family}"`);
        if (document.fonts.check(`16px "${family}"`)) loaded.push(family);
      } catch {
        // Reported as not loaded, below.
      }
    }),
  );
  return { families, loaded };
}

/**
 * A viewport of the artboard's own size, to resolve the page inside.
 *
 * The resolver used to mount markup in a hidden div, which is wrong in a way
 * that is invisible until you measure it: `vw` and `vh` resolve against the
 * real browser viewport, never against a container. So a page written in
 * viewport units — and real pages are, this one uses them 469 times — was
 * resolved against the app window rather than the artboard. Measured, `50vw`
 * came out 756px instead of 720: the window was 1512 wide, so every viewport
 * dimension on the page was 5% too large, and every one of them compounded
 * into the layout below it.
 *
 * An iframe is a viewport. Sized to the artboard, `100vw` is the artboard's
 * width because that is simply what it is, and nothing has to be computed or
 * corrected.
 *
 * Its height is a screenful rather than the page's full length: `100vh` means
 * one screen, and an artboard is a whole scrolling page. Sizing the frame to
 * the page would make a hero that fills the screen fill six thousand pixels.
 */
function viewportHeightFor(width: number): number {
  if (width <= 480) return 844;   // phone
  if (width <= 834) return 1024;  // tablet
  return 900;                     // desktop
}

let host: HTMLIFrameElement | null = null;

async function getHost(width: number): Promise<{
  frame: HTMLIFrameElement;
  doc: Document;
}> {
  if (!host || !host.isConnected) {
    host = document.createElement("iframe");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:absolute;left:-99999px;top:0;border:0;visibility:hidden";
    document.body.appendChild(host);
  }
  host.style.width = `${Math.max(1, Math.round(width))}px`;
  host.style.height = `${viewportHeightFor(width)}px`;

  const doc = host.contentDocument;
  if (!doc) throw new Error("could not open a viewport to resolve the page in");
  // A fresh document each time: a page's stylesheet must not leak into the
  // next one, and a rule from a previous conversion applying to this one
  // would be the hardest possible bug to see.
  referenceCache.clear();
  doc.open();
  doc.write("<!doctype html><html><head></head><body></body></html>");
  doc.close();
  return { frame: host, doc };
}

/** A bare element of the same tag, for comparison against the defaults. */
const referenceCache = new Map<string, Record<string, string>>();

function referenceStyle(tag: string, root: HTMLElement): Record<string, string> {
  const cached = referenceCache.get(tag);
  if (cached) return cached;
  const doc = root.ownerDocument;
  const probe = doc.createElement(tag);
  root.appendChild(probe);
  const computed = (doc.defaultView ?? window).getComputedStyle(probe);
  const out: Record<string, string> = {};
  for (const prop of CARRIED) out[prop] = computed.getPropertyValue(prop);
  probe.remove();
  referenceCache.set(tag, out);
  return out;
}

/**
 * Whether a fragment carries its own stylesheet.
 *
 * Kept for callers that want to know, but no longer used to decide whether to
 * resolve. Skipping the mount for inline-only markup meant two different
 * implementations of "what does this markup mean" — the browser's for one
 * kind of input and a pile of heuristics for the other — and they disagreed.
 * Every fragment now goes through the browser.
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
export async function inlineStylesheet(
  html: string,
  width: number,
): Promise<{ html: string; fonts: { families: string[]; loaded: string[] } }> {
  const { doc } = await getHost(width);
  const view = doc.defaultView ?? window;
  const root = doc.body;
  root.innerHTML = html;

  // The page's own faces, registered and loaded before anything is measured.
  // Awaited rather than fired off: every width and height read below is a
  // measurement, and measuring before the font arrives measures the fallback
  // — which is precisely the corruption this is here to avoid.
  const sheets = Array.from(root.querySelectorAll("style"))
    .map((tag) => tag.textContent ?? "")
    .join("\n");
  const fonts = await adoptFonts(sheets);
  // The faces have to exist inside the viewport too, or it measures the
  // fallback while the canvas renders the real thing.
  const adopted = doc.createElement("style");
  adopted.textContent = adoptedFontCss();
  doc.head.appendChild(adopted);

  // Force layout once, so every computed value below is resolved.
  void root.offsetWidth;

  // Pseudo-elements first, so the ones that carry boxes are in the tree
  // before styles are read back onto it.
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const tag = el.tagName.toLowerCase();
    if (tag === "style" || tag === "script" || el.hasAttribute("data-pseudo")) continue;
    materialisePseudo(el, root);
  }

  const elements = Array.from(root.querySelectorAll<HTMLElement>("*"));
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (tag === "style" || tag === "script") continue;

    const computed = view.getComputedStyle(el);
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
  return { html: out, fonts };
}
