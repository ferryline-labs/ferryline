import type { ReactElement, ReactNode } from "react";

import { Reveal } from "./reveal";

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
}

/**
 * The doc's own section-header pattern, repeated in every section: `display:flex;
 * justify-content:space-between; gap:32px 20px`, title in `.max-6-col` (690px), a supporting
 * paragraph ~335px wide, bottom-aligned against the title. Built once, reused everywhere, per the
 * doc's own build-order note ("this repeats in *every* section — build it once").
 */
export function SectionHeader({ title, description, eyebrow }: SectionHeaderProps): ReactElement {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-8">
      <div className="max-w-6-col">
        {eyebrow ? (
          <p className="mb-2 text-title-3 font-medium uppercase text-on-surface-weak">{eyebrow}</p>
        ) : null}
        <Reveal as="h2" variant="line" className="text-title-2 font-medium text-on-surface-dark">
          {title}
        </Reveal>
      </div>
      {description ? (
        <Reveal variant="up" className="max-w-[335px] text-text-3 text-on-surface-weak">
          {description}
        </Reveal>
      ) : null}
    </div>
  );
}
