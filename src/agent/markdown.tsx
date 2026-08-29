import type { ReactNode } from "react";

/**
 * Inline markdown, rendered rather than shown raw.
 *
 * Agents write **bold** and `code` because they assume a markdown renderer.
 * Printing the source leaks asterisks and backticks into the transcript.
 * Deliberately small: bold, italic and inline code, which is what actually
 * turns up in a design conversation — not a full parser.
 */
export function inlineMarkdown(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on the markers, keeping them so each piece can be identified.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  const parts = text.split(pattern);

  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push(<strong key={i}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(<code key={i} className="md-code">{part.slice(1, -1)}</code>);
    } else if (
      part.length > 2 &&
      ((part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_")))
    ) {
      out.push(<em key={i}>{part.slice(1, -1)}</em>);
    } else {
      out.push(part);
    }
  });
  return out;
}

/** Paragraphs and simple bullets, with inline markdown inside each. */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];

  const flush = (key: string) => {
    if (para.length === 0) return;
    blocks.push(<p key={key} className="md-p">{inlineMarkdown(para.join("\n"))}</p>);
    para = [];
  };

  lines.forEach((line, i) => {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flush(`p${i}`);
      blocks.push(
        <div key={`b${i}`} className="md-bullet">
          <span className="md-bullet-dot">•</span>
          <span>{inlineMarkdown(bullet[1])}</span>
        </div>,
      );
    } else if (line.trim() === "") {
      flush(`p${i}`);
    } else {
      para.push(line);
    }
  });
  flush("last");

  return <>{blocks}</>;
}
