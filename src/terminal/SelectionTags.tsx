import { invoke } from "@tauri-apps/api/core";
import { useActive } from "../document/store";
import { FrameIcon, ImageIcon, RectIcon, TextIcon } from "../ui/icons";
import { focusTerminal } from "./TerminalPanel";

function TypeIcon({ type }: { type: string }) {
  switch (type) {
    case "frame": return <FrameIcon />;
    case "text": return <TextIcon />;
    case "image": return <ImageIcon />;
    default: return <RectIcon />;
  }
}

/**
 * Chips for whatever is selected on the canvas, so the selection can be
 * mentioned in the conversation without hunting for an id.
 *
 * Clicking one types a reference into the shell. The terminal runs a real
 * pty, so there is no chat input to insert into — writing the token to the
 * pty is the same as the user typing it, which keeps the agent's own input
 * handling untouched.
 */
export function SelectionTags({ sessionId }: { sessionId: string }) {
  const selection = useActive((f) => f.selection);
  const nodes = useActive((f) => f.doc.nodes);

  if (selection.length === 0) return null;

  const send = async (data: string) => {
    await invoke("pty_write", { id: sessionId, data }).catch(() => {});
    // Clicking a chip moves focus to the button; hand it straight back so
    // the mention can be followed by typing.
    focusTerminal();
  };

  const insert = (id: string) => void send(`@${id} `);
  const insertAll = () =>
    void send(`${selection.map((id: string) => `@${id}`).join(" ")} `);

  return (
    <div className="selection-tags">
      <span className="selection-tags-label">Selected</span>
      {selection.slice(0, 6).map((id: string) => {
        const n = nodes[id];
        if (!n) return null;
        return (
          <button
            key={id}
            className="selection-tag"
            title={`Mention ${n.name} (${id})`}
            onClick={() => insert(id)}
          >
            <span className="selection-tag-icon"><TypeIcon type={n.type} /></span>
            <span className="selection-tag-name">{n.name}</span>
          </button>
        );
      })}
      {selection.length > 6 && (
        <span className="selection-tags-more">+{selection.length - 6}</span>
      )}
      {selection.length > 1 && (
        <button className="selection-tag is-all" onClick={() => insertAll()}>
          Mention all
        </button>
      )}
    </div>
  );
}
