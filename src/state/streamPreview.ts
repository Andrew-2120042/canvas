import { create } from "zustand";
import { healHtml } from "../document/html/healHtml";

/**
 * A design being written, shown while it is still being written.
 *
 * An agent composes a write_html call over several seconds. Without this the
 * canvas shows nothing for all of them and then the finished design at once,
 * which is the black box the whole build experience exists to avoid. With it
 * the markup appears as it is typed.
 *
 * Two things are deliberately separated here: what has arrived, and what is
 * shown. A model emits tokens in bursts — a long pause, then a paragraph — so
 * rendering each burst as it lands reads as stuttering rather than building.
 * Everything received accumulates in `full`, and a timer walks `shown`
 * towards it at a steady rate. The build plays smoothly whatever the network
 * and the model did, and a call whose arguments arrive in one piece still
 * plays back as a build rather than a flash.
 *
 * None of this is the document. The preview is markup rendered in an overlay
 * and nothing here is ever committed — when the call completes, the real
 * write_html parses the real markup and the preview disappears. So a healed
 * fragment can never become a node, and a half-written design cannot enter
 * the undo history.
 */

/** How often the preview advances. Below about 20fps it reads as stepping. */
const TICK_MS = 50;
/** Characters revealed per tick when there is no backlog. */
const BASE_RATE = 90;
/**
 * How quickly a backlog is worked off.
 *
 * The preview must not fall behind the call itself — finishing the animation
 * long after the design has actually landed would be a lie about progress —
 * so a large pending buffer is drained proportionally rather than at a fixed
 * rate.
 */
const CATCH_UP = 10;

interface StreamPreviewStore {
  /** The frame being written into, or null when nothing is streaming. */
  targetId: string | null;
  /** Everything received so far. */
  full: string;
  /** How much of it is currently shown. */
  shown: number;
  /** The healed markup to render right now. */
  html: string;

  /** Begin (or continue) a stream into a frame. */
  feed: (targetId: string | null, markup: string) => void;
  /** The call finished or failed; drop the preview. */
  end: () => void;
}

let timer: ReturnType<typeof setInterval> | null = null;

export const useStreamPreview = create<StreamPreviewStore>((set, get) => ({
  targetId: null,
  full: "",
  shown: 0,
  html: "",

  feed: (targetId, markup) => {
    const state = get();
    // Markup only ever grows within a call; a shorter value means a new call
    // reusing the stream, so the preview restarts rather than rewinding.
    const restart = targetId !== state.targetId || markup.length < state.full.length;
    set({
      targetId,
      full: markup,
      shown: restart ? 0 : state.shown,
      html: restart ? "" : state.html,
    });

    if (timer) return;
    timer = setInterval(() => {
      const s = get();
      if (s.targetId === null) return;
      const pending = s.full.length - s.shown;
      if (pending <= 0) return;
      const step = Math.max(BASE_RATE, Math.ceil(pending / CATCH_UP));
      const shown = Math.min(s.full.length, s.shown + step);
      set({ shown, html: healHtml(s.full.slice(0, shown)) });
    }, TICK_MS);
  },

  end: () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    set({ targetId: null, full: "", shown: 0, html: "" });
  },
}));
