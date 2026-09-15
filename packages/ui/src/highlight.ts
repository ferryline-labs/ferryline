/**
 * Minimal keyword highlighting for code blocks. Deliberately not a real syntax highlighter (one
 * dependency, a grammar, a theme) for static, hand-written snippets — a plain keyword split covers
 * the one thing the design system asks for: language keywords in `accent`, everything else in the
 * surrounding ink tone.
 */

export interface CodeSegment {
  text: string;
  isKeyword: boolean;
}

const KEYWORDS = ["import", "from", "const", "await", "async", "for", "of", "new"] as const;

const KEYWORD_PATTERN = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "g");

/** Splits `code` into segments, flagging which ones are bare-word language keywords. */
export function highlightCode(code: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  let lastIndex = 0;

  for (const match of code.matchAll(KEYWORD_PATTERN)) {
    const index = match.index;
    if (index > lastIndex) {
      segments.push({ text: code.slice(lastIndex, index), isKeyword: false });
    }
    segments.push({ text: match[0], isKeyword: true });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < code.length) {
    segments.push({ text: code.slice(lastIndex), isKeyword: false });
  }

  return segments;
}
