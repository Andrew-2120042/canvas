import { memo, useEffect, useMemo, useRef } from "react";
import { useActive, useDoc } from "../document/store";
import { useActivity } from "../state/activity";
import { childLayoutOf, renderStyle, rgba, type ParentLayout } from "../document/style";
import { PathView } from "./PathView";
import { imageSrc } from "./assetSrc";
import type { NodeId } from "../document/types";

/** A node whose parent does no layout places itself by x/y. */
const ABSOLUTE: ParentLayout = { mode: "absolute" };


/**
 * Renders one node as a real DOM element, with its children as real DOM
 * children — the layer tree in 1.5 is a view over exactly this structure.
 *
 * Memoised, and that matters more than it looks. Panning and zooming change
 * the viewport, which re-renders the canvas region — and without this every
 * node in the document would re-render on every wheel tick, whether or not
 * anything about it had changed. Each node already subscribes to its own slice
 * of the document, so it re-renders exactly when it is the thing that changed.
 */
function SceneNodeViewInner({
  id,
  parentLayout = ABSOLUTE,
}: {
  id: NodeId;
  /** How the parent arranges children, which decides whether this node
   *  positions itself or flows. */
  parentLayout?: ParentLayout;
}) {
  const node = useActive((f) => f.doc.nodes[id]);
  const arrivalAt = useActivity((a) => a.arrivals[id]);
  const beingBuilt = useActivity((a) => a.building && a.touched.includes(id));
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

  // Identity has to be stable, or every child's memo would miss on each render.
  const childLayout = useMemo<ParentLayout>(
    () => (node ? childLayoutOf(node) : ABSOLUTE),
    [node],
  );

  if (!node || !node.visible) return null;

  // A node the agent has just made plays a short entrance, delayed so that a
  // burst of tool calls reads as a build rather than appearing all at once.
  const delay = arrivalAt !== undefined ? Math.max(0, arrivalAt - Date.now()) : null;

  const isText = node.type === "text";
  const isPath = node.type === "path";
  const isSvg = node.type === "svg";

  /** Leave edit mode; the effect cleanup performs the actual write. */
  const endEditing = () => useDoc.getState().setEditing(null);

  return (
    <div
      className={
        `scene-node scene-node--${node.type}` +
        (delay !== null ? " is-arriving" : "") +
        (beingBuilt ? " is-building" : "")
      }
      data-node-id={node.id}
      style={{
        ...(delay !== null ? { animationDelay: `${delay}ms` } : {}),
        // One definition of how a node looks, shared with the code exporter
        // so the design and its export cannot disagree. See style.ts.
        ...renderStyle(node, parentLayout, imageSrc),
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

      {/* SVG is already vector; render the markup rather than re-modelling it. */}
      {isSvg && node.svg && (
        <div
          className="node-svg"
          dangerouslySetInnerHTML={{ __html: node.svg }}
        />
      )}

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
        <SceneNodeView key={childId} id={childId} parentLayout={childLayout} />
      ))}
    </div>
  );
}

export const SceneNodeView = memo(SceneNodeViewInner);
