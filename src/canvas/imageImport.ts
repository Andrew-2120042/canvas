import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useDoc } from "../document/store";
import { useTool } from "../state/tools";

/** Longest side a placed image is scaled to, so a large photo does not
 *  arrive filling the whole canvas. */
const MAX_SIDE = 480;

function measure(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    // An SVG with no intrinsic size still needs a sane default box.
    img.onerror = () => resolve({ width: 300, height: 200 });
    img.src = src;
  });
}

/**
 * Pick a local image and place it at a world point, scaled to fit while
 * keeping its aspect ratio.
 *
 * Uses the native dialog rather than an HTML file input: WKWebView does not
 * open file pickers for `<input type="file">`, so the input silently does
 * nothing. The bytes are read in Rust and returned as a data URL, which also
 * avoids granting the frontend filesystem scope over arbitrary paths.
 */
export async function placeImageAt(x: number, y: number): Promise<void> {
  const done = () => useTool.getState().setTool("move");
  try {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
    });
    if (typeof picked !== "string") return done();

    const src = await invoke<string>("read_image_data_url", { path: picked });
    const nat = await measure(src);

    const scale = Math.min(1, MAX_SIDE / Math.max(nat.width, nat.height));
    const width = Math.max(1, Math.round(nat.width * scale));
    const height = Math.max(1, Math.round(nat.height * scale));

    const name = picked.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "Image";
    const st = useDoc.getState();
    const id = st.addNode("image", { x, y, width, height });
    st.updateNode(id, { name, src, naturalWidth: nat.width, naturalHeight: nat.height });
    st.select([id]);
  } catch (err) {
    console.warn("[image] import failed", err);
  } finally {
    done();
  }
}
