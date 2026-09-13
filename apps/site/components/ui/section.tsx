import type { ReactElement, ReactNode } from "react";

import { cx } from "@/lib/styles";

import { Container } from "./container";

interface SectionProps {
  id?: string;
  className?: string;
  children: ReactNode;
  /**
   * "surface" (default) is the page's own plain white ground — no background utility at all, the
   * same as every section had before this prop existed. "dark" reuses the one dark surface
   * already established elsewhere on the page (`Card`'s own `dark` tone, the footer): `bg-black`
   * with the matching on-dark text tokens, not a new color invented for this one section. Used to
   * break the otherwise-uniform white background with a real, existing token, not a one-off.
   */
  tone?: "surface" | "dark";
}

const TONE_CLASSES = {
  surface: "",
  dark: "bg-black text-white",
} as const;

/**
 * `.section-padding { padding-block: 4.25rem }` (68px), stepping to `3.125rem` (50px) at
 * `≤767px` — fixed rem, not fluid, exactly as the doc's own stylesheet has it (the doc is
 * explicit that this one, unlike the type ramp, is a breakpoint step, not a clamp()).
 */
export function Section({ id, className, children, tone = "surface" }: SectionProps): ReactElement {
  return (
    <section
      id={id}
      className={cx("py-[4.25rem] mobile-landscape:py-[3.125rem]", TONE_CLASSES[tone], className)}
    >
      <Container>{children}</Container>
    </section>
  );
}
