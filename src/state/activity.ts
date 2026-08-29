import { create } from "zustand";

/**
 * What the agent is doing to the canvas, for the user to watch.
 *
 * Deliberately separate from the document: this is presentation, and none of
 * it should be persisted, undone, or synced. The document records what the
 * canvas *is*; this records what is happening to it right now.
 */

/** How long a node keeps its "just arrived" treatment. */
const ARRIVAL_MS = 900;
/** Gap between staggered arrivals, so a burst plays as a build. */
const STAGGER_MS = 110;
/** How long a finished build keeps its chip before fading out. */
const DONE_MS = 1600;

interface ActivityStore {
  /** True while the agent is writing. */
  building: boolean;
  /** Short description of the current step, for the chip. */
  status: string | null;
  /** Nodes the agent has touched this build, newest last. */
  touched: string[];
  /** Nodes still playing their entrance, with the time they should start. */
  arrivals: Record<string, number>;

  beginBuild: () => void;
  noteWrite: (op: string, ids: string[]) => void;
  endBuild: () => void;
}

/** Human wording for a tool name. */
function describe(op: string): string {
  switch (op) {
    case "create": return "Adding";
    case "update": return "Adjusting";
    case "delete": return "Removing";
    case "duplicate": return "Duplicating";
    default: return "Working";
  }
}

export const useActivity = create<ActivityStore>((set, get) => ({
  building: false,
  status: null,
  touched: [],
  arrivals: {},

  beginBuild: () =>
    set({ building: true, status: "Designing", touched: [], arrivals: {} }),

  noteWrite: (op, ids) => {
    const now = Date.now();
    const state = get();
    // Stagger from the end of the queue, so a burst of calls plays out at a
    // steady rate rather than landing on screen all at once.
    const queued = Object.values(state.arrivals).filter((t) => t > now).length;
    const arrivals = { ...state.arrivals };
    ids.forEach((id, i) => {
      arrivals[id] = now + (queued + i) * STAGGER_MS;
    });
    set({
      building: true,
      status: `${describe(op)}…`,
      touched: [...new Set([...state.touched, ...ids])],
      arrivals,
    });

    // Clear each arrival once its entrance has played.
    const last = Math.max(...Object.values(arrivals), now);
    setTimeout(() => {
      const cur = get().arrivals;
      const next: Record<string, number> = {};
      for (const [id, at] of Object.entries(cur)) {
        if (at + ARRIVAL_MS > Date.now()) next[id] = at;
      }
      set({ arrivals: next });
    }, last - now + ARRIVAL_MS + 50);
  },

  endBuild: () => {
    set({ building: false, status: "Done" });
    setTimeout(() => {
      // Only clear if nothing new started in the meantime.
      if (!get().building) set({ status: null, touched: [] });
    }, DONE_MS);
  },
}));

export { ARRIVAL_MS, STAGGER_MS };
