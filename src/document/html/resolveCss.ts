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
 * Properties NOT worth carrying over.
 *
 * This used to be the opposite — a list of the ~90 properties considered
 * worth keeping — and every fidelity bug found this week was a property that
 * was not on it. aspect-ratio, so constrained images collapsed to their
 * natural height. box-sizing, so a 280px card rendered 320px wide.
 * justify-items, so the icon in every round button sat against the left edge.
 * isolation, so the hero's scrim slid behind the page. columns, so a
 * four-column gallery came through as a single stack. Each was found
 * separately, fixed by appending to the list, and told nothing about the next
 * one — which is the signature of a whitelist rather than five unrelated
 * defects.
 *
 * The list was also redundant. Each property is compared against a bare
 * element of the same tag below, and *that* is what removes the noise a
 * computed style is full of: a value equal to the tag's own default is
 * dropped whether or not anyone thought to enumerate it. The whitelist was
 * contributing omissions and nothing else.
 *
 * So everything is carried unless it is named here, and what is named here is
 * only what is provably redundant or not visual: logical properties that
 * duplicate the physical ones the layout already has, prefixed aliases of
 * properties kept under their standard name, and behaviour that has no
 * appearance on a static canvas.
 */
/**
 * Properties a child takes from its parent unless it says otherwise.
 *
 * These are never dropped, however ordinary their value looks, and the reason
 * is the node model rather than CSS: nothing inherits here. A text node that
 * does not carry its own font-family renders in the canvas's UI font, not in
 * the font the page was written in.
 *
 * The comparison below drops a value equal to a bare element of the same tag.
 * That is right for a property an element sets for itself and wrong for one
 * it inherits, because the reference element sits in the same document and
 * inherits exactly the same value — so an inherited property always matches
 * and is always discarded.
 *
 * A real page puts its typography on `body`. Every paragraph inherits it, the
 * probe inherits it, and the result was that body text lost its typeface
 * entirely while headings kept theirs — a heading names its own font, so it
 * differs from the probe and survives. Text then measured in the wrong face,
 * wrapped at different words, and moved every row beneath it.
 */
const ALWAYS_CARRIED = new Set([
  "color", "font-family", "font-size", "font-weight", "font-style",
  "font-stretch", "line-height", "letter-spacing", "text-align",
  "text-transform", "text-decoration-line", "white-space", "word-break",
]);

const NOT_CARRIED = new Set<string>([
  // Logical duplicates of physical properties that are carried already.
  "inline-size", "block-size", "min-inline-size", "min-block-size",
  "max-inline-size", "max-block-size",
  "inset-inline-start", "inset-inline-end", "inset-block-start",
  "inset-block-end", "inset-inline", "inset-block", "inset",
  "margin-inline-start", "margin-inline-end", "margin-block-start",
  "margin-block-end", "margin-inline", "margin-block",
  "padding-inline-start", "padding-inline-end", "padding-block-start",
  "padding-block-end", "padding-inline", "padding-block",
  "border-inline-start-width", "border-inline-end-width",
  "border-block-start-width", "border-block-end-width",
  "border-inline-start-color", "border-inline-end-color",
  "border-block-start-color", "border-block-end-color",
  "border-inline-start-style", "border-inline-end-style",
  "border-block-start-style", "border-block-end-style",
  "border-start-start-radius", "border-start-end-radius",
  "border-end-start-radius", "border-end-end-radius",
  "block-overflow", "overflow-inline", "overflow-block",

  // Nothing on a static canvas animates, and carrying these onto every
  // element would restart every animation on every render.
  "animation", "animation-name", "animation-duration", "animation-delay",
  "animation-timing-function", "animation-iteration-count",
  "animation-direction", "animation-fill-mode", "animation-play-state",
  "animation-composition", "animation-range", "animation-range-start",
  "animation-range-end", "animation-timeline",
  "transition", "transition-property", "transition-duration",
  "transition-delay", "transition-timing-function", "transition-behavior",
  "view-transition-name", "will-change", "offset-path", "offset-distance",

  // Interaction, not appearance.
  "cursor", "pointer-events", "user-select", "-webkit-user-select",
  "touch-action", "caret-color", "accent-color", "scroll-behavior",
  "overscroll-behavior", "overscroll-behavior-x", "overscroll-behavior-y",
  "scroll-snap-type", "scroll-snap-align", "resize", "appearance",
  "-webkit-appearance", "-webkit-tap-highlight-color",

  // `content` is what materialisePseudo already read; writing it onto the
  // element itself would draw a pseudo-element's text twice.
  "content",

  // Prefixed aliases of properties carried under their standard name. The two
  // -webkit- properties that have no standard equivalent — background-clip
  // for gradient text and text-fill-color with it — are deliberately absent
  // from this list.
  "-webkit-border-image", "-webkit-box-align", "-webkit-box-direction",
  "-webkit-box-flex", "-webkit-box-ordinal-group", "-webkit-box-orient",
  "-webkit-box-pack", "-webkit-locale", "-webkit-print-color-adjust",
  "-webkit-rtl-ordering", "-webkit-font-smoothing", "-webkit-text-orientation",
  "-webkit-writing-mode",
]);

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
    for (let i = 0; i < style.length; i += 1) {
      const prop = style.item(i);
      if (NOT_CARRIED.has(prop)) continue;
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
 * Values a computed style derives from other values, rather than being told.
 *
 * Comparing against a bare element of the same tag removes properties left at
 * their *global* default, which is most of them. It cannot remove one whose
 * default is relative to the element itself, because the reference element is
 * a different element: those differ by construction and come through on every
 * node.
 *
 * Two families of them, and together they were three quarters of everything
 * carried — around 24 declarations per node on a real page, none of which
 * anybody wrote:
 *
 * Anything defaulting to `currentColor` — every border side, the outline, the
 * text decoration, the column rule, the text fill and stroke — resolves to
 * whatever `color` is. Since `color` is carried, restating it eight more
 * times says nothing and cannot be edited meaningfully in the panel.
 *
 * And `transform-origin` and `perspective-origin` default to the element's
 * own centre, so they resolve to half its width and height and differ from
 * any reference whose size differs.
 *
 * Dropped only when they still hold the derived value. An element that
 * actually sets a border colour, or moves its transform origin, keeps it.
 */
const CURRENT_COLOR_PROPS = new Set([
  "border-top-color", "border-right-color", "border-bottom-color",
  "border-left-color", "outline-color", "column-rule-color",
  "text-decoration-color", "text-emphasis-color",
  "-webkit-text-fill-color", "-webkit-text-stroke-color",
  "caret-color", "stroke", "fill",
]);

function isDerived(
  prop: string,
  value: string,
  computed: CSSStyleDeclaration,
  el: HTMLElement,
): boolean {
  if (CURRENT_COLOR_PROPS.has(prop)) {
    return value === computed.getPropertyValue("color");
  }
  if (prop === "transform-origin" || prop === "perspective-origin") {
    // Measured, not offsetWidth: that rounds to a whole pixel, while the
    // origin is computed from the real fractional box. On a 55.6px element
    // the two read 28px and 27.8px and never matched, so the check never
    // fired and both properties came through on every node on the page.
    const box = el.getBoundingClientRect();
    const parts = value.split(" ").map(parseFloat);
    if (parts.length < 2 || parts.some(Number.isNaN)) return false;
    return (
      Math.abs(parts[0] - box.width / 2) < 0.5 &&
      Math.abs(parts[1] - box.height / 2) < 0.5
    );
  }
  return false;
}

/**
 * Carried on every element, not only the ones with words in them.
 *
 * Box sizing is not inherited, but it needs the same treatment for the same
 * reason: the canvas has its own default and it is not the web's. Every node
 * is laid out border-box, so a page that never says otherwise — and most do
 * not, since content-box is the CSS default — has each element's computed
 * width read as a content width and then applied as a border width. Every box
 * shrinks by its own padding and border, all the way down. Cards came out
 * narrower than their source and the text inside them wrapped a word early.
 */
const ALWAYS_CARRIED_ANY = new Set(["box-sizing"]);

/**
 * True when this element has words of its own.
 *
 * Typography only has to be written down where there is text to render. On a
 * real page that is roughly a third of the elements, and writing all of it
 * onto the other two thirds tripled the size of a converted document for no
 * effect anybody could see — enough, on one page, that the rasteriser refused
 * the result outright.
 */
function hasOwnText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? "").trim()) return true;
  }
  return false;
}

/**
 * A value that is only waiting to change is not the design.
 *
 * Pages reveal themselves as you scroll: a section starts at `opacity: 0`,
 * nudged down a little, with a transition on both, and script flips a class
 * when it comes into view. Read as a static file that is exactly what it says
 * — invisible — so a faithful conversion produced page after page of empty
 * boxes. Correct, and useless: what the designer wants on the canvas is the
 * design, not the first frame of its entrance.
 *
 * A transition is the page saying this value is temporary. So a transitioned
 * opacity of zero comes in revealed, and a transform that is only an offset
 * comes in at rest. Reported in the conversion summary rather than done
 * quietly, because it is a judgement about intent and the caller should know
 * it was made.
 *
 * Deliberately narrow. An element with no transition on the property is left
 * exactly as it is — something hidden outright meant to be hidden.
 */
export function revealTransitioned(
  computed: CSSStyleDeclaration,
): { opacity?: string; transform?: string } {
  const props = computed.getPropertyValue("transition-property");
  if (!props) return {};
  const list = props.split(",").map((p) => p.trim());
  const covers = (name: string): boolean =>
    list.includes("all") || list.includes(name);

  const out: { opacity?: string; transform?: string } = {};
  if (covers("opacity") && parseFloat(computed.getPropertyValue("opacity")) === 0) {
    out.opacity = "1";
  }
  if (covers("transform")) {
    const t = computed.getPropertyValue("transform");
    // Only an offset or a scale — something the entrance animates away. A
    // rotation is far more likely to be part of the design itself.
    if (t && t !== "none" && /^matrix\(1, 0, 0, 1, /.test(t)) out.transform = "none";
  }
  return out;
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
export function viewportHeightFor(width: number): number {
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
  for (let i = 0; i < computed.length; i += 1) {
    const prop = computed.item(i);
    out[prop] = computed.getPropertyValue(prop);
  }
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
 * Point a page's own files at where they actually are.
 *
 * Markup arrives as a string, and a string has no directory. A page that
 * keeps its photographs beside itself — `url('hero.jpg')`, `src="logo.svg"` —
 * therefore arrives with every reference pointing at nothing, and converts to
 * a design full of empty boxes. It is not a rendering failure and not a
 * parsing one: the file simply was never findable from where the markup ended
 * up.
 *
 * Rewritten before the markup is mounted, so the browser loads the real files
 * and every measurement that depends on them — an image's intrinsic size, a
 * background's cover crop — is taken against the real thing.
 *
 * Absolute paths, data URLs and remote URLs are already resolvable and are
 * left exactly as they are.
 */
function resolveAgainst(html: string, base: string): string {
  const dir = base.replace(/\/+$/, "");
  const external = (url: string): boolean =>
    !!url && !/^(https?:|data:|blob:|asset:|file:|#|\/\/|\/)/i.test(url);
  const abs = (url: string): string => `${dir}/${url.replace(/^\.\//, "")}`;

  return html
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, q, url) =>
      external(url) ? `url(${q}${abs(url)}${q})` : whole)
    .replace(/\b(src|href|poster)\s*=\s*(['"])([^'"]+)\2/gi, (whole, attr, q, url) =>
      external(url) ? `${attr}=${q}${abs(url)}${q}` : whole);
}

/**
 * Keep the resolver from downloading a page's photographs.
 *
 * The resolver mounts a page only to ask the browser what its styles compute
 * to. It never needs a single pixel of a photograph to answer that: a CSS
 * background does not affect layout, so whether the file is a four-megabyte
 * photograph or nothing at all, every box lands in exactly the same place.
 *
 * Left alone it downloads and decodes all of them anyway, and the canvas then
 * loads the same files again to render them. On a page carrying fourteen
 * megabytes of photographs that was enough to take the webview down — it
 * crashed, reloaded, restored the last save, and the import appeared to
 * vanish. Which reads as the import silently failing rather than as running
 * out of memory.
 *
 * So each url() is swapped for an inert token before mounting and put back
 * afterwards. The computed styles come out identical, because the only thing
 * that changed is a string the layout never consults.
 *
 * `<img>` is deliberately untouched: an image element's intrinsic size does
 * decide its box, so it has to load.
 */
function deferImageLoads(html: string): { html: string; urls: string[] } {
  const urls: string[] = [];
  const out = html.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (whole, _q, url: string) => {
      if (/^data:/i.test(url)) return whole;
      urls.push(url);
      return `url("about:blank#cssimg${urls.length - 1}")`;
    },
  );
  return { html: out, urls };
}

/** Put the real files back into the styles that were read out. */
function restoreImageLoads(html: string, urls: string[]): string {
  return html.replace(
    /about:blank#cssimg(\d+)/g,
    (whole, n: string) => urls[Number(n)] ?? whole,
  );
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
  /** The directory the markup came from, so its own files can be found. */
  basePath?: string,
): Promise<{
  html: string;
  fonts: { families: string[]; loaded: string[] };
  revealed: number;
}> {
  const { doc } = await getHost(width);
  const view = doc.defaultView ?? window;
  const root = doc.body;
  const withPaths = basePath ? resolveAgainst(html, basePath) : html;
  const deferred = deferImageLoads(withPaths);
  root.innerHTML = deferred.html;

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

  let revealedCount = 0;
  const elements = Array.from(root.querySelectorAll<HTMLElement>("*"));
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (tag === "style" || tag === "script") continue;

    const computed = view.getComputedStyle(el);
    const reference = referenceStyle(tag, root);
    const carriesText = hasOwnText(el);
    const own = el.getAttribute("style") ?? "";

    // Only what differs from a bare element of the same tag: everything else
    // is a default the parser would apply anyway.
    let extra = "";
    for (let i = 0; i < computed.length; i += 1) {
      const prop = computed.item(i);
      if (NOT_CARRIED.has(prop)) continue;
      const value = computed.getPropertyValue(prop);
      if (!value) continue;
      // An inherited property is kept even when it matches the reference,
      // because the reference inherited it too — see ALWAYS_CARRIED.
      const alwaysKeep =
        ALWAYS_CARRIED_ANY.has(prop) ||
        (ALWAYS_CARRIED.has(prop) && carriesText);
      if (!alwaysKeep && value === reference[prop]) continue;
      if (isDerived(prop, value, computed, el)) continue;
      extra += `${prop}:${value};`;
    }
    // Values a transition says are temporary come in at their resting state.
    const revealed = revealTransitioned(computed);
    if (revealed.opacity !== undefined) {
      extra += `opacity:${revealed.opacity};`;
      revealedCount += 1;
    }
    if (revealed.transform !== undefined) extra += `transform:${revealed.transform};`;

    // The element's own inline style goes last so it still wins, exactly as
    // the cascade had it.
    el.setAttribute("style", extra + own);
  }

  for (const tag of Array.from(root.querySelectorAll("style, script"))) {
    tag.remove();
  }

  const out = restoreImageLoads(root.innerHTML, deferred.urls);
  root.innerHTML = "";
  return { html: out, fonts, revealed: revealedCount };
}
