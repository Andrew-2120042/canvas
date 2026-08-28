import { useDoc } from "../document/store";
import type { NodeId } from "../document/types";

/**
 * Renders one node as a real DOM element, with its children as real DOM
 * children — the layer tree in 1.5 is a view over exactly this structure.
 */
export function SceneNodeView({ id }: { id: NodeId }) {
  const node = useDoc((s) => s.doc.nodes[id]);
  if (!node || !node.visible) return null;

  return (
    <div
      className={`scene-node scene-node--${node.type}`}
      data-node-id={node.id}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        background: node.fill,
        opacity: node.opacity,
        borderRadius: node.radius || undefined,
      }}
    >
      {node.children.map((childId) => (
        <SceneNodeView key={childId} id={childId} />
      ))}
    </div>
  );
}
