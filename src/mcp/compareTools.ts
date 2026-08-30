import { activeFile } from "../document/store";
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
const GRID_ROWS = 12;

interface Region {
  /** In the source page's own coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Share of pixels in this cell that differ, 0..1. */
  differing: number;
}

/** Pixels of one rasterised side, at the comparison size. */
async function rasterise(
  html: string,
  width: number,
  height: number,
  background: string,
  scale: number,
  includeAppCss: boolean,
): Promise<ImageData> {
  const { canvas, ctx, layer } = await renderVectors(
    html, width, height, background, scale, "", includeAppCss,
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
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;left:-99999px;top:0;visibility:hidden;" +
      `width:${width}px;contain:layout style`;
    probe.innerHTML = source;
    document.body.appendChild(probe);
    void probe.offsetWidth;
    const sourceHeight = Math.max(1, Math.round(probe.scrollHeight));
    const sourceMarkup = probe.innerHTML;
    probe.remove();

    const canvasHeight = Math.max(1, Math.round(el.offsetHeight || node.height));

    // Compared over the region both actually cover. Anything past that is
    // reported as a height difference rather than counted as pixels wrong,
    // because a page that is short by a section would otherwise read as
    // "100% different" at the bottom and bury where it actually diverged.
    const common = Math.min(sourceHeight, canvasHeight);

    const clone = el.cloneNode(true) as HTMLElement;
    settle(clone);
    clone.style.margin = "0";
    const canvasMarkup =
      `<div style="position:relative;width:${width}px;height:${common}px;overflow:hidden">` +
      clone.outerHTML +
      `</div>`;
    const sourceWrapped =
      `<div style="position:relative;width:${width}px;height:${common}px;overflow:hidden">` +
      sourceMarkup +
      `</div>`;

    const [a, b] = await Promise.all([
      rasterise(sourceWrapped, width, common, "#FFFFFF", scale, false),
      rasterise(canvasMarkup, width, common, "#FFFFFF", scale, true),
    ]);

    const w = Math.min(a.width, b.width);
    const h = Math.min(a.height, b.height);
    const cellW = Math.max(1, Math.floor(w / GRID_COLS));
    const cellH = Math.max(1, Math.floor(h / GRID_ROWS));
    const cells = new Map<string, { diff: number; total: number }>();

    let differing = 0;
    let total = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * a.width + x) * 4;
        const j = (y * b.width + x) * 4;
        const apart =
          Math.abs(a.data[i] - b.data[j]) > CHANNEL_TOLERANCE ||
          Math.abs(a.data[i + 1] - b.data[j + 1]) > CHANNEL_TOLERANCE ||
          Math.abs(a.data[i + 2] - b.data[j + 2]) > CHANNEL_TOLERANCE;
        total += 1;
        const key = `${Math.floor(x / cellW)},${Math.floor(y / cellH)}`;
        const cell = cells.get(key) ?? { diff: 0, total: 0 };
        cell.total += 1;
        if (apart) {
          differing += 1;
          cell.diff += 1;
        }
        cells.set(key, cell);
      }
    }

    const regions: Region[] = [];
    for (const [key, cell] of cells) {
      const share = cell.total ? cell.diff / cell.total : 0;
      if (share < 0.12) continue;
      const [cx, cy] = key.split(",").map(Number);
      regions.push({
        // Back into the source page's coordinates, which is where the caller
        // has to go to fix it.
        x: Math.round((cx * cellW) / scale),
        y: Math.round((cy * cellH) / scale),
        width: Math.round(cellW / scale),
        height: Math.round(cellH / scale),
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
      note:
        "Photographs are excluded from both sides; this measures layout, " +
        "type, colour and anything drawn with CSS.",
    };
  });
}
