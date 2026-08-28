import { useEffect, useRef } from "react";
import { useDoc } from "../document/store";
import type { NodeId } from "../document/types";

/**
 * Renders one node as a real DOM element, with its children as real DOM
 * children — the layer tree in 1.5 is a view over exactly this structure.
 */
export function SceneNodeView({ id }: { id: NodeId }) {
  const node = useDoc((s) => s.doc.nodes[id]);
  const editing = useDoc((s) => s.editingId === id);
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

  /** Leave edit mode; the effect cleanup performs the actual write. */
  const endEditing = () => useDoc.getState().setEditing(null);

  return (
    <div
      className={`scene-node scene-node--${node.type}`}
      data-node-id={node.id}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: isText ? undefined : node.height,
        minHeight: isText ? node.height : undefined,
        background: isText ? "transparent" : node.fill,
        color: isText ? node.fill : undefined,
        fontSize: isText ? node.fontSize : undefined,
        opacity: node.opacity,
        borderRadius: node.radius || undefined,
      }}
    >
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

      {node.children.map((childId) => (
        <SceneNodeView key={childId} id={childId} />
      ))}
    </div>
  );
}
