/**
 * Making half-written markup renderable.
 *
 * An agent composing a write_html call emits its HTML a token at a time, so
 * for most of the call the markup is genuinely incomplete: a tag cut through
 * the middle of an attribute, a `<div>` with nothing closing it, a `<style>`
 * block that has not reached its end. Handed to the browser as it stands,
 * that does not render badly — it frequently renders as nothing at all, which
 * is the one outcome a live build must never produce. A frame that blanks
 * mid-build looks like a crash.
 *
 * So the fragment is repaired before each preview. Nothing here tries to
 * guess what the agent meant next: every rule drops or closes, and never
 * invents content. The result is always a prefix of the eventual markup, so
 * the build only ever grows.
 *
 * This is preview only. The finished call is parsed from the real markup;
 * nothing healed is ever written to the document.
 */

/** Elements that close themselves and must not be given an end tag. */
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

/**
 * Elements whose content is not markup.
 *
 * Their text is scanned for the closing tag only, because a `<` inside them
 * is data. Script is dropped outright rather than closed — a partial script
 * is not something to execute, and the canvas never runs page script anyway.
 */
const RAW_TEXT = new Set(["style", "script", "textarea", "title"]);

/** Where a trailing fragment was cut, if it was cut mid-tag. */
function lastOpenAngle(html: string): number {
  const at = html.lastIndexOf("<");
  if (at < 0) return -1;
  // A `<` with a `>` after it is a finished tag, not a truncation.
  return html.indexOf(">", at) < 0 ? at : -1;
}

export function healHtml(fragment: string): string {
  let html = fragment;

  // 1. A tag cut through the middle — `<div class="he` — is not markup yet.
  //    Dropping it is what keeps the preview a clean prefix: the same tag
  //    arrives complete a moment later.
  const cut = lastOpenAngle(html);
  if (cut >= 0) html = html.slice(0, cut);

  // 2. Walk the tags, tracking what is still open. Raw-text elements are
  //    skipped over wholesale so that markup inside a stylesheet — a `>` in
  //    a selector, say — cannot be mistaken for a tag.
  const open: string[] = [];
  const tag = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;
  let dropFrom = -1;

  while ((match = tag.exec(html)) !== null) {
    const name = match[1].toLowerCase();
    const closing = match[0][1] === "/";
    const selfClosed = /\/\s*$/.test(match[2]);

    if (closing) {
      // Close back to the matching open tag; markup that closes something
      // never opened is ignored rather than trusted.
      const at = open.lastIndexOf(name);
      if (at >= 0) open.length = at;
      continue;
    }
    if (VOID.has(name) || selfClosed) continue;

    if (RAW_TEXT.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}>`, tag.lastIndex);
      if (end < 0) {
        // Unterminated. A stylesheet still has meaning — its finished rules
        // apply, and closing it lets them — but a script has none, so it is
        // cut away along with everything after it.
        if (name === "script") {
          dropFrom = match.index;
          break;
        }
        open.push(name);
        break;
      }
      tag.lastIndex = end + name.length + 3;
      continue;
    }
    open.push(name);
  }

  if (dropFrom >= 0) html = html.slice(0, dropFrom);

  // 3. Close what is still open, innermost first.
  for (let i = open.length - 1; i >= 0; i -= 1) html += `</${open[i]}>`;

  return html;
}
