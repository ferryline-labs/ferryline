import type { ReactElement, ReactNode } from "react";

import { cx } from "@/lib/styles";

import { Container } from "./container";

interface SectionProps {
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * `.section-padding { padding-block: 4.25rem }` (68px), stepping to `3.125rem` (50px) at
 * `≤767px` — fixed rem, not fluid, exactly as the doc's own stylesheet has it (the doc is
 * explicit that this one, unlike the type ramp, is a breakpoint step, not a clamp()).
 */
export function Section({ id, className, children }: SectionProps): ReactElement {
  return (
    <section
      id={id}
      className={cx("py-[4.25rem] mobile-landscape:py-[3.125rem]", className)}
    >
      <Container>{children}</Container>
    </section>
  );
}
