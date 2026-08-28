import { useEffect, useRef } from "react";
import { useActive, useDoc } from "../document/store";
import { nodeCss, rgba } from "../document/style";
import { PathView } from "./PathView";
import type { NodeId } from "../document/types";

/**
 * Renders one node as a real DOM element, with its children as real DOM
 * children — the layer tree in 1.5 is a view over exactly this structure.
 */
export function SceneNodeView({ id }: { id: NodeId }) {
  const node = useActive((f) => f.doc.nodes[id]);
  const editing = useActive((f) => f.editingId === id) && node?.type === "text";
  const editorRef = useRef<HTMLDivElement>(null);
  /** Latest typed value, mirrored on every input. */
  const pending = useRef<string | null>(null);

  // Focus and select-all on entering edit mode, so typing replaces the
  // placeholder the way it does in every other design tool.
  //
  // The commit lives in this effect's cleanup rather than in onBlur: edit mode
  // can also end by something else clearing editingId, which removes the
  // editor from the DOM before any blur handler would run and would otherwise
  // silently discard the edit.
  useEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (el) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return () => {
      if (pending.current !== null) {
        useDoc.getState().updateNode(id, { text: pending.current });
        pending.current = null;
      }
    };
  }, [editing, id]);

  if (!node || !node.visible) return null;

  const isText = node.type === "text";
  const isImage = node.type === "image";
  const isPath = node.type === "path";

  /** Leave edit mode; the effect cleanup performs the actual write. */
  const endEditing = () => useDoc.getState().setEditing(null);

  return (
    <div
      className={`scene-node scene-node--${node.type}`}
      data-node-id={node.id}
      style={{
        ...nodeCss(node),
        left: node.x,
        top: node.y,
        width: node.width,
        height: isText ? undefined : node.height,
        minHeight: isText ? node.height : undefined,
        background: isText || isPath
          ? "transparent"
          : isImage && node.src
            ? `url(${node.src}) center/cover no-repeat`
            : rgba(node.fill, 1),
        color: isText ? node.fill : undefined,
        opacity: node.opacity,
        borderRadius: node.radius || undefined,
        overflow: node.clipContent ? "hidden" : undefined,
      }}
    >
      {node.guides?.visible && (
        <div
          className="node-guides"
          style={{
            backgroundImage:
              `linear-gradient(to right, ${rgba(node.guides.color, node.guides.opacity)} 1px, transparent 1px),` +
              `linear-gradient(to bottom, ${rgba(node.guides.color, node.guides.opacity)} 1px, transparent 1px)`,
            backgroundSize: `${node.guides.size}px ${node.guides.size}px`,
          }}
        />
      )}
      {isPath && <PathView node={node} />}

      {isText &&
        (editing ? (
          <div
            ref={editorRef}
            className="text-editor"
            contentEditable
            suppressContentEditableWarning
            onInput={(e) => { pending.current = e.currentTarget.innerText; }}
            onBlur={endEditing}
            onKeyDown={(e) => {
              e.stopPropagation(); // keep canvas shortcuts out of the editor
              if (e.key === "Escape") {
                e.preventDefault();
                endEditing();
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {node.text}
          </div>
        ) : (
          node.text
        ))}

      {node.children.map((childId: string) => (
        <SceneNodeView key={childId} id={childId} />
      ))}
    </div>
  );
}
