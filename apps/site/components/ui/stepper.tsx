import type { ReactElement } from "react";

import { cx } from "@/lib/styles";

interface StepperProps {
  steps: readonly string[];
  activeStep: string;
}

/** A small vertical stepper — the current stage is the only one carrying brand color. */
export function Stepper({ steps, activeStep }: StepperProps): ReactElement {
  return (
    <ol className="space-y-3">
      {steps.map((step) => {
        const active = step === activeStep;
        return (
          <li key={step} className="flex items-center gap-3 text-text-3">
            <span
              aria-hidden
              className={cx(
                "h-2 w-2 shrink-0 rounded-full",
                active ? "bg-brand" : "bg-on-surface-weaker",
              )}
            />
            <span className={active ? "text-on-surface-dark" : "text-on-surface-weak"}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
