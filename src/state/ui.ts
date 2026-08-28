import { create } from "zustand";

interface UiStore {
  /** Node ids whose children are shown in the layer tree. */
  expanded: Record<string, boolean>;
  toggleExpanded: (id: string) => void;
  pagesOpen: boolean;
  togglePages: () => void;
  /** Embedded agent terminal panel. */
  terminalOpen: boolean;
  toggleTerminal: () => void;
  /** Where the panel lives. Bottom suits watching a build run; right suits
   *  holding a conversation beside the canvas, next to the properties it
   *  talks about. */
  terminalDock: "bottom" | "right";
  setTerminalDock: (d: "bottom" | "right") => void;
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
  terminalOpen: false,
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  terminalDock: "bottom",
  setTerminalDock: (terminalDock) => set({ terminalDock }),
  terminalHeight: 300,
  setTerminalHeight: (terminalHeight) =>
    set({ terminalHeight: Math.max(120, Math.min(760, terminalHeight)) }),
  terminalWidth: 420,
  setTerminalWidth: (terminalWidth) =>
    set({ terminalWidth: Math.max(280, Math.min(900, terminalWidth)) }),

  panelTab: "design",
  setPanelTab: (panelTab) => set({ panelTab }),
}));
