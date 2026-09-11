import { describe, expect, it } from "vitest";

import { SERVICE_NAME, healthReport } from "./health.js";

describe("healthReport", () => {
  it("reports uptime in whole seconds and an ISO timestamp", () => {
    const report = healthReport(1_000, 4_999, "1.2.3");
    expect(report).toEqual({
      status: "ok",
      service: SERVICE_NAME,
      version: "1.2.3",
      uptimeSeconds: 3,
      now: "1970-01-01T00:00:04.999Z",
    });
  });

  it("clamps uptime at zero if clocks go backwards", () => {
    expect(healthReport(5_000, 1_000, "x").uptimeSeconds).toBe(0);
  });
});
