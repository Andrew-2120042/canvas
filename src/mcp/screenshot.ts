import { invoke } from "@tauri-apps/api/core";
import { activeFile, worldRect } from "../document/store";
import type { Doc, NodeId } from "../document/types";
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

/**
 * A live element as markup the foreignObject can re-parse.
 *
 * The wrapper is an SVG data URL, so what goes inside is read as XML, not
 * HTML. `outerHTML` produces HTML: void elements come back unclosed, and a
 * nested `<svg>` loses the namespace that HTML leaves implicit — which is why
 * an inline icon captured this way rendered as nothing at all. XMLSerializer
 * writes both correctly.
 */
function serialise(el: Element): string {
  return new XMLSerializer().serializeToString(el);
}

/**
 * A photograph the capture has to draw itself.
 *
 * Images cannot ride along inside the SVG. The rasteriser wraps the DOM in an
 * SVG data URL, and a data URL has a null origin, so an `asset://` reference
 * inside it never loads; embedding the bytes instead works only up to a point,
 * measured here at somewhere between a 200px and an 800px image — past that
 * the whole SVG silently fails to paint. Neither is a size a design tool can
 * live with.
 *
 * So the photographs are lifted out and drawn straight onto the output canvas
 * afterwards, at their real resolution, with the SVG left to do the vector
 * work it is good at.
 */
interface Photo {
  /** The node it belongs to, so the capture can hide the original fill. */
  id: NodeId;
  /** Where it sits in the captured image, in world units. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The rect it must not paint outside of, from the nearest clipping frame. */
  clip: { x: number; y: number; width: number; height: number } | null;
  src: string;
}

/** Every image node under `roots`, with the geometry needed to redraw it. */
function collectPhotos(doc: Doc, roots: NodeId[]): Photo[] {
  const out: Photo[] = [];

  const walk = (
    id: NodeId,
    clip: Photo["clip"],
  ): void => {
    const node = doc.nodes[id];
    if (!node || !node.visible) return;
    const rect = worldRect(doc, id);
    if (!rect) return;

    // Any node can carry a picture, not only image nodes — a hero frame with
    // a photograph behind its children is the common case.
    if (node.src) {
      out.push({ id, ...rect, clip, src: node.src });
    }

    // A frame that clips constrains everything inside it, including any
    // clipping already inherited from further up.
    const next = node.clipContent
      ? clip
        ? {
            x: Math.max(clip.x, rect.x),
            y: Math.max(clip.y, rect.y),
            width: Math.min(clip.x + clip.width, rect.x + rect.width) - Math.max(clip.x, rect.x),
            height: Math.min(clip.y + clip.height, rect.y + rect.height) - Math.max(clip.y, rect.y),
          }
        : rect
      : clip;

    for (const child of node.children) walk(child, next);
  };

  for (const root of roots) walk(root, null);
  return out;
}

/** The bytes of one image, as something a canvas can draw without tainting. */
async function loadPhoto(src: string): Promise<HTMLImageElement | null> {
  let source = src;
  if (!/^(data:|blob:|https?:)/i.test(src)) {
    // A path on disk. Read through the app rather than fetching the asset URL:
    // drawing that taints the canvas and the result cannot be read back.
    try {
      source = await invoke<string>("read_image_data_url", { path: src });
    } catch {
      return null;
    }
  }
  const img = new Image();
  img.src = source;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/**
 * Draw the photographs over the rasterised vector layer.
 *
 * `background-size: cover` is what the canvas renders these with, so the same
 * crop is reproduced here: scale to fill, then centre and take the middle.
 */
async function drawPhotos(
  ctx: CanvasRenderingContext2D,
  photos: Photo[],
  originX: number,
  originY: number,
): Promise<void> {
  for (const photo of photos) {
    const img = await loadPhoto(photo.src);
    if (!img || !img.naturalWidth || !img.naturalHeight) continue;

    ctx.save();
    if (photo.clip && photo.clip.width > 0 && photo.clip.height > 0) {
      ctx.beginPath();
      ctx.rect(
        photo.clip.x - originX, photo.clip.y - originY,
        photo.clip.width, photo.clip.height,
      );
      ctx.clip();
    }

    const scale = Math.max(
      photo.width / img.naturalWidth,
      photo.height / img.naturalHeight,
    );
    const sw = photo.width / scale;
    const sh = photo.height / scale;
    ctx.drawImage(
      img,
      (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh,
      photo.x - originX, photo.y - originY, photo.width, photo.height,
    );
    ctx.restore();
  }
}

/**
 * A stylesheet rule that hides the photographs inside the capture.
 *
 * Nothing is mutated. Editing the cloned element's styles was the previous
 * approach and it broke the capture outright: the clone is detached, so
 * `getComputedStyle` has nothing to report, and rewriting a `background`
 * shorthand from that produced markup the foreignObject refused to render —
 * silently, taking every other element on the page with it.
 *
 * Targeting the nodes by id from the injected stylesheet leaves the markup
 * exactly as the browser produced it.
 */
function hidePhotosRule(photos: Photo[]): string {
  if (photos.length === 0) return "";
  const selector = photos
    .map((p) => `[data-node-id="${CSS.escape(p.id)}"]`)
    .join(",");
  return `${selector}{background-image:none !important}`;
}

async function renderVectors(
  html: string, width: number, height: number, background: string, scale: number,
  extraCss = "",
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const css = collectCss() + extraCss;
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

  return { canvas, ctx };
}

export function registerScreenshotTool(): void {
  registerTool("get_screenshot", async (args) => {
    const f = activeFile();
    const page = f.doc.pages[f.currentPageId];
    const nodeId = args.nodeId ? String(args.nodeId) : null;

    let box: { x: number; y: number; width: number; height: number };
    let html: string;
    let photos: Photo[] = [];
    let originX = 0;
    let originY = 0;

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
      photos = collectPhotos(f.doc, [nodeId]);
      // The capture places the node at PADDING with its own offset zeroed, so
      // world coordinates shift by exactly that.
      originX = rect.x - PADDING;
      originY = rect.y - PADDING;
      html =
        `<div style="position:relative;width:${box.width}px;height:${box.height}px">` +
        `<div style="position:absolute;left:${PADDING}px;top:${PADDING}px;` +
        `width:${rect.width}px;height:${rect.height}px">` +
        serialise(clone) +
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
      const copies = Array.from(layer.children).map((child) => {
        return child.cloneNode(true) as HTMLElement;
      });
      photos = collectPhotos(f.doc, page.children);
      originX = box.x;
      originY = box.y;
      html =
        `<div style="position:relative;width:${box.width}px;height:${box.height}px;overflow:hidden">` +
        `<div style="position:absolute;left:${-box.x}px;top:${-box.y}px">` +
        copies.map(serialise).join("") +
        `</div></div>`;
    }

    // Never larger than asked for, and never larger than the cap.
    //
    // This used to be `min(2, …)`, which silently doubled every capture small
    // enough to allow it. A screenshot is the most expensive thing this server
    // returns — its cost is proportional to pixel count — and a 2x image of a
    // 300px component costs four times a 1x one while showing nothing more.
    // Detail is available on request; it is no longer the default.
    const asked = args.scale === undefined ? 1 : Math.max(0.25, Math.min(2, Number(args.scale)));
    const scale = Math.min(asked, MAX_SIDE / Math.max(box.width, box.height));
    const { canvas, ctx } = await renderVectors(
      html, box.width, box.height, page.background, Math.max(scale, 0.1),
      hidePhotosRule(photos),
    );
    // Photographs go on last, at full resolution, over the vector layer.
    await drawPhotos(ctx, photos, originX, originY);
    const data = canvas.toDataURL("image/png").split(",")[1];
    return {
      mimeType: "image/png",
      base64: data,
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  });
}
