/**
 * Reading one argument out of a tool call that is still being written.
 *
 * A model emits a tool call's arguments as a stream of JSON fragments, so for
 * the whole time it is composing a design the object is unparseable — there
 * is no closing brace, and the string being written has no closing quote.
 * `JSON.parse` cannot help, and waiting for it to become valid is precisely
 * the wait this is here to remove.
 *
 * Only one value is wanted: the markup. So this walks the fragment looking
 * for that key and decodes its value as far as it goes, which is well-defined
 * even mid-string — a JSON string is read left to right, and a truncated one
 * is simply a shorter string.
 *
 * Deliberately narrow. It is not a streaming JSON parser and does not try to
 * recover the other arguments; anything it cannot read confidently comes back
 * null, and the caller shows nothing rather than something wrong.
 */

const ESCAPES: Record<string, string> = {
  '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
};

/**
 * The value of `key`, decoded as far as the fragment goes.
 *
 * Returns null when the key has not been reached yet, so a caller can tell
 * "nothing written" from "an empty string was written".
 */
export function partialString(fragment: string, key: string): string | null {
  const needle = `"${key}"`;
  // The last occurrence, so a key mentioned inside an earlier string value
  // cannot be mistaken for the real one.
  const at = fragment.lastIndexOf(needle);
  if (at < 0) return null;

  let i = at + needle.length;
  while (i < fragment.length && /\s/.test(fragment[i])) i += 1;
  if (fragment[i] !== ":") return null;
  i += 1;
  while (i < fragment.length && /\s/.test(fragment[i])) i += 1;
  if (fragment[i] !== '"') return null;
  i += 1;

  let out = "";
  while (i < fragment.length) {
    const ch = fragment[i];
    if (ch === '"') return out; // the value finished
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }
    // An escape cut in half carries no character yet; stop before it rather
    // than emitting the backslash, which would show as a stray mark.
    const next = fragment[i + 1];
    if (next === undefined) return out;
    if (next === "u") {
      const hex = fragment.slice(i + 2, i + 6);
      if (hex.length < 4) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    const mapped = ESCAPES[next];
    if (mapped === undefined) return out;
    out += mapped;
    i += 2;
  }
  return out;
}
