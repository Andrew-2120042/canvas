import { create } from "zustand";

interface UiStore {
  /** Node ids whose children are shown in the layer tree. */
  expanded: Record<string, boolean>;
  toggleExpanded: (id: string) => void;
  pagesOpen: boolean;
  togglePages: () => void;
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
  panelTab: "design",
  setPanelTab: (panelTab) => set({ panelTab }),
}));
