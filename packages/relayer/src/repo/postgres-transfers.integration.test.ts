import { afterAll, afterEach, beforeAll } from "vitest";

import { PostgresTransferRepository } from "./postgres-transfers.js";
import { describeTransferRepositoryContract } from "./repo-contract.js";
import { startTestPostgres, type TestPostgres } from "./test-postgres.js";

let db: TestPostgres;

beforeAll(async () => {
  db = await startTestPostgres();
}, 60_000);

afterEach(async () => {
  await db.truncateAll();
});

afterAll(async () => {
  await db.stop();
});

describeTransferRepositoryContract(
  "PostgresTransferRepository",
  () => new PostgresTransferRepository(db.pool),
);
