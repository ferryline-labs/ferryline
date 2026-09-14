import { InMemoryOutboundTransferRepository } from "./in-memory-outbound-transfers.js";
import { describeOutboundTransferRepositoryContract } from "./repo-outbound-contract.js";

describeOutboundTransferRepositoryContract(
  "InMemoryOutboundTransferRepository",
  () => new InMemoryOutboundTransferRepository(),
);
