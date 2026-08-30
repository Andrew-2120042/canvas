import { useDoc } from "../document/store";
import { useActivity } from "../state/activity";

/**
 * Groups an agent's writes into one undoable build.
 *
 * A build is one instruction that happens to produce many writes. Undo should
 * take the whole attempt back in a single press — "no, not that" — rather
 * than peeling it apart node by node. If one piece of twelve is wrong, that
 * is ordinary canvas editing: click it and fix it.
 *
 * Opened lazily by the first write rather than when a turn starts, so a turn
 * that only reads never creates an empty history entry. Closed when the turn
 * ends, or by a quiet period if no end ever arrives.
 */

/** How long without a write before a build is assumed finished. */
const IDLE_CLOSE_MS = 4000;

let open = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function closeNow(): void {
  if (!open) return;
  open = false;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  useDoc.getState().endBuild();
  useActivity.getState().endBuild();
}

/** Called by every agent write; opens the build if one is not already open. */
export function noteAgentWrite(
  op = "work",
  ids: string[] = [],
  /** The group roots, when the write has a shape — see activity.noteWrite. */
  roots?: string[],
): void {
  if (!open) {
    open = true;
    useDoc.getState().beginBuild();
    useActivity.getState().beginBuild();
  }
  useActivity.getState().noteWrite(op, ids, roots);
  // A build with no explicit end — an agent that crashes mid-turn, say —
  // must not swallow the user's next edit into itself.
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(closeNow, IDLE_CLOSE_MS);
}

/** Called when the agent's turn finishes. */
export function endAgentBuild(): void {
  closeNow();
}
