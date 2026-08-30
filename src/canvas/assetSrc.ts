import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * An image source the webview can actually load.
 *
 * A design references photographs that live on disk, often several megabytes
 * each. Making an agent inline those as base64 is what turned one hero section
 * into a ten-minute job: the file has to be read, re-encoded, and pushed
 * through a tool call whose whole payload is text, so the only way to fit is
 * to destroy the image first — the 4MB photograph that arrived as a 5KB
 * data URL is exactly that compromise, and it looks like it.
 *
 * A path costs about forty characters instead, and the picture stays whole.
 * The stored document keeps the plain path, so the file remains small and
 * readable; the conversion to a protocol URL happens here, at render time.
 */
export function imageSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  // Already something the webview understands.
  if (/^(data:|blob:|https?:|asset:)/i.test(src)) return src;

  // file:// and bare absolute paths both name a local file.
  const path = src.startsWith("file://") ? decodeURI(src.slice(7)) : src;
  if (!path.startsWith("/")) return src;

  try {
    return convertFileSrc(path);
  } catch {
    // Outside the allowed scope, or no Tauri host — leave it be so the
    // failure is a missing image rather than a crash.
    return src;
  }
}
