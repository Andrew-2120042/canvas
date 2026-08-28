import { activeFile, worldRect } from "../document/store";
import { registerTool } from "./bridge";

/** Cap so a huge frame cannot produce an unusable multi-megabyte image. */
const MAX_SIDE = 1600;
const PADDING = 16;

/**
 * Rasterise the live DOM rather than re-drawing the scene.
 *
 * The product bet is that the canvas *is* real DOM, so a screenshot that goes
 * through a second renderer could disagree with what the user sees — exactly
 * the drift the bet exists to avoid. Wrapping the real nodes in an SVG
 * foreignObject keeps one renderer.
 */

/** The app's own stylesheet text, so class-based rules survive the copy. */
function collectCss(): string {
  let out = "";
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out += rule.cssText + "\n";
    } catch {
      // A cross-origin sheet cannot be read; ours are same-origin.
    }
  }
  return out;
}

async function renderToPng(
  html: string, width: number, height: number, background: string, scale: number,
): Promise<string> {
  const css = collectCss();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml">` +
    `<style>${css}</style>${html}` +
    `</div></foreignObject></svg>`;

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("could not rasterise the canvas"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context available");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.drawImage(img, 0, 0);

  return canvas.toDataURL("image/png").split(",")[1];
}

export function registerScreenshotTool(): void {
  registerTool("get_screenshot", async (args) => {
    const f = activeFile();
    const page = f.doc.pages[f.currentPageId];
    const nodeId = args.nodeId ? String(args.nodeId) : null;

    let box: { x: number; y: number; width: number; height: number };
    let html: string;

    if (nodeId) {
      const rect = worldRect(f.doc, nodeId);
      if (!rect) throw new Error(`no node with id "${nodeId}"`);
      const el = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
      if (!el) throw new Error(`node "${nodeId}" is not currently rendered`);
      box = {
        x: -PADDING, y: -PADDING,
        width: rect.width + PADDING * 2, height: rect.height + PADDING * 2,
      };
      // The node carries a left/top for its place inside its parent. In an
      // isolated capture that offset is meaningless, so zero it on the copy
      // and let the padding wrapper do the positioning.
      const clone = (el as HTMLElement).cloneNode(true) as HTMLElement;
      clone.style.left = "0px";
      clone.style.top = "0px";
      html =
        `<div style="position:relative;width:${box.width}px;height:${box.height}px">` +
        `<div style="position:absolute;left:${PADDING}px;top:${PADDING}px;` +
        `width:${rect.width}px;height:${rect.height}px">` +
        clone.outerHTML +
        `</div></div>`;
    } else {
      // Whole page: the union of everything on it.
      const rects = page.children
        .map((id) => worldRect(f.doc, id))
        .filter((r): r is NonNullable<typeof r> => !!r);
      if (rects.length === 0) throw new Error("the page is empty; nothing to capture");
      const minX = Math.min(...rects.map((r) => r.x));
      const minY = Math.min(...rects.map((r) => r.y));
      const maxX = Math.max(...rects.map((r) => r.x + r.width));
      const maxY = Math.max(...rects.map((r) => r.y + r.height));
      box = {
        x: minX - PADDING, y: minY - PADDING,
        width: maxX - minX + PADDING * 2, height: maxY - minY + PADDING * 2,
      };
      const layer = document.querySelector(".canvas-content");
      if (!layer) throw new Error("the canvas is not rendered");
      html =
        `<div style="position:relative;width:${box.width}px;height:${box.height}px;overflow:hidden">` +
        `<div style="position:absolute;left:${-box.x}px;top:${-box.y}px">` +
        (layer as HTMLElement).innerHTML +
        `</div></div>`;
    }

    const scale = Math.min(2, MAX_SIDE / Math.max(box.width, box.height));
    const data = await renderToPng(
      html, box.width, box.height, page.background, Math.max(scale, 0.1),
    );
    return {
      mimeType: "image/png",
      base64: data,
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  });
}
