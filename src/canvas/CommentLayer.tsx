import { useEffect, useRef, useState } from "react";
import { useActive, useDoc } from "../document/store";
import { useTool } from "../state/tools";
import { useViewport } from "../state/viewport";

/** Circle-plus glyph — the comment tool's marker in the reference. */
export function CommentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none"
         stroke="currentColor" strokeWidth="1.2">
      <circle cx="9" cy="9" r="6.2" />
      <path d="M9 6v6M6 9h6" />
    </svg>
  );
}

export interface PendingComment {
  x: number;
  y: number;
}

/**
 * Comment pins and their composer, drawn in screen space so pins stay a fixed
 * size at any zoom while staying anchored to their world position.
 */
export function CommentLayer({
  pending,
  onCancel,
}: {
  pending: PendingComment | null;
  onCancel: () => void;
}) {
  const comments = useActive((f) => f.doc.comments ?? []);
  const pageId = useActive((f) => f.currentPageId);
  const { x, y, zoom } = useViewport();
  const tool = useTool((s) => s.tool);
  const [draft, setDraft] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus explicitly rather than relying on autoFocus: the composer mounts
  // during a pointerdown, and the surrounding canvas takes focus right after.
  useEffect(() => {
    if (!pending) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [pending]);

  const onPage = comments.filter((c) => c.pageId === pageId);
  const toScreen = (wx: number, wy: number) => ({
    left: wx * zoom + x,
    top: wy * zoom + y,
  });

  const send = () => {
    const body = draft.trim();
    if (body && pending) {
      useDoc.getState().addComment(pageId, pending.x, pending.y, body);
    }
    setDraft("");
    onCancel();
  };

  return (
    <div className={`comment-layer${tool === "comment" ? " is-active" : ""}`}>
      {onPage.map((c) => (
        <div key={c.id} style={toScreen(c.x, c.y)} className="comment-anchor">
          <button
            className={`comment-pin${c.resolved ? " is-resolved" : ""}`}
            title={c.body}
            onClick={() => setOpenId(openId === c.id ? null : c.id)}
          >
            <CommentIcon />
          </button>

          {openId === c.id && (
            <div className="comment-card">
              <div className="comment-card-head">
                <button className="comment-close" onClick={() => setOpenId(null)}>×</button>
              </div>
              <div className="comment-body">{c.body}</div>
              <div className="comment-actions">
                <button
                  className="comment-btn"
                  onClick={() => useDoc.getState().updateComment(c.id, { resolved: !c.resolved })}
                >
                  {c.resolved ? "Reopen" : "Resolve"}
                </button>
                <button
                  className="comment-btn"
                  onClick={() => { useDoc.getState().removeComment(c.id); setOpenId(null); }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {pending && (
        <div style={toScreen(pending.x, pending.y)} className="comment-anchor">
          <span className="comment-dot" />
          <div className="comment-card">
            <div className="comment-card-head">
              <button className="comment-close" onClick={onCancel}>×</button>
            </div>
            <div className="comment-compose">
              <span className="comment-avatar" />
              <input
                ref={inputRef}
                className="comment-input"
                placeholder="Leave a comment"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") send();
                  if (e.key === "Escape") { setDraft(""); onCancel(); }
                }}
              />
            </div>
            <div className="comment-actions">
              <button className="comment-btn is-primary" onClick={send}>Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
