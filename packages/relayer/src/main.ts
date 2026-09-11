import { startServer } from "./server.js";

const port = Number.parseInt(process.env["PORT"] ?? "8080", 10);
const host = process.env["HOST"] ?? "0.0.0.0";
const version = process.env["FERRYLINE_RELAYER_VERSION"] ?? "0.0.0";

const running = await startServer({ host, port, version });
console.error(`ferryline-relayer listening on http://${host}:${String(running.port)}`);

const shutdown = (): void => {
  running.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
