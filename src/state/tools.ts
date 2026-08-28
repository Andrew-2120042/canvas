import { create } from "zustand";

/** Toolbar order per claude.md. Pen/shader/component/token are inert stubs
 *  until their phases; they appear in the toolbar from 1.7. */
export const TOOLS = [
  "move",
  "pan",
  "frame",
  "rect",
  "pen",
  "text",
  "comment",
  "image",
  "shader",
  "component",
  "token",
] as const;

export type Tool = (typeof TOOLS)[number];

/** Tools with no behaviour behind them yet — visible but inert. */
export const STUB_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  "pen",
  "shader",
  "component",
  "token",
]);

interface ToolStore {
  tool: Tool;
  setTool: (t: Tool) => void;
}

export const useTool = create<ToolStore>((set) => ({
  tool: "move",
  setTool: (tool) => set({ tool }),
}));

/** Keyboard shortcuts. Stub tools get none — nothing to switch into. */
export const SHORTCUTS: Record<string, Tool> = {
  v: "move",
  h: "pan",
  f: "frame",
  r: "rect",
  t: "text",
  c: "comment",
};
