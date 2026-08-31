import { create } from "zustand";

/**
 * Whether every artboard must be laid out, or only the ones being looked at.
 *
 * The canvas scales with CSS `zoom` rather than a transform, deliberately:
 * that is what makes the browser lay the subtree out at the magnified size and
 * rasterise glyphs there, so type stays sharp all the way in. The cost is that
 * a zoom step is a layout pass, and a layout pass is proportional to how many
 * boxes exist — not to how many are on screen. A file with twenty artboards on
 * a page pays for all twenty on every step, however few are visible, so the
 * canvas got heavier to move the more work was on it.
 *
 * Artboards far outside the viewport are therefore left out of the tree. The
 * exception is measurement: the tools read geometry straight from the DOM, and
 * an artboard that is not laid out has no geometry to read. So while a tool
 * call is in flight everything is rendered, which is correct rather than fast
 * — and the right way round, because a tool call is occasional and a wheel
 * event is not.
 */
interface RenderStore {
  /** True while something needs the whole page laid out. */
  all: boolean;
  /** Hold the full tree open until `ms` from now. */
  holdOpen: (ms: number) => void;
}

let until = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export const useRenderAll = create<RenderStore>((set) => ({
  all: false,
  holdOpen: (ms) => {
    until = Math.max(until, Date.now() + ms);
    set({ all: true });
    if (timer) clearTimeout(timer);
    const tick = () => {
      const left = until - Date.now();
      if (left > 0) {
        timer = setTimeout(tick, left);
        return;
      }
      timer = null;
      set({ all: false });
    };
    timer = setTimeout(tick, ms);
  },
}));

/**
 * Lay the whole page out, let the browser catch up, then run `fn`.
 *
 * Two frames rather than one: the first commits React's render, the second is
 * where layout has actually happened and geometry can be read.
 */
export async function withEverythingRendered<T>(fn: () => T | Promise<T>): Promise<T> {
  useRenderAll.getState().holdOpen(4000);
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  return await fn();
}
