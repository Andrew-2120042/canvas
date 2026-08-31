import { activeFile } from "../document/store";
import { adoptedFontCss, materialisePseudo } from "../document/html/resolveCss";
import { renderVectors, settle } from "./screenshot";
import { registerTool } from "./bridge";

/**
 * Measuring a reproduction against the page it came from.
 *
 * Nothing else in either this tool or Paper checks fidelity. `write_html`
 * returns node ids and discards the markup, so there is no original left to
 * compare against; `get_screenshot` rasterises whatever the tree holds and
 * has no idea what was intended. Every judgement of "does this match" is the
 * agent looking at a picture and deciding. That works for the mistakes it
 * thinks to look for, and not at all for the ones it does not — a navigation
 * removed by a media query is invisible precisely because nothing draws
 * attention to a thing that is absent.
 *
 * So this renders both and subtracts them.
 *
 * The load-bearing detail is that both sides go through the *same*
 * rasteriser. Render the source in a browser and the canvas through our own
 * path and every difference in font smoothing, sub-pixel rounding and image
 * decoding lands in the diff as noise, drowning the real signal. Sent through
 * one rasteriser, anything left is a genuine difference between the source
 * design and what the conversion produced.
 *
 * Photographs are excluded from both sides. They are the same files in both
 * places, they cannot render inside the rasteriser above a size limit, and
 * including them would swamp the measurement with a difference that is not
 * one. What remains — layout, type, colour, gradients, scrims, borders — is
 * exactly the part conversion gets wrong.
 *
 * The result is numbers, not a picture, for the same reason get_layout is:
 * "which parts are wrong and by how much" is a question about quantities, and
 * answering it as an image costs an order of magnitude more and still leaves
 * the judging to be done.
 */

/** Longest side of the rasters actually compared. Detail past this is noise. */
const DIFF_MAX_SIDE = 900;
/** Per-channel distance before two pixels count as different. */
const CHANNEL_TOLERANCE = 28;
/** Grid the report is divided into, so a difference has a location. */
const GRID_COLS = 8;
/** How much of the page is rasterised at once. */
const BAND_HEIGHT = 1000;

interface Region {
  /** In the source page's own coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Share of pixels in this cell that differ, 0..1. */
  differing: number;
}

/**
 * Take the photographs out of both sides, identically.
 *
 * "Excluded" has to mean excluded on both sides or the measurement is worse
 * than useless. The canvas side draws its pictures in a separate pass that
 * this comparison does not run, so its photographs were already absent; the
 * source side still had its <img> tags, which either render or — above the
 * rasteriser's size limit — fail and collapse to nothing, taking everything
 * below them up the page. Either way the diff would have been dominated by an
 * asymmetry that is not a difference between the designs.
 *
 * An image keeps its box and loses its content, so a picture that is the
 * wrong SIZE still registers as a difference — which is a conversion error —
 * while a picture that is the same size registers as none, which is the
 * truth. Gradients are deliberately left alone: `background-image` covers
 * both, and a gradient scrim is exactly the sort of thing this is here to
 * catch.
 */
function neutralisePhotos(live: Element, target: Element): void {
  const liveEls = [live, ...Array.from(live.querySelectorAll("*"))];
  const targetEls = [target, ...Array.from(target.querySelectorAll("*"))];
  for (let i = 0; i < targetEls.length && i < liveEls.length; i += 1) {
    const el = targetEls[i] as HTMLElement;
    if (!el.style) continue;
    if (el.tagName.toLowerCase() === "img") {
      // The box is pinned to what the live image actually occupies, and then
      // the source is dropped entirely. Hiding it is not enough: a page that
      // inlines its photographs as data URLs carries megabytes of base64 into
      // the rasteriser, which silently refuses anything that large and
      // returns nothing at all. Measuring the box and removing the bytes
      // keeps the layout identical and the payload small.
      const live = liveEls[i] as HTMLElement;
      el.style.width = `${live.offsetWidth || 0}px`;
      el.style.height = `${live.offsetHeight || 0}px`;
      el.style.visibility = "hidden";
      el.removeAttribute("src");
      el.removeAttribute("srcset");
      continue;
    }
    const computed = getComputedStyle(liveEls[i]);
    const bg = computed.getPropertyValue("background-image");
    if (bg && bg.includes("url(")) {
      // Only the picture. A gradient in the same declaration survives.
      // Replaced rather than edited: a url() holding a data URL is itself
      // megabytes, and rewriting it in place would keep every byte.
      const gradients = bg
        .split(/,(?![^(]*\))/)
        .filter((layer) => !layer.includes("url("))
        .join(",");
      el.style.backgroundImage = gradients.trim() || "none";
    }
  }
}

/**
 * Stop the source drawing its pseudo-elements a second time.
 *
 * They have already been materialised into real children, so they are in the
 * serialised markup — but the rules that created them are still in the
 * stylesheet that goes to the rasteriser, and the browser dutifully draws
 * them again on top of themselves.
 *
 * For a scrim that is not a subtle error: an alpha of 0.76 composited over
 * itself is 0.94, and the source came out substantially darker than the page
 * it was standing in for. Every comparison then blamed the canvas for the
 * difference. Measured across the hero, the source read as alpha 0.90 where
 * it had declared 0.76.
 */
const SUPPRESS_PSEUDO = "*::before,*::after{content:none !important}";

/** One rasterised side as a PNG, for looking at rather than measuring. */
async function toPng(data: ImageData): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext("2d")?.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1];
}

/** Pixels of one rasterised side, at the comparison size. */
async function rasterise(
  html: string,
  width: number,
  height: number,
  background: string,
  scale: number,
  includeAppCss: boolean,
  extraCss = "",
): Promise<ImageData> {
  const { canvas, ctx, layer } = await renderVectors(
    html, width, height, background, scale, extraCss, includeAppCss,
  );
  ctx.drawImage(layer, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function registerCompareTools(): void {
  registerTool("compare_to_source", async (args) => {
    const nodeId = String(args.nodeId ?? "");
    const source = String(args.sourceHtml ?? "");
    if (!nodeId) throw new Error("nodeId is required — the artboard to check");
    if (!source.trim()) {
      throw new Error("sourceHtml is required; pass sourcePath and the server reads it");
    }

    const f = activeFile();
    const node = f.doc.nodes[nodeId];
    if (!node) throw new Error(`no node with id "${nodeId}"`);

    const el = document.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(nodeId)}"]`,
    );
    if (!el) throw new Error(`node "${nodeId}" is not currently rendered`);

    const width = Math.max(1, Math.round(node.width));
    const scale = Math.min(1, DIFF_MAX_SIDE / width);

    // The source, laid out at the width the artboard is designed for. Its own
    // height is whatever the content comes to — which is itself a finding,
    // because a reproduction that is a different height has lost or gained
    // something structural.
    // The source is rendered in a real document, not a div.
    //
    // Mounting a whole page inside a <div> gives it no <body>, no viewport
    // and no document to resolve against. Multi-column layout, viewport
    // units and percentage heights all behave differently there, and the
    // measured page came out 29,708px tall against a real 6,529 — so the
    // comparison was aligning the top fifth of one layout against the whole
    // of another, and the number it produced was meaningless.
    //
    // An iframe is a document. Media queries resolve against its width,
    // which is the artboard's width, which is the whole point.
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      `position:absolute;left:-99999px;top:0;border:0;visibility:hidden;` +
      `width:${width}px;height:1200px`;
    document.body.appendChild(frame);

    const loaded = new Promise<void>((done) => {
      frame.addEventListener("load", () => done(), { once: true });
      // srcdoc always fires load; the timeout is only so a pathological page
      // cannot hang the tool.
      setTimeout(done, 8000);
    });
    frame.srcdoc = source;
    await loaded;

    const fdoc = frame.contentDocument;
    if (!fdoc || !fdoc.body) {
      frame.remove();
      throw new Error("could not render the source page");
    }
    // Let images settle, so a photograph's box is its real box before the
    // height is taken.
    await Promise.all(
      Array.from(fdoc.images).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((r) => {
              img.addEventListener("load", () => r(), { once: true });
              img.addEventListener("error", () => r(), { once: true });
              setTimeout(r, 2000);
            }),
      ),
    );

    const sourceHeight = Math.max(
      1,
      Math.round(fdoc.documentElement.scrollHeight),
    );
    // The source's pseudo-elements have to become real too, or the two sides
    // are not comparable: the canvas has them as nodes, and XMLSerializer
    // cannot serialise a ::after — so the source would be rasterised without
    // the scrim the canvas is being marked against. The comparison would then
    // report a large difference in exactly the region where the conversion
    // had succeeded.
    for (const el of Array.from(fdoc.body.querySelectorAll<HTMLElement>("*"))) {
      const tag = el.tagName.toLowerCase();
      if (tag === "style" || tag === "script" || el.hasAttribute("data-pseudo")) continue;
      materialisePseudo(el, fdoc.body);

      // A page is rasterised a band at a time by shifting the markup up
      // inside a clipped window. Anything fixed ignores that shift — it is
      // fixed to the viewport, and the viewport is the band — so a sticky
      // navigation reappeared at the top of every band, while the canvas,
      // where it is an ordinary node, had it once at the top of the page.
      // Every band then differed across its full width for a reason that is
      // entirely an artefact of the measurement.
      //
      // Set from the computed style rather than by selector, because a real
      // page says `position: fixed` in a class, not inline.
      const view = fdoc.defaultView ?? window;
      const pos = view.getComputedStyle(el).position;
      if (pos === "fixed" || pos === "sticky") {
        el.style.position = pos === "sticky" ? "relative" : "absolute";
      }
    }
    neutralisePhotos(fdoc.body, fdoc.body);
    const sourceMarkup = new XMLSerializer()
      .serializeToString(fdoc.body)
      .replace(/^<body[^>]*>/, "")
      .replace(/<\/body>$/, "");
    // The page's own stylesheet travels with it — it is no longer inline on
    // each element, because the document resolved it natively.
    const sourceCss = Array.from(fdoc.querySelectorAll("style"))
      .map((tag) => tag.textContent ?? "")
      .join("\n");
    frame.remove();

    const canvasHeight = Math.max(1, Math.round(el.offsetHeight || node.height));

    // Compared over the region both actually cover. Anything past that is
    // reported as a height difference rather than counted as pixels wrong,
    // because a page that is short by a section would otherwise read as
    // "100% different" at the bottom and bury where it actually diverged.
    const common = Math.min(sourceHeight, canvasHeight);

    const clone = el.cloneNode(true) as HTMLElement;
    settle(clone);
    clone.style.margin = "0";
    // An artboard carries its own place on the canvas — position:absolute at
    // its world coordinates, which for the second board on a page is over a
    // thousand pixels to the right. Dropped into the comparison's own
    // wrapper it kept that, and sat entirely outside the window being
    // rasterised: the canvas side came back blank, and every region was
    // reported as wholly different from a source that had rendered fine.
    //
    // A blank raster is the worst possible failure here, because it looks
    // exactly like a total conversion failure rather than like a bug in the
    // measurement.
    clone.style.position = "relative";
    clone.style.left = "0";
    clone.style.top = "0";
    clone.style.right = "auto";
    clone.style.bottom = "auto";
    // The clone is detached, so it has no computed styles of its own; the
    // live element it was copied from is walked alongside it to supply them.
    neutralisePhotos(el, clone);
    // The canvas side needs XML too. Its own markup is well-formed, but a
    // text node carrying formatted runs holds markup lifted straight from the
    // source page, and that is HTML — so the same strictness applies.
    const canvasMarkup = new XMLSerializer().serializeToString(clone);

    // Compared a band at a time.
    //
    // A full page is six thousand pixels tall and the rasteriser will not
    // take that in one piece — past some height it returns nothing, with no
    // error and no clue which limit was hit. Banding bounds the raster
    // regardless of how long the page is, and costs only a wrapper per band:
    // the same markup, shifted up, clipped to a window.
    const attempt = async (
      label: string, markup: string, appCss: boolean, height: number,
      extraCss = "",
    ): Promise<ImageData> => {
      try {
        return await rasterise(markup, width, height, "#FFFFFF", scale, appCss, extraCss);
      } catch {
        throw new Error(
          `could not rasterise the ${label} side ` +
          `(${Math.round(markup.length / 1024)}KB of markup, ${width}x${height})`,
        );
      }
    };

    const band = (markup: string, top: number, height: number): string =>
      `<div style="position:relative;width:${width}px;height:${height}px;overflow:hidden">` +
      `<div style="position:absolute;left:0;top:${-top}px;width:${width}px">` +
      markup +
      `</div></div>`;

    const cells = new Map<string, { diff: number; total: number }>();
    let differing = 0;
    let total = 0;

    // When a region disagrees and the reason is not obvious, the two rasters
    // are the evidence. Returning them is the difference between diagnosing
    // this and guessing at it — which is worth one optional argument.
    const wantBand = args.debugBandAt === undefined
      ? null
      : Math.floor(Number(args.debugBandAt) / BAND_HEIGHT) * BAND_HEIGHT;
    const debug: Record<string, string> = {};

    for (let top = 0; top < common; top += BAND_HEIGHT) {
      const height = Math.min(BAND_HEIGHT, common - top);
      const sourceBand = band(sourceMarkup, top, height);
      const canvasBand = band(canvasMarkup, top, height);
      // The page's own faces go to the source side explicitly: the canvas gets
      // them with the app stylesheet, and without this the two sides would be
      // set in different fonts and every word would register as a difference.
      const a = await attempt(
        "source", sourceBand, false, height,
        `${adoptedFontCss()}\n${sourceCss}\n${SUPPRESS_PSEUDO}`,
      );
      const b = await attempt("canvas", canvasBand, true, height);

      if (wantBand === top) {
        debug.source = await toPng(a);
        debug.canvas = await toPng(b);
      }

      const w = Math.min(a.width, b.width);
      const h = Math.min(a.height, b.height);
      const cellW = Math.max(1, Math.floor(w / GRID_COLS));
      const cellH = Math.max(1, Math.round(BAND_HEIGHT * scale / 4));

      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * a.width + x) * 4;
          const j = (y * b.width + x) * 4;
          const apart =
            Math.abs(a.data[i] - b.data[j]) > CHANNEL_TOLERANCE ||
            Math.abs(a.data[i + 1] - b.data[j + 1]) > CHANNEL_TOLERANCE ||
            Math.abs(a.data[i + 2] - b.data[j + 2]) > CHANNEL_TOLERANCE;
          total += 1;
          // Keyed in page coordinates so a cell means the same thing in every
          // band, and the report reads as one page rather than a pile of them.
          const key = `${Math.floor(x / cellW)},${Math.floor((top * scale + y) / cellH)}`;
          const cell = cells.get(key) ?? { diff: 0, total: 0 };
          cell.total += 1;
          if (apart) {
            differing += 1;
            cell.diff += 1;
          }
          cells.set(key, cell);
        }
      }
    }

    const cellWOut = Math.max(1, Math.floor((width * scale) / GRID_COLS));
    const cellHOut = Math.max(1, Math.round(BAND_HEIGHT * scale / 4));
    const regions: Region[] = [];
    for (const [key, cell] of cells) {
      const share = cell.total ? cell.diff / cell.total : 0;
      if (share < 0.12) continue;
      const [cx, cy] = key.split(",").map(Number);
      regions.push({
        x: Math.round((cx * cellWOut) / scale),
        y: Math.round((cy * cellHOut) / scale),
        width: Math.round(cellWOut / scale),
        height: Math.round(cellHOut / scale),
        differing: Number(share.toFixed(2)),
      });
    }
    regions.sort((p, q) => q.differing - p.differing);

    const differingShare = total ? differing / total : 0;
    return {
      /** True when the reproduction is close enough that nothing stands out. */
      ok: differingShare < 0.02 && Math.abs(sourceHeight - canvasHeight) < 24,
      differingPercent: Number((differingShare * 100).toFixed(1)),
      height: {
        source: sourceHeight,
        canvas: canvasHeight,
        /** Negative means the reproduction is shorter — usually a lost section. */
        delta: canvasHeight - sourceHeight,
      },
      comparedAtWidth: width,
      /** Worst first, in source coordinates. Empty when nothing stands out. */
      regions: regions.slice(0, 12),
      ...(debug.source ? { debug } : {}),
      note:
        "Photographs are excluded from both sides; this measures layout, " +
        "type, colour and anything drawn with CSS.",
    };
  });
}
