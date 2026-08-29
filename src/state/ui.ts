import { create } from "zustand";

interface UiStore {
  /** Node ids whose children are shown in the layer tree. */
  expanded: Record<string, boolean>;
  toggleExpanded: (id: string) => void;
  pagesOpen: boolean;
  togglePages: () => void;
  /** Hide the left and right panels together, for a wider canvas. One
   *  control for both: they are two halves of the same "chrome or canvas"
   *  decision, and separate toggles made that a two-step chore. */
  panelsHidden: boolean;
  togglePanels: () => void;

  /** Embedded agent terminal panel. */
  terminalOpen: boolean;
  toggleTerminal: () => void;
  /** Where the panel lives. Bottom suits watching a build run; right suits
   *  holding a conversation beside the canvas, next to the properties it
   *  talks about. */
  terminalDock: "bottom" | "right";
  setTerminalDock: (d: "bottom" | "right") => void;
  /** Which surface the dock shows. The structured agent panel is the primary
   *  one; the raw pty stays available for anything it cannot do. */
  agentMode: "agent" | "terminal";
  setAgentMode: (m: "agent" | "terminal") => void;
  terminalHeight: number;
  setTerminalHeight: (h: number) => void;
  terminalWidth: number;
  setTerminalWidth: (w: number) => void;

  /** Design / Theme switcher. Theme is a visual stub until Phase 6. */
  panelTab: "design" | "theme";
  setPanelTab: (t: "design" | "theme") => void;
}

export const useUi = create<UiStore>((set) => ({
  expanded: {},
  toggleExpanded: (id) =>
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
  pagesOpen: true,
  togglePages: () => set((s) => ({ pagesOpen: !s.pagesOpen })),
  panelsHidden: false,
  togglePanels: () => set((s) => ({ panelsHidden: !s.panelsHidden })),

  terminalOpen: false,
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  terminalDock: "bottom",
  setTerminalDock: (terminalDock) => set({ terminalDock }),
  agentMode: "agent",
  setAgentMode: (agentMode) => set({ agentMode }),
  terminalHeight: 300,
  setTerminalHeight: (terminalHeight) =>
    set({ terminalHeight: Math.max(120, Math.min(760, terminalHeight)) }),
  terminalWidth: 420,
  setTerminalWidth: (terminalWidth) =>
    set({ terminalWidth: Math.max(280, Math.min(900, terminalWidth)) }),

  panelTab: "design",
  setPanelTab: (panelTab) => set({ panelTab }),
}));
