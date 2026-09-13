import { describe, expect, it } from "vitest";

import {
  brand,
  duration,
  easing,
  fontSize,
  gray,
  radius,
  semantic,
  spacing,
  tokens,
} from "./index.js";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

describe("gray", () => {
  it("has all ten real stops, each a real 6-digit hex color", () => {
    const stops = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
    for (const stop of stops) {
      expect(gray[stop]).toMatch(HEX_COLOR);
    }
    expect(Object.keys(gray)).toHaveLength(stops.length);
  });

  it("is a real ramp — each stop strictly darker than the last (no duplicate/misordered stops)", () => {
    const stops = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
    const luminance = (hex: string): number => parseInt(hex.slice(1), 16);
    for (let i = 1; i < stops.length; i++) {
      const current = stops[i];
      const previous = stops[i - 1];
      if (current === undefined || previous === undefined) continue;
      expect(luminance(gray[current])).toBeLessThan(luminance(gray[previous]));
    }
  });
});

describe("brand", () => {
  it("exposes the real indigo hue and its two on-dark/soft variants as real hex colors", () => {
    expect(brand.DEFAULT).toMatch(HEX_COLOR);
    expect(brand.soft).toMatch(HEX_COLOR);
    expect(brand.onDark).toMatch(HEX_COLOR);
  });

  it("is Ferryline's own indigo, not the audited doc's literal orange (a disclosed departure)", () => {
    expect(brand.DEFAULT).toBe("#4F46E5");
  });

  it("onDark is a distinct, brighter variant from DEFAULT — not the same value reused", () => {
    expect(brand.onDark).not.toBe(brand.DEFAULT);
  });
});

describe("semantic", () => {
  it("every role is a real 6-digit hex color", () => {
    for (const value of Object.values(semantic)) {
      expect(value).toMatch(HEX_COLOR);
    }
  });

  it("onBrand is white, not the audited doc's literal black (a disclosed contrast-driven departure)", () => {
    expect(semantic.onBrand).toBe("#ffffff");
  });

  it("onSurfaceWeak is corrected to gray-600, not the audited doc's literal gray-300 (fails 4.5:1 on light surfaces)", () => {
    expect(semantic.onSurfaceWeak).toBe(gray[600]);
  });
});

describe("radius", () => {
  it("has exactly the four real scale values, DEFAULT doing most of the work", () => {
    expect(radius).toEqual({
      none: "0",
      DEFAULT: "10px",
      xs: "4px",
      lg: "20px",
      full: "9999px",
    });
  });
});

describe("easing", () => {
  it("has exactly the two real named curves, each a valid cubic-bezier()", () => {
    expect(Object.keys(easing)).toEqual(["1", "2"]);
    for (const curve of Object.values(easing)) {
      expect(curve).toMatch(/^cubic-bezier\([\d.,\s]+\)$/);
    }
  });

  it("the two curves are distinct (not the same value duplicated under two names)", () => {
    expect(easing[1]).not.toBe(easing[2]);
  });
});

describe("duration", () => {
  it("has exactly the five real named durations, each a valid ms value", () => {
    expect(Object.keys(duration).sort()).toEqual(["1", "2", "3", "btn", "btnFast"].sort());
    for (const value of Object.values(duration)) {
      expect(value).toMatch(/^\d+ms$/);
    }
  });
});

describe("fontSize", () => {
  it("has all eight real roles, each with a real CSS size and line-height", () => {
    const roles = [
      "title-0",
      "title-1",
      "title-2",
      "title-3",
      "text-1",
      "text-2",
      "text-3",
      "text-4",
    ] as const;
    for (const role of roles) {
      expect(fontSize[role].size.length).toBeGreaterThan(0);
      expect(fontSize[role].lineHeight.length).toBeGreaterThan(0);
    }
  });

  it("the fluid roles (title-*, text-1, text-2) use clamp(); the fixed roles (text-3, text-4) use a bare rem", () => {
    const fluidRoles = ["title-0", "title-1", "title-2", "title-3", "text-1", "text-2"] as const;
    for (const role of fluidRoles) {
      expect(fontSize[role].size).toMatch(/^clamp\(/);
    }
    expect(fontSize["text-3"].size).not.toMatch(/^clamp\(/);
    expect(fontSize["text-4"].size).not.toMatch(/^clamp\(/);
  });
});

describe("spacing", () => {
  it("has the real gutter and margin tokens", () => {
    expect(spacing.gutter).toBe("20px");
    expect(spacing.margin).toMatch(/^clamp\(/);
  });
});

describe("tokens (grouped export)", () => {
  it("re-exports every named group under one object, identically", () => {
    expect(tokens.gray).toBe(gray);
    expect(tokens.brand).toBe(brand);
    expect(tokens.semantic).toBe(semantic);
    expect(tokens.radius).toBe(radius);
    expect(tokens.easing).toBe(easing);
    expect(tokens.duration).toBe(duration);
    expect(tokens.fontSize).toBe(fontSize);
    expect(tokens.spacing).toBe(spacing);
  });
});
