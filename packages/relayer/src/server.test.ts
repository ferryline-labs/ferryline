import { afterEach, describe, expect, it } from "vitest";

import type { RunningServer } from "./server.js";
import { startServer } from "./server.js";

describe("relayer HTTP surface", () => {
  let running: RunningServer | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it("serves GET /healthz", async () => {
    running = await startServer({ host: "127.0.0.1", port: 0, version: "test" });
    const response = await fetch(`http://127.0.0.1:${String(running.port)}/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "ferryline-relayer",
      version: "test",
    });
  });

  it("returns 404 JSON for anything else", async () => {
    running = await startServer({ host: "127.0.0.1", port: 0, version: "test" });
    const response = await fetch(`http://127.0.0.1:${String(running.port)}/jobs`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not found" });
  });
});
