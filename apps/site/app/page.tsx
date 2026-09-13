import type { ReactElement } from "react";

import { Hero } from "@/components/hero";
import { LiveDemo } from "@/components/live-demo";
import { OpenSourceSection } from "@/components/open-source-section";
import { RailsSection } from "@/components/rails-section";
import { RouteArchitecture } from "@/components/route-architecture";
import { GridOverlay } from "@/components/ui/grid-overlay";
import { VerifiedSection } from "@/components/verified-section";
import { WhySection } from "@/components/why-section";

export default function HomePage(): ReactElement {
  return (
    <>
      {/* Unlike the previous design pass, rhythm isn't one `gap` value on this wrapper — the doc's
          own mechanism is each section carrying its own `padding-block` (see ui/section.tsx),
          so two adjacent sections' padding simply stacks. No extra spacing belongs here. */}
      <GridOverlay />
      <Hero />
      <LiveDemo />
      <WhySection />
      <RouteArchitecture />
      <VerifiedSection />
      <RailsSection />
      <OpenSourceSection />
    </>
  );
}
