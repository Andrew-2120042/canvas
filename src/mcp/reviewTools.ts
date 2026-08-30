import { activeFile, useDoc } from "../document/store";
import { registerTool } from "./bridge";

/**
 * Comments and pages.
 *
 * Both already exist in the app; what was missing is that an agent could not
 * see either. Comments are how a person leaves work for whoever picks the file
 * up next, and an agent that cannot read them cannot act on the feedback it
 * was called in to address. Pages are the same problem one level up: an agent
 * that cannot see them silently confines everything it does to page one.
 */
export function registerReviewTools(): void {
  // --- comments ----------------------------------------------------------
  registerTool("list_comments", (args) => {
    const f = activeFile();
    const status = String(args.status ?? "open");
    const pageId = args.pageId ? String(args.pageId) : null;

    const all = f.doc.comments ?? [];
    const rows = all
      .filter((c) => (pageId ? c.pageId === pageId : true))
      .filter((c) =>
        status === "all" ? true : status === "resolved" ? c.resolved : !c.resolved)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((c) => ({
        id: c.id,
        pageId: c.pageId,
        pageName: f.doc.pages[c.pageId]?.name,
        x: Math.round(c.x),
        y: Math.round(c.y),
        body: c.body,
        resolved: c.resolved,
        createdAt: new Date(c.createdAt).toISOString(),
      }));

    return { count: rows.length, status, comments: rows };
  });

  registerTool("resolve_comment", (args) => {
    const id = String(args.id ?? "");
    const f = activeFile();
    if (!(f.doc.comments ?? []).some((c) => c.id === id)) {
      throw new Error(`no comment with id "${id}"`);
    }
    // Only ever set deliberately: resolving something the user did not ask for
    // hides feedback nobody acted on.
    const resolved = args.resolved === undefined ? true : !!args.resolved;
    useDoc.getState().updateComment(id, { resolved });
    return { id, resolved };
  });

  // --- pages -------------------------------------------------------------
  registerTool("list_pages", () => {
    const f = activeFile();
    return {
      currentPageId: f.currentPageId,
      pages: f.doc.pageOrder.map((id) => {
        const p = f.doc.pages[id];
        return {
          id,
          name: p.name,
          nodeCount: p.children.length,
          background: p.background,
          current: id === f.currentPageId,
        };
      }),
    };
  });

  registerTool("set_page", (args) => {
    const id = String(args.pageId ?? "");
    const f = activeFile();
    if (!f.doc.pages[id]) throw new Error(`no page with id "${id}"`);
    useDoc.getState().setCurrentPage(id);
    return { currentPageId: id, name: f.doc.pages[id].name };
  });

  registerTool("create_page", (args) => {
    const st = useDoc.getState();
    const id = st.addPage();
    if (args.name) st.renamePage(id, String(args.name));
    return { id, name: activeFile().doc.pages[id]?.name };
  });
}
