import type { ReactElement } from "react";

import { highlightCode } from "@/lib/highlight";

interface CodeBlockProps {
  code: string;
  ariaLabel?: string;
}

/**
 * A code panel using the doc's own "dark card" fill (`black`) — the doc has no code-block concept
 * at all, so this is this project's own addition, kept inside the doc's own black/white palette
 * rather than introducing a third surface color. Keywords use `brand-on-dark` (not `brand`
 * itself, which only clears 3.34:1 on black) — the doc's own "one accent, one job" rule extended
 * to syntax highlighting, since there's no other accent to spare.
 */
export function CodeBlock({ code, ariaLabel }: CodeBlockProps): ReactElement {
  const segments = highlightCode(code);

  return (
    <pre
      className="overflow-x-auto rounded bg-black p-5 font-mono text-text-3 leading-normal text-on-dark-weak"
      aria-label={ariaLabel}
    >
      <code>
        {segments.map((segment, index) =>
          segment.isKeyword ? (
            <span key={index} className="text-brand-on-dark">
              {segment.text}
            </span>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </code>
    </pre>
  );
}
