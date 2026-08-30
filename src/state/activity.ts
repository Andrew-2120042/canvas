import { create } from "zustand";

/**
 * What the agent is doing to the canvas, for the user to watch.
 *
 * Deliberately separate from the document: this is presentation, and none of
 * it should be persisted, undone, or synced. The document records what the
 * canvas *is*; this records what is happening to it right now.
 */

/**
 * How long a group's entrance takes, start to finish.
 *
 * One timeline for the whole group, not per node — see `noteWrite`.
 */
const REVEAL_MS = 900;

/**
 * How much of that is the structure phase.
 *
 * The group holds at a low opacity while its outlines are drawn, then paint
 * fades up and the outlines fade out. Kept here rather than only in CSS
 * because the overlay drawing those outlines has to run on the same clock.
 */
const STRUCTURE_MS = 500;

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
  noteWrite: (op: string, ids: string[], roots?: string[]) => void;
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

  noteWrite: (op, ids, roots) => {
    const now = Date.now();
    const state = get();

    // Only the roots of this write get an entrance, and they all get the
    // same one. Staggering per node meant a container arrived separately
    // from its own contents — and because a subtree is built depth-first,
    // it arrived *after* them, so a button appeared as loose text that a
    // box later wrapped itself around. A group is one thing appearing, so
    // it is one animation, and every child inherits it from its root.
    const entering = roots && roots.length ? roots : ids;
    const arrivals = { ...state.arrivals };
    for (const id of entering) arrivals[id] = now;

    set({
      building: true,
      status: `${describe(op)}…`,
      touched: [...new Set([...state.touched, ...ids])],
      arrivals,
    });

    setTimeout(() => {
      const cur = get().arrivals;
      const next: Record<string, number> = {};
      for (const [id, at] of Object.entries(cur)) {
        if (at + REVEAL_MS > Date.now()) next[id] = at;
      }
      set({ arrivals: next });
    }, REVEAL_MS + 50);
  },

  endBuild: () => {
    set({ building: false, status: "Done" });
    setTimeout(() => {
      // Only clear if nothing new started in the meantime.
      if (!get().building) set({ status: null, touched: [] });
    }, DONE_MS);
  },
}));

export { REVEAL_MS, STRUCTURE_MS };
