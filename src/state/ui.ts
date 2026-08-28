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
  terminalHeight: number;
  setTerminalHeight: (h: number) => void;

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
  terminalHeight: 300,
  setTerminalHeight: (terminalHeight) =>
    set({ terminalHeight: Math.max(120, Math.min(760, terminalHeight)) }),

  panelTab: "design",
  setPanelTab: (panelTab) => set({ panelTab }),
}));
