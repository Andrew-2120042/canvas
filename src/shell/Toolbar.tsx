import type { ReactElement } from "react";
import { STUB_TOOLS, useTool, type Tool } from "../state/tools";
import { CommentIcon } from "../canvas/CommentLayer";
import {
  ComponentIcon, MoveIcon, PanIcon, PenIcon, ShaderIcon, TokenIcon,
  ToolFrameIcon, ToolImageIcon, ToolRectIcon, ToolTextIcon,
} from "../ui/icons";

/** Toolbar order per claude.md, with the reference's group dividers. */
const ITEMS: Array<{ tool: Tool; label: string; key?: string; icon: () => ReactElement }> = [
  { tool: "move",      label: "Move",      key: "V", icon: MoveIcon },
  { tool: "pan",       label: "Pan",       key: "H", icon: PanIcon },
  { tool: "frame",     label: "Frame",     key: "F", icon: ToolFrameIcon },
  { tool: "rect",      label: "Rectangle", key: "R", icon: ToolRectIcon },
  { tool: "pen",       label: "Pen",                 icon: PenIcon },
  { tool: "text",      label: "Text",      key: "T", icon: ToolTextIcon },
  { tool: "comment",   label: "Comment",   key: "C", icon: CommentIcon },
  { tool: "image",     label: "Image",               icon: ToolImageIcon },
  { tool: "shader",    label: "Shader",              icon: ShaderIcon },
  { tool: "component", label: "Component",           icon: ComponentIcon },
  { tool: "token",     label: "Token",               icon: TokenIcon },
];

/** Dividers after Pan and after Text, matching the reference's grouping. */
const DIVIDER_AFTER = new Set<Tool>(["pan", "comment"]);

export function Toolbar() {
  const tool = useTool((s) => s.tool);
  const setTool = useTool((s) => s.setTool);

  return (
    <div className="toolbar">
      {ITEMS.map(({ tool: t, label, key, icon: Icon }) => {
        const stub = STUB_TOOLS.has(t);
        return (
          <div key={t} className="tool-slot">
            <button
              className={
                "tool-button" +
                (tool === t ? " is-active" : "") +
                (stub ? " is-stub" : "")
              }
              // Stubs are visible and clickable but inert — claude.md allows a
              // visual stub, not a functional one.
              onClick={() => { if (!stub) setTool(t); }}
              title={stub ? `${label} (not in Phase 1)` : key ? `${label}  ${key}` : label}
              tabIndex={-1}
            >
              <Icon />
            </button>
            {DIVIDER_AFTER.has(t) && <div className="tool-divider" />}
          </div>
        );
      })}
    </div>
  );
}
