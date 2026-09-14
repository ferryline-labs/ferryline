import { afterAll, afterEach, beforeAll } from "vitest";

import { PostgresOutboundTransferRepository } from "./postgres-outbound-transfers.js";
import { describeOutboundTransferRepositoryContract } from "./repo-outbound-contract.js";
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

describeOutboundTransferRepositoryContract(
  "PostgresOutboundTransferRepository",
  () => new PostgresOutboundTransferRepository(db.pool),
);
