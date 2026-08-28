import { useDoc } from "../document/store";
import type { NodeId } from "../document/types";
import { useUi } from "../state/ui";
import {
  ChevronIcon, EyeIcon, FrameIcon, ImageIcon, LockIcon, RectIcon, TextIcon,
} from "../ui/icons";

function TypeIcon({ type }: { type: string }) {
  switch (type) {
    case "frame": return <FrameIcon />;
    case "text":  return <TextIcon />;
    case "image": return <ImageIcon />;
    default:      return <RectIcon />;
  }
}

/** One layer row plus its subtree. Depth drives the indent. */
export function LayerRow({ id, depth }: { id: NodeId; depth: number }) {
  const node = useDoc((s) => s.doc.nodes[id]);
  const selected = useDoc((s) => s.selection.includes(id));
  const expanded = useUi((s) => !!s.expanded[id]);
  const toggleExpanded = useUi((s) => s.toggleExpanded);

  if (!node) return null;
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className={`layer-row${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 18 }}
        onPointerDown={(e) => {
          e.stopPropagation();
          const st = useDoc.getState();
          if (e.shiftKey) st.toggleSelect(id);
          else st.select([id]);
        }}
      >
        <button
          className={`layer-chevron${hasChildren ? "" : " is-empty"}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleExpanded(id);
          }}
          tabIndex={-1}
        >
          {hasChildren && <ChevronIcon open={expanded} />}
        </button>

        <span className="layer-icon">
          <TypeIcon type={node.type} />
        </span>

        <span className="layer-name">{node.name}</span>

        {/* Hidden and locked states stay visible; the rest appear on hover. */}
        <button
          className={`layer-toggle${node.locked ? " is-on" : ""}`}
          title={node.locked ? "Unlock" : "Lock"}
          onPointerDown={(e) => {
            e.stopPropagation();
            useDoc.getState().updateNode(id, { locked: !node.locked });
          }}
          tabIndex={-1}
        >
          <LockIcon locked={node.locked} />
        </button>
        <button
          className={`layer-toggle${!node.visible ? " is-on" : ""}`}
          title={node.visible ? "Hide" : "Show"}
          onPointerDown={(e) => {
            e.stopPropagation();
            useDoc.getState().updateNode(id, { visible: !node.visible });
          }}
          tabIndex={-1}
        >
          <EyeIcon off={!node.visible} />
        </button>
      </div>

      {hasChildren &&
        expanded &&
        node.children.map((childId) => (
          <LayerRow key={childId} id={childId} depth={depth + 1} />
        ))}
    </>
  );
}
