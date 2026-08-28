import { useDoc } from "../document/store";
import { useTool } from "../state/tools";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
/** Images are embedded as data URLs so a document stays a single JSON file.
 *  Larger assets need real asset storage, which is Cloudflare R2 in Phase 4. */
const MAX_BYTES = 8 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function measure(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    // An SVG without intrinsic dimensions still needs a sane default box.
    img.onerror = () => resolve({ width: 300, height: 200 });
    img.src = src;
  });
}

/**
 * Pick a local image and place it at a world point, scaled to fit a sensible
 * box while keeping its aspect ratio.
 */
export async function placeImageAt(x: number, y: number): Promise<void> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ACCEPT;

  const file = await new Promise<File | null>((resolve) => {
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
  if (!file) {
    useTool.getState().setTool("move");
    return;
  }
  if (file.size > MAX_BYTES) {
    console.warn("[image] too large to embed:", file.size);
    useTool.getState().setTool("move");
    return;
  }

  const src = await readAsDataUrl(file);
  const nat = await measure(src);

  const MAX_SIDE = 480;
  const scale = Math.min(1, MAX_SIDE / Math.max(nat.width, nat.height));
  const width = Math.max(1, Math.round(nat.width * scale));
  const height = Math.max(1, Math.round(nat.height * scale));

  const st = useDoc.getState();
  const id = st.addNode("image", { x, y, width, height });
  st.updateNode(id, {
    name: file.name.replace(/\.[^.]+$/, ""),
    src,
    naturalWidth: nat.width,
    naturalHeight: nat.height,
  });
  st.select([id]);
  useTool.getState().setTool("move");
}
