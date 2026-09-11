import { createServer, type Server } from "node:http";

import { healthReport } from "./health.js";

export interface RelayerServerOptions {
  readonly host: string;
  readonly port: number;
  readonly version: string;
  readonly now?: () => number;
}

export interface RunningServer {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Minimal HTTP surface: GET /healthz. The job runner, queue and RPC clients are
 * deliberately absent until their design is reviewed (see the TASK 1-3 report).
 */
export function startServer(options: RelayerServerOptions): Promise<RunningServer> {
  const now = options.now ?? Date.now;
  const startedAt = now();

  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      const body = JSON.stringify(healthReport(startedAt, now(), options.version));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
