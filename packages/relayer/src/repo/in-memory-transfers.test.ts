import { InMemoryTransferRepository } from "./in-memory-transfers.js";
import { describeTransferRepositoryContract } from "./repo-contract.js";

describeTransferRepositoryContract(
  "InMemoryTransferRepository",
  () => new InMemoryTransferRepository(),
);
