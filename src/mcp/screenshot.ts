import { invoke } from "@tauri-apps/api/core";
import { activeFile, worldRect } from "../document/store";
import type { Doc, NodeId } from "../document/types";
import { registerTool } from "./bridge";

/** Cap so a huge frame cannot produce an unusable multi-megabyte image. */
/**
 * The long edge of a capture, in pixels.
 *
 * A screenshot costs tokens in proportion to its pixel count, and reviewing
 * a layout — is it aligned, does it fit, is the rhythm right — does not need
 * the detail that reading small text does. So the default is sized for the
 * former, and the larger cap is available only when detail is asked for.
 */
const REVIEW_MAX_SIDE = 1024;
const DETAIL_MAX_SIDE = 1600;
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
): Promise<number> {
  let drawn = 0;
  for (const photo of photos) {
    const img = await loadPhoto(photo.src);
    if (!img || !img.naturalWidth || !img.naturalHeight) continue;
    drawn += 1;

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
  return drawn;
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
function hidePhotosRule(doc: Doc, photos: Photo[]): string {
  if (photos.length === 0) return "";

  // Not only the photo's own node. A photograph is drawn in the pass beneath
  // this one, so anything painting a fill between it and the viewer covers it
  // — and that includes every frame it sits inside, up to and including the
  // artboard's own white. Clearing the whole chain leaves the vector layer
  // transparent down to the picture, so the picture shows and everything
  // stacked on it still paints on top.
  const ids = new Set<NodeId>();
  for (const photo of photos) {
    let cur: NodeId | null = photo.id;
    while (cur) {
      ids.add(cur);
      cur = doc.nodes[cur]?.parent ?? null;
    }
  }
  const selector = [...ids]
    .map((id) => `[data-node-id="${CSS.escape(id)}"]`)
    .join(",");
  return `${selector}{background:none !important}`;
}

/**
 * Take the entrance animation off a copy.
 *
 * A node the agent just made carries `is-arriving`, whose keyframes start at
 * `opacity: 0` with `backwards` fill — so until the animation runs, the node
 * is invisible. Nothing animates inside a rasterised SVG, so every node still
 * mid-entrance rendered as nothing at all, and a capture taken right after a
 * write came back blank. The capture wants the settled state, which is what
 * the animation was on its way to.
 */
export function settle(root: HTMLElement): void {
  for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
    el.classList?.remove("is-arriving", "is-building");
    if (el.style) {
      el.style.animation = "none";
      el.style.animationDelay = "";
      el.style.opacity = el.style.opacity === "0" ? "" : el.style.opacity;
    }
  }
}

export async function renderVectors(
  html: string, width: number, height: number, background: string, scale: number,
  extraCss = "",
  /**
   * Whether to include the canvas's own stylesheet.
   *
   * A capture of the canvas needs it — that is where a node gets its
   * box-sizing and its text rendering. A capture of somebody else's page must
   * not have it, or the comparison is measuring our stylesheet's effect on
   * their markup rather than the difference between the two designs.
   */
  includeAppCss = true,
): Promise<{
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  layer: HTMLImageElement;
}> {
  const css = (includeAppCss ? collectCss() : "") + extraCss;
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

  // Deliberately not painted yet.
  //
  // A photograph cannot travel inside this SVG: measured, an image stops
  // loading somewhere between 300px and 500px on its longest side — around a
  // hundred kilobytes of data URL — and it fails silently, leaving a hole
  // where the picture should be. At 300px it is far too soft to review. So
  // the photographs are drawn straight onto the canvas in a separate pass,
  // and the only thing that matters is which pass goes first.
  //
  // On this canvas a photograph is always a node's background, so everything
  // in the vector layer — the node's own children, later siblings, a headline
  // sitting on the picture — belongs above it. Painting the vectors first and
  // the photographs after put every one of those underneath, which is what
  // made an agent conclude images always cover their siblings and flatten a
  // whole design to work around it.
  return { canvas, ctx, layer: img };
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
      settle(clone);
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
        const copy = child.cloneNode(true) as HTMLElement;
        settle(copy);
        return copy;
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
    // Never larger than asked for, and never past the cap for that intent.
    //
    // This used to be `min(2, …)`, which silently doubled every capture small
    // enough to allow it — four times the pixels, and four times the cost,
    // for detail nobody had asked to see.
    const cap = asked > 1 ? DETAIL_MAX_SIDE : REVIEW_MAX_SIDE;
    const scale = Math.min(asked, cap / Math.max(box.width, box.height));
    // The ground is the captured node's own fill where it has one, because
    // that fill is no longer painted in the vector layer.
    const ground = nodeId
      ? f.doc.nodes[nodeId]?.fill ?? page.background
      : page.background;
    const { canvas, ctx, layer } = await renderVectors(
      html, box.width, box.height,
      ground && ground !== "transparent" ? ground : page.background,
      Math.max(scale, 0.1),
      hidePhotosRule(f.doc, photos),
    );
    // Backgrounds first, then everything that sits on them.
    await drawPhotos(ctx, photos, originX, originY);
    ctx.drawImage(layer, 0, 0);
    const data = canvas.toDataURL("image/png").split(",")[1];
    // The rendered size, not the logical one. Reporting the box while the
    // raster was a different size hid what a capture actually cost, from the
    // caller deciding whether to take another one and from anyone reading the
    // transcript afterwards.
    return {
      mimeType: "image/png",
      base64: data,
      width: canvas.width,
      height: canvas.height,
      /** What the capture covers in canvas units, whatever it was rendered at. */
      region: {
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
    };
  });
}
