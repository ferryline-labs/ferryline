export const SERVICE_NAME = "ferryline-relayer";

export interface HealthReport {
  readonly status: "ok";
  readonly service: typeof SERVICE_NAME;
  readonly version: string;
  readonly uptimeSeconds: number;
  /** ISO-8601. */
  readonly now: string;
}

export function healthReport(startedAt: number, now: number, version: string): HealthReport {
  return {
    status: "ok",
    service: SERVICE_NAME,
    version,
    uptimeSeconds: Math.max(0, Math.floor((now - startedAt) / 1000)),
    now: new Date(now).toISOString(),
  };
}
