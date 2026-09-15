import type { ReactElement, ReactNode } from "react";

import { cx } from "./styles.js";

interface ContainerProps {
  children: ReactNode;
  className?: string;
}

/**
 * `.container { max-width: 1440px; margin-inline: auto; padding-inline: var(--margin) }` —
 * literally, the doc's own gutter is INSIDE the max-width box (unlike the previous grainient-doc
 * build, where the gutter sat on an outer wrapper and the container itself carried no padding).
 * `margin` is the doc's own clamp: 12px at 320px viewport → 20px at 1440px.
 */
export function Container({ children, className }: ContainerProps): ReactElement {
  return <div className={cx("mx-auto w-full max-w-[1440px] px-margin", className)}>{children}</div>;
}
