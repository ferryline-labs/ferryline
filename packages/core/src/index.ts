export { FerrylineError } from "./errors.js";
export type { FerrylineErrorCode } from "./errors.js";

export {
  STELLAR_DECIMALS,
  SHARED_DECIMALS,
  amount,
  isZero,
  parseAmount,
  formatAmount,
  scaleDown,
  scaleUp,
  toSharedDecimals,
  fromSharedDecimals,
} from "./amount.js";
export type { Amount, ScaledDown } from "./amount.js";

export {
  KEY_BYTES,
  parseStellarAddress,
  formatStellarAddress,
  isStellarAddress,
  contractAddressToBytes32,
  bytes32ToContractAddress,
  accountAddressToBytes32,
  bytes32ToAccountAddress,
  evmAddressToBytes32,
  bytes32ToEvmAddress,
} from "./address.js";
export type { StellarAddressKind, ParsedStellarAddress } from "./address.js";

export {
  TRANSFER_ID_LENGTH,
  newTransferId,
  isTransferId,
  assertTransferId,
  transferIdTime,
} from "./transfer-id.js";
export type { TransferId } from "./transfer-id.js";

export { STELLAR } from "./rail.js";
export type {
  AssetSymbol,
  RailId,
  ChainSlug,
  ChainAddress,
  TransferRequest,
  PreflightCheckId,
  Remedy,
  PreflightCheck,
  Fee,
  Quote,
  TransferStep,
  BuiltTransfer,
  TransferStage,
  TransferFailure,
  TransferStatus,
  RailAdapter,
} from "./rail.js";

export { InMemoryTransferStore } from "./store.js";
export type { TransferRecord, TransferStore } from "./store.js";
