/* eslint-disable */
// @ts-nocheck -- generated code; it trips noImplicitOverride. One further mechanical edit: the
// `set_enforced_options` signature had two parameters named `options` (a parse error); the second is `methodOptions`.
// GENERATED FILE. Do not edit.
// Produced 2026-09-11 with stellar-cli 26.1.0 from the USDT0 OFT deployed on Stellar mainnet:
//   stellar contract bindings typescript --contract-id CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6 \
//     --rpc-url https://mainnet.sorobanrpc.com --network-passphrase "Public Global Stellar Network ; September 2015"
// Only src/index.ts of the generated package is vendored, with two mechanical edits: type-only names
// (ClientOptions, MethodOptions, Result) moved to `import type`, and the blanket re-exports of
// @stellar/stellar-sdk removed so they do not leak into @ferryline/sdk's public surface, and the
// browser `window.Buffer` shim rewritten against globalThis so the file compiles without DOM types. The human-readable interface it was
// generated from is committed at packages/core/verified/usdt0-oft.mainnet.rs. Re-generate and diff
// when LayerZero or Tether announce an OFT upgrade.
import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import { AssembledTransaction, Client as ContractClient, Spec as ContractSpec } from "@stellar/stellar-sdk/contract";
import type { ClientOptions as ContractClientOptions, MethodOptions, Result } from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";

(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;


export const networks = {
  unknown: {
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    contractId: "CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6",
  }
} as const

export type OFTFeeStorage = {tag: "DefaultFeeBps", values: void} | {tag: "FeeBps", values: readonly [u32]} | {tag: "FeeDepositAddress", values: void};

export const OFTFeeError = {
  3100: {message:"InvalidFeeBps"},
  3101: {message:"InvalidFeeDepositAddress"},
  3102: {message:"SameValue"}
}




export type OFTPausableStorage = {tag: "Paused", values: void};

export const OFTPausableError = {
  3110: {message:"Paused"},
  3111: {message:"PauseStatusUnchanged"}
}


export type Direction = {tag: "Inbound", values: void} | {tag: "Outbound", values: void};

export type Mode = {tag: "Net", values: void} | {tag: "Gross", values: void};


/**
 * Configuration for rate limiting, used as input parameter.
 */
export interface RateLimitConfig {
  limit: i128;
  mode: Mode;
  window_seconds: u64;
}

export const RateLimitError = {
  3120: {message:"ExceededRateLimit"},
  3121: {message:"InvalidAmount"},
  3122: {message:"InvalidTimestamp"},
  3123: {message:"InvalidConfig"},
  3124: {message:"SameValue"}
}


/**
 * The OFT operation type.
 */
export type OftType = {tag: "LockUnlock", values: void} | {tag: "MintBurn", values: readonly [string]};




















export const EndpointError = {
  /**
   * Library is already registered with the endpoint
   */
  1: {message:"AlreadyRegistered"},
  /**
   * Compose message already exists for this GUID and index
   */
  2: {message:"ComposeExists"},
  /**
   * Compose message not found for the given GUID and index
   */
  3: {message:"ComposeNotFound"},
  /**
   * Default receive library is not set for the source endpoint
   */
  4: {message:"DefaultReceiveLibUnavailable"},
  /**
   * Default send library is not set for the destination endpoint
   */
  5: {message:"DefaultSendLibUnavailable"},
  /**
   * Supplied native token fee is less than required
   */
  6: {message:"InsufficientNativeFee"},
  /**
   * Supplied ZRO token fee is less than required
   */
  7: {message:"InsufficientZroFee"},
  /**
   * Timeout expiry is invalid (already expired)
   */
  8: {message:"InvalidExpiry"},
  /**
   * Amount is invalid (negative)
   */
  9: {message:"InvalidAmount"},
  /**
   * Compose index exceeds maximum allowed value
   */
  10: {message:"InvalidIndex"},
  /**
   * Nonce is invalid for the requested operation
   */
  11: {message:"InvalidNonce"},
  /**
   * Payload hash is invalid (empty hash not allowed)
   */
  12: {message:"InvalidPayloadHash"},
  /**
   * Receive library is not valid for the receiver and source endpoint
   */
  13: {message:"InvalidReceiveLibrary"},
  /**
   * Operation requires a non-default (custom) library
   */
  14: {message:"OnlyNonDefaultLib"},
  /**
   * Library must support receiving messages
   */
  15: {message:"OnlyReceiveLib"},
  /**
   * Library must be registered with the endpoint
   */
  16: {message:"OnlyRegisteredLib"},
  /**
   * Library must support sending messages
   */
  17: {message:"OnlySendLib"},
  /**
   * Messaging path cannot be initialized for the given origin
   */
  18: {message:"PathNotInitializable"},
  /**
   * Message cannot be verified for the given origin
   */
  19: {message:"PathNotVerifiable"},
  /**
   * Payload hash does not match the stored hash
   */
  20: {message:"PayloadHashNotFound"},
  /**
   * New value is the same as existing value
   */
  21: {message:"SameValue"},
  /**
   * Caller is not authorized (not OApp or delegate)
   */
  22: {message:"Unauthorized"},
  /**
   * Endpoint ID is not supported by the library
   */
  23: {message:"UnsupportedEid"},
  /**
   * ZRO fee must be greater than zero when pay_in_zro is true
   */
  24: {message:"ZeroZroFee"},
  /**
   * ZRO token address is not set
   */
  25: {message:"ZroUnavailable"}
}


/**
 * Parameters for sending a cross-chain message.
 */
export interface MessagingParams {
  /**
 * Destination endpoint ID (chain identifier).
 */
dst_eid: u32;
  /**
 * The message payload to send.
 */
message: Buffer;
  /**
 * Encoded executor and DVN options.
 */
options: Buffer;
  /**
 * Whether to pay fees in ZRO token instead of native token.
 */
pay_in_zro: boolean;
  /**
 * Receiver address on the destination chain (32 bytes).
 */
receiver: Buffer;
}


/**
 * Source message information identifying where a cross-chain message came from.
 */
export interface Origin {
  /**
 * Nonce for this pathway.
 */
nonce: u64;
  /**
 * Sender address on the source chain (32 bytes).
 */
sender: Buffer;
  /**
 * Source endpoint ID (chain identifier).
 */
src_eid: u32;
}


/**
 * Fee structure for cross-chain messaging.
 */
export interface MessagingFee {
  /**
 * Fee paid in native token (XLM).
 */
native_fee: i128;
  /**
 * Fee paid in ZRO token (LayerZero token).
 */
zro_fee: i128;
}


/**
 * Receipt returned after successfully sending a cross-chain message.
 */
export interface MessagingReceipt {
  /**
 * The fees charged for sending the message.
 */
fee: MessagingFee;
  /**
 * Globally unique identifier for the message.
 */
guid: Buffer;
  /**
 * The outbound nonce for this pathway.
 */
nonce: u64;
}

/**
 * Type of message library indicating supported operations.
 */
export type MessageLibType = {tag: "Send", values: void} | {tag: "Receive", values: void} | {tag: "SendAndReceive", values: void};


/**
 * Version information for a message library.
 * 
 * Note: `minor` and `endpoint_version` use `u32` instead of `u8` because Stellar does not
 * support `u8` types in contract interface functions.
 */
export interface MessageLibVersion {
  /**
 * Endpoint version (should not exceed u8::MAX = 255).
 */
endpoint_version: u32;
  /**
 * Major version number.
 */
major: u64;
  /**
 * Minor version number (should not exceed u8::MAX = 255).
 */
minor: u32;
}


/**
 * Timeout configuration for receive library transitions.
 */
export interface Timeout {
  /**
 * Unix timestamp in seconds when the timeout expires.
 */
expiry: u64;
  /**
 * The old library address that remains valid during the grace period.
 */
lib: string;
}


/**
 * Parameters for setting message library configuration.
 */
export interface SetConfigParam {
  /**
 * XDR-encoded configuration data.
 */
config: Buffer;
  /**
 * The type of configuration (e.g., executor, ULN).
 */
config_type: u32;
  /**
 * The endpoint ID this config applies to.
 */
eid: u32;
}


/**
 * Resolved library information with default status.
 */
export interface ResolvedLibrary {
  /**
 * Whether this is the default library (true) or OApp-specific (false).
 */
is_default: boolean;
  /**
 * The resolved library address.
 */
lib: string;
}


/**
 * Outbound packet containing all information for cross-chain transmission.
 */
export interface OutboundPacket {
  /**
 * Destination endpoint ID.
 */
dst_eid: u32;
  /**
 * Globally unique identifier for this message.
 */
guid: Buffer;
  /**
 * The message payload.
 */
message: Buffer;
  /**
 * Outbound nonce for this pathway.
 */
nonce: u64;
  /**
 * Receiver address on destination chain (32 bytes).
 */
receiver: Buffer;
  /**
 * Sender address on source chain.
 */
sender: string;
  /**
 * Source endpoint ID.
 */
src_eid: u32;
}


/**
 * A fee recipient with the amount to be paid.
 */
export interface FeeRecipient {
  /**
 * Amount of fee to pay.
 */
amount: i128;
  /**
 * The address to send the fee to.
 */
to: string;
}


/**
 * Result of send operation containing fees and encoded packet.
 */
export interface FeesAndPacket {
  /**
 * The encoded packet ready for transmission.
 */
encoded_packet: Buffer;
  /**
 * List of native token fee recipients (executor, DVNs, treasury).
 */
native_fee_recipients: Array<FeeRecipient>;
  /**
 * List of ZRO token fee recipients (treasury).
 */
zro_fee_recipients: Array<FeeRecipient>;
}

export type OAppCoreStorage = {tag: "Endpoint", values: void} | {tag: "Peer", values: readonly [u32]};



export interface EnforcedOptionParam {
  eid: u32;
  msg_type: u32;
  options: Option<Buffer>;
}

export type OAppOptionsType3Storage = {tag: "EnforcedOptions", values: readonly [u32, u32]};


/**
 * Represents a fee payer address with explicit authorization state.
 * 
 * This enum forces callers of `__lz_send` to explicitly declare whether
 * `require_auth()` has already been called for the fee payer address.
 * This prevents the common mistake of forgetting to authorize the fee payer.
 * 
 * # Variants
 * - `Unverified` — Safe default. `__lz_send` will call `require_auth()` on the address.
 * Use this when the caller has **not** already authorized the fee payer.
 * - `Verified` — Caller asserts that `require_auth()` has already been called.
 * Use this to avoid a duplicate `require_auth()` node in the Soroban auth tree
 * (e.g., when the same address was already authorized as the message sender).
 */
export type FeePayer = {tag: "Unverified", values: readonly [string]} | {tag: "Verified", values: readonly [string]};

/**
 * OAppError: 2000-2099
 */
export const OAppError = {
  2000: {message:"InvalidOptions"},
  2001: {message:"NoPeer"},
  2002: {message:"OnlyPeer"},
  2003: {message:"ZroTokenUnavailable"}
}




export type OFTStorage = {tag: "DecimalsDiff", values: void} | {tag: "Token", values: void} | {tag: "MsgInspector", values: void};

/**
 * OFTError: 3000-3099
 */
export const OFTError = {
  3000: {message:"InvalidAddress"},
  3001: {message:"InvalidAmount"},
  3002: {message:"InvalidLocalDecimals"},
  3003: {message:"NotInitialized"},
  3004: {message:"Overflow"},
  3005: {message:"SlippageExceeded"}
}


/**
 * Parameters for sending OFT tokens cross-chain
 */
export interface SendParam {
  /**
 * The amount to send in local decimals
 */
amount_ld: i128;
  /**
 * Compose message to execute on the destination (Optional)
 */
compose_msg: Buffer;
  /**
 * The destination endpoint ID
 */
dst_eid: u32;
  /**
 * Additional options for the LayerZero message (Optional)
 */
extra_options: Buffer;
  /**
 * The minimum amount to receive in local decimals (slippage protection)
 */
min_amount_ld: i128;
  /**
 * OFT command for custom behavior (Optional)
 */
oft_cmd: Buffer;
  /**
 * The recipient address on the destination chain (32 bytes)
 */
to: Buffer;
}


/**
 * Transfer limits for OFT operations
 */
export interface OFTLimit {
  /**
 * The maximum amount to send in local decimals
 */
max_amount_ld: i128;
  /**
 * The minimum amount to send in local decimals
 */
min_amount_ld: i128;
}


/**
 * Receipt containing amounts sent and received in an OFT transfer
 */
export interface OFTReceipt {
  /**
 * The amount received in local decimals on the remote
 */
amount_received_ld: i128;
  /**
 * The amount sent in local decimals
 */
amount_sent_ld: i128;
}


/**
 * Details about fees charged in an OFT operation
 */
export interface OFTFeeDetail {
  /**
 * The description of the fee
 */
description: Buffer;
  /**
 * The amount of the fee in local decimals. Positive values represent fees charged,
 * while negative values represent rewards given.
 */
fee_amount_ld: i128;
}

/**
 * BufferReaderError: 1000-1009
 */
export const BufferReaderError = {
  1000: {message:"InvalidLength"},
  1001: {message:"InvalidAddressPayload"}
}

/**
 * BufferWriterError: 1010-1019
 */
export const BufferWriterError = {
  1010: {message:"InvalidAddressPayload"}
}

/**
 * TtlConfigurableError: 1020-1029
 */
export const TtlConfigurableError = {
  1020: {message:"InvalidTtlConfig"},
  1021: {message:"TtlConfigFrozen"},
  1022: {message:"TtlConfigAlreadyFrozen"}
}

/**
 * OwnableError: 1030-1039
 */
export const OwnableError = {
  1030: {message:"InvalidAuthorizer"},
  1031: {message:"InvalidPendingOwner"},
  1032: {message:"InvalidTtl"},
  1033: {message:"NoPendingTransfer"},
  1034: {message:"OwnerAlreadySet"},
  1035: {message:"OwnerNotSet"},
  1036: {message:"TransferInProgress"}
}

/**
 * BytesExtError: 1040-1049
 */
export const BytesExtError = {
  1040: {message:"LengthMismatch"}
}

/**
 * UpgradeableError: 1050-1059
 */
export const UpgradeableError = {
  1050: {message:"InvalidMigrationData"},
  1051: {message:"MigrationNotAllowed"}
}

/**
 * MultiSigError: 1060-1069
 */
export const MultiSigError = {
  1060: {message:"AlreadyInitialized"},
  1061: {message:"InvalidAuthorizer"},
  1062: {message:"InvalidSigner"},
  1063: {message:"SignatureError"},
  1064: {message:"SignerAlreadyExists"},
  1065: {message:"SignerNotFound"},
  1066: {message:"TotalSignersLessThanThreshold"},
  1067: {message:"UnsortedSigners"},
  1068: {message:"ZeroThreshold"}
}

/**
 * AuthError: 1070-1079
 */
export const AuthError = {
  1070: {message:"AuthorizerNotFound"}
}

/**
 * RbacError: 1080-1089
 */
export const RbacError = {
  1080: {message:"AdminRoleNotFound"},
  1081: {message:"IndexOutOfBounds"},
  1082: {message:"MaxRolesExceeded"},
  1083: {message:"RoleIsEmpty"},
  1084: {message:"RoleNotFound"},
  1085: {message:"RoleNotHeld"},
  1086: {message:"Unauthorized"}
}



export type MultiSigStorage = {tag: "Signers", values: void} | {tag: "Threshold", values: void};





export type OwnableStorage = {tag: "Owner", values: void} | {tag: "PendingOwner", values: void};




export type RbacStorage = {tag: "ExistingRoles", values: void} | {tag: "RoleIndexToAccount", values: readonly [string, u32]} | {tag: "RoleAccountToIndex", values: readonly [string, string]} | {tag: "RoleAccountsCount", values: readonly [string]} | {tag: "RoleAdmin", values: readonly [string]};


/**
 * TTL configuration: threshold (when to extend) and extend_to (target TTL).
 */
export interface TtlConfig {
  /**
 * Target TTL after extension (in ledgers).
 */
extend_to: u32;
  /**
 * TTL threshold that triggers extension (in ledgers).
 */
threshold: u32;
}



export type TtlConfigStorage = {tag: "Frozen", values: void} | {tag: "Instance", values: void} | {tag: "Persistent", values: void};

export type UpgradeableStorage = {tag: "Migrating", values: void};

export interface Client {
  /**
   * Construct and simulate a set_rate_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets or removes a rate limit for a specific direction and endpoint.
   * 
   * # Arguments
   * * `direction` - The direction (Inbound or Outbound)
   * * `eid` - The endpoint ID
   * * `config` - The rate limit configuration, or None to remove the rate limit
   * * `operator` - The address that must have RATE_LIMITER_MANAGER_ROLE
   */
  set_rate_limit: ({direction, eid, config, operator}: {direction: Direction, eid: u32, config: Option<RateLimitConfig>, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a rate_limit_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the rate limit configuration for a direction and endpoint.
   * Returns None if no rate limit is configured.
   */
  rate_limit_config: ({direction, eid}: {direction: Direction, eid: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<RateLimitConfig>>>

  /**
   * Construct and simulate a rate_limit_in_flight transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the current in-flight amount for a direction and endpoint.
   */
  rate_limit_in_flight: ({direction, eid}: {direction: Direction, eid: u32}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a rate_limit_capacity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the available capacity for a direction and endpoint.
   * Returns i128::MAX if no rate limit is configured.
   */
  rate_limit_capacity: ({direction, eid}: {direction: Direction, eid: u32}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_default_fee_bps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets or removes the default fee rate in basis points.
   * 
   * - `Some(n)`: sets the default fee to `n` basis points (must be >0 and <=10,000).
   * - `Some(0)`: rejected — use `None` to remove the default fee instead.
   * - `None`: removes the default fee (effective rate becomes 0).
   * * `operator` - The address that must have FEE_CONFIG_MANAGER_ROLE
   */
  set_default_fee_bps: ({default_fee_bps, operator}: {default_fee_bps: Option<u32>, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_fee_bps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets or removes the fee rate for a specific destination endpoint.
   * 
   * - `Some(0)`: explicitly sets zero fee for this destination, overriding the default fee.
   * - `None`: removes the per-destination override; falls back to the default fee.
   * 
   * # Arguments
   * * `dst_eid` - The destination endpoint ID
   * * `fee_bps` - The fee rate (0-10,000), or None to remove the fee configuration
   * * `operator` - The address that must have FEE_CONFIG_MANAGER_ROLE
   */
  set_fee_bps: ({dst_eid, fee_bps, operator}: {dst_eid: u32, fee_bps: Option<u32>, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_fee_deposit_address transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets or removes the address where collected fees will be deposited.
   * 
   * # Arguments
   * * `fee_deposit_address` - The address to deposit fees to, or None to remove the fee deposit address
   * * `operator` - The authorizer address
   */
  set_fee_deposit_address: ({fee_deposit_address, operator}: {fee_deposit_address: Option<string>, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a default_fee_bps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the default fee rate in basis points, if set.
   */
  default_fee_bps: (options?: MethodOptions) => Promise<AssembledTransaction<Option<u32>>>

  /**
   * Construct and simulate a fee_bps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the fee rate for a specific destination, if set.
   */
  fee_bps: ({dst_eid}: {dst_eid: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<u32>>>

  /**
   * Construct and simulate a effective_fee_bps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the effective fee rate for a destination (destination-specific or default).
   */
  effective_fee_bps: ({dst_eid}: {dst_eid: u32}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a has_oft_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns true if the OFT has a fee rate greater than 0 for the specified destination
   */
  has_oft_fee: ({dst_eid}: {dst_eid: u32}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a fee_deposit_address transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the fee deposit address.
   */
  fee_deposit_address: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pauses the OFT. When paused, the OFT will reject new send/receive/quote_send/quote_oft operations.
   * 
   * # Arguments
   * * `operator` - The address that must have PAUSER_ROLE
   */
  pause: ({operator}: {operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unpauses the OFT.
   * 
   * # Arguments
   * * `operator` - The address that must have UNPAUSER_ROLE
   */
  unpause: ({operator}: {operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the paused state of the OFT.
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a quote_oft transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  quote_oft: ({from, send_param}: {from: string, send_param: SendParam}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [OFTLimit, Array<OFTFeeDetail>, OFTReceipt]>>

  /**
   * Construct and simulate a token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the address of the underlying SEP-41 token managed by this OFT.
   */
  token: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a oft_version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the OFT messaging protocol version as `(major, minor)`.
   * 
   * The version is used by off-chain tooling and peer contracts to verify wire-format
   * compatibility.
   */
  oft_version: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [u64, u64]>>

  /**
   * Construct and simulate a shared_decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the **shared decimals** — the common decimal precision used in cross-chain
   * messages.
   * 
   * Token amounts are normalized to this precision before encoding into LayerZero
   * messages, ensuring consistent values regardless of each chain's native token
   * decimals. For example, a token with 18 local decimals and 6 shared decimals has a
   * conversion rate of 10^12.
   */
  shared_decimals: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a decimal_conversion_rate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the **decimal conversion rate** (`10 ^ (local_decimals - shared_decimals)`).
   * 
   * This multiplier converts between local-decimal amounts (used on-chain) and
   * shared-decimal amounts (used in cross-chain messages). Any sub-conversion-rate
   * remainder ("dust") is stripped before sending to avoid rounding discrepancies
   * across chains.
   */
  decimal_conversion_rate: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a approval_required transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Indicates whether the caller must approve a token allowance before calling [`send`](OFTCore::send).
   * 
   * - **`false`** (default) — no separate approval step is needed.
   * - **`true`** — the caller must grant a token allowance to this contract before
   * sending (e.g., via `token.approve(oft_address, amount, ...)`).
   * 
   * Wallet and frontend integrators should check this to determine whether an approval
   * transaction must precede the send.
   */
  approval_required: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a msg_inspector transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the current message inspector contract address, or `None` if unset.
   * 
   * When set, the inspector's `inspect` method is invoked during both
   * [`quote_send`](OFTCore::quote_send) and [`send`](OFTCore::send) to validate the
   * outgoing message payload and options before they reach the LayerZero endpoint.
   */
  msg_inspector: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a set_msg_inspector transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets or removes the message inspector contract.
   * 
   * The message inspector is an **optional** validation hook. When configured, every
   * outbound message (from both `send` and `quote_send`) is passed to the inspector
   * contract's `inspect(contract, message, options)` method. The inspector should
   * **panic** to reject invalid messages, acting as an on-chain policy gate.
   * 
   * Pass `None` to remove the inspector and disable outbound validation.
   * 
   * # Authorization
   * Requires the caller to be the authorizer.
   * 
   * # Arguments
   * * `inspector` - Address of the inspector contract, or `None` to remove it
   * * `operator` - The authorizer address
   */
  set_msg_inspector: ({inspector, operator}: {inspector: Option<string>, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a quote_send transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Quotes the **LayerZero messaging fee** required for a cross-chain send.
   * 
   * Builds the outgoing message and options from `send_param`, then queries the
   * LayerZero endpoint for the corresponding fee. If a message inspector is set, it
   * will also validate the message at this stage.
   * 
   * # Arguments
   * * `from` - The address that would initiate the transfer
   * * `send_param` - The proposed transfer parameters
   * * `pay_in_zro` - `true` to pay the messaging fee in the ZRO token; `false` to pay
   * in the chain's native token
   * 
   * # Returns
   * A [`MessagingFee`](endpoint_v2::MessagingFee) containing the `native_fee` and
   * `zro_fee` required by the endpoint. Pass this value (or a superset) to
   * [`send`](OFTCore::send).
   */
  quote_send: ({from, send_param, pay_in_zro}: {from: string, send_param: SendParam, pay_in_zro: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<MessagingFee>>

  /**
   * Construct and simulate a send transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Executes a cross-chain token transfer via the LayerZero endpoint.
   * 
   * Builds the OFT message and options, then sends the message through the LayerZero endpoint.
   * 
   * # Arguments
   * * `from` - The token sender (must authorize the call)
   * * `send_param` - Transfer parameters including destination chain (`dst_eid`),
   * recipient (`to`), amount, slippage floor (`min_amount_ld`), extra options, and
   * an optional compose message
   * * `fee` - The messaging fee to pay (obtain from [`quote_send`](OFTCore::quote_send))
   * * `refund_address` - Address to receive any excess fee refund
   * 
   * # Returns
   * * [`MessagingReceipt`](endpoint_v2::MessagingReceipt) — the LayerZero message GUID,
   * nonce, and fee actually consumed
   * * [`OFTReceipt`](crate::types::OFTReceipt) — `amount_sent_ld` (debited) and
   * `amount_received_ld` (credited on destination after dust removal / fees)
   */
  send: ({from, send_param, fee, refund_address}: {from: string, send_param: SendParam, fee: MessagingFee, refund_address: string}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [MessagingReceipt, OFTReceipt]>>

  /**
   * Construct and simulate a oft_type transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the OFT type with its target address and configuration.
   */
  oft_type: (options?: MethodOptions) => Promise<AssembledTransaction<OftType>>

  /**
   * Construct and simulate a oapp_version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Retrieves the OApp version information.
   * 
   * # Returns
   * A tuple containing:
   * - `sender_version`: The version of the OAppSender
   * - `receiver_version`: The version of the OAppReceiver
   */
  oapp_version: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [u64, u64]>>

  /**
   * Construct and simulate a endpoint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Retrieves the LayerZero endpoint address associated with the OApp.
   * 
   * # Returns
   * The LayerZero endpoint address
   */
  endpoint: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a peer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Retrieves the peer (OApp) associated with a corresponding endpoint.
   * 
   * # Arguments
   * * `eid` - The endpoint ID
   * 
   * # Returns
   * The peer address (OApp instance) associated with the corresponding endpoint
   */
  peer: ({eid}: {eid: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a set_peer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets or removes the peer address (OApp instance) for a corresponding endpoint.
   * 
   * # Arguments
   * * `eid` - The endpoint ID
   * * `peer` - The address of the peer to be associated with the corresponding endpoint, or None to remove the peer
   * * `operator` - The authorizer address
   */
  set_peer: ({eid, peer, operator}: {eid: u32, peer: Option<Buffer>, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_delegate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets the delegate address for the OApp Core.
   * 
   * # Arguments
   * * `delegate` - The address of the delegate to be set, or None to remove the delegate
   * * `operator` - The authorizer address
   */
  set_delegate: ({delegate, operator}: {delegate: Option<string>, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a grant_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Grants a role to an account. Caller must be owner or have the role's admin role.
   * 
   * # Arguments
   * * `account` - The account to grant the role to.
   * * `role` - The role to grant.
   * * `caller` - The account that is granting the role. Must be owner or have the role's admin role.
   */
  grant_role: ({account, role, caller}: {account: string, role: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a revoke_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Revokes a role from an account. Caller must be owner or have the role's admin role.
   * 
   * # Arguments
   * * `account` - The account to revoke the role from.
   * * `role` - The role to revoke.
   * * `caller` - The account that is revoking the role. Must be owner or have the role's admin role.
   */
  revoke_role: ({account, role, caller}: {account: string, role: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a renounce_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Allows an account to renounce a role assigned to itself.
   * Users can only renounce roles for their own account.
   * 
   * # Arguments
   * * `role` - The role to renounce.
   * * `caller` - The account that is renouncing the role. Must be the account itself.
   */
  renounce_role: ({role, caller}: {role: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_role_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets `admin_role` as the admin role of `role`. Caller must be the authorizer.
   * 
   * # Arguments
   * * `role` - The role to set the admin for.
   * * `admin_role` - The admin role to set for the role.
   * 
   * # Notes
   * 
   * The admin role can be any `Symbol`, including one with no members. If the admin
   * role has no members, only the authorizer can grant/revoke the role.
   */
  set_role_admin: ({role, admin_role}: {role: string, admin_role: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a remove_role_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Removes the admin role for a specified role. Caller must be the authorizer.
   * 
   * # Arguments
   * * `role` - The role to remove the admin for.
   * 
   * # Errors
   * * `RbacError::AdminRoleNotFound` - If no admin role is set for the role.
   */
  remove_role_admin: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a has_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns `Some(index)` if the account has the specified role, where `index`
   * is the index of the account in the role. Returns `None` if not.
   * 
   * # Arguments
   * * `account` - The account to check the role for.
   * * `role` - The role to check the account for.
   */
  has_role: ({account, role}: {account: string, role: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<u32>>>

  /**
   * Construct and simulate a get_role_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the admin role for a specific role, or None if not set.
   * 
   * # Arguments
   * * `role` - The role to get the admin for.
   */
  get_role_admin: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a get_role_member_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the number of accounts that have the specified role.
   * 
   * # Arguments
   * * `role` - The role to get the member count for.
   */
  get_role_member_count: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_role_member transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the account at the specified index for a given role.
   * 
   * # Arguments
   * * `role` - The role to get the member for.
   * * `index` - The index of the member to get.
   * 
   * # Errors
   * * `RbacError::IndexOutOfBounds` if the index is out of bounds.
   */
  get_role_member: ({role, index}: {role: string, index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_existing_roles transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns all roles that currently have at least one member.
   * Defaults to empty vector if no roles exist.
   * 
   * # Notes
   * 
   * This function returns all roles that currently have at least one member.
   * The maximum number of roles is limited by [`MAX_ROLES`].
   */
  get_existing_roles: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a allow_initialize_path transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Checks if a messaging path can be initialized for the given origin.
   * 
   * # Arguments
   * * `origin` - The origin of the message
   * 
   * # Returns
   * True if the path can be initialized, false otherwise
   */
  allow_initialize_path: ({origin}: {origin: Origin}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a next_nonce transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Retrieves the next nonce for a given source endpoint and sender address.
   * 
   * The path nonce starts from 1. If 0 is returned it means that there is NO nonce ordered enforcement.
   * This is required by the off-chain executor to determine if the OApp expects message execution to be ordered.
   * This is also enforced by the OApp.
   * By default this is NOT enabled, i.e. next_nonce is hardcoded to return 0.
   * 
   * # Arguments
   * * `src_eid` - The source endpoint ID
   * * `sender` - The sender OApp address
   * 
   * # Returns
   * The next nonce
   */
  next_nonce: ({src_eid, sender}: {src_eid: u32, sender: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a lz_receive transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Entry point for receiving messages or packets from the LayerZero endpoint.
   * 
   * The default implementation calls `clear_payload_and_transfer` to validate the message
   * and clear it from the endpoint, then delegates to `__lz_receive` for application logic.
   * 
   * # Arguments
   * * `executor` - The address of the executor for the received message
   * * `origin` - The origin information containing the source endpoint and sender address:
   * - `src_eid`: The source endpoint ID
   * - `sender`: The sender address on the source chain
   * - `nonce`: The nonce of the message
   * * `guid` - The unique identifier for the received LayerZero message
   * * `message` - The payload of the received message
   * * `extra_data` - Additional arbitrary data provided by the corresponding executor
   * * `value` - The native token value sent with the message
   */
  lz_receive: ({executor, origin, guid, message, extra_data, value}: {executor: string, origin: Origin, guid: Buffer, message: Buffer, extra_data: Buffer, value: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_compose_msg_sender transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Indicates whether an address is an approved composeMsg sender to the Endpoint.
   * 
   * Applications can optionally choose to implement separate composeMsg senders that are NOT the bridging layer.
   * The default sender IS the OAppReceiver implementer.
   * 
   * # Arguments
   * * `origin` - The origin information containing the source endpoint and sender address
   * * `message` - The lzReceive payload
   * * `sender` - The sender address to check
   * 
   * # Returns
   * True if the sender is a valid composeMsg sender, false otherwise
   */
  is_compose_msg_sender: ({origin, message, sender}: {origin: Origin, message: Buffer, sender: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a enforced_options transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Retrieves the enforced options for a given endpoint and message type.
   * 
   * # Arguments
   * * `eid` - The endpoint ID
   * * `msg_type` - The OApp message type
   * 
   * # Returns
   * The enforced options for the given endpoint and message type
   */
  enforced_options: ({eid, msg_type}: {eid: u32, msg_type: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a set_enforced_options transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets or removes the enforced options for specific endpoint and message type combinations.
   * 
   * Only the `authorizer` of the OApp can call this function.
   * Provides a way for the OApp to enforce things like paying for PreCrime, AND/OR minimum dst lzReceive gas amounts etc.
   * These enforced options can vary as the potential options/execution on the remote may differ as per the msg_type.
   * e.g. Amount of lzReceive() gas necessary to deliver a lzCompose() message adds overhead you don't want to pay
   * if you are only making a standard LayerZero message ie. lzReceive() WITHOUT sendCompose().
   * 
   * # Arguments
   * * `options` - A vector of EnforcedOptionParam structures specifying enforced options
   * * `operator` - The authorizer address
   */
  set_enforced_options: ({options, operator}: {options: Array<EnforcedOptionParam>, operator: string}, methodOptions?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a combine_options transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Combines options for a given endpoint and message type.
   * 
   * If there is an enforced lzReceive option:
   * - {gas_limit: 200k, value: 1 XLM} AND a caller supplies a lzReceive option: {gas_limit: 100k, value: 0.5 XLM}
   * - The resulting options will be {gas_limit: 300k, value: 1.5 XLM} when the message is executed on the remote lz_receive() function.
   * The presence of duplicated options is handled off-chain in the verifier/executor.
   * 
   * # Arguments
   * * `eid` - The endpoint ID
   * * `msg_type` - The OApp message type
   * * `extra_options` - Additional options passed by the caller
   * 
   * # Returns
   * The combination of caller specified options AND enforced options
   */
  combine_options: ({eid, msg_type, extra_options}: {eid: u32, msg_type: u32, extra_options: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Upgrades the contract to new WASM bytecode.
   */
  upgrade: ({new_wasm_hash, operator}: {new_wasm_hash: Buffer, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a migrate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Runs migration logic after an upgrade.
   */
  migrate: ({migration_data, operator}: {migration_data: Buffer, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a authorizer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  authorizer: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the current owner address, or None if no owner is set.
   */
  owner: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a pending_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the pending owner address for 2-step transfer, or None if no transfer is pending.
   */
  pending_owner: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a transfer_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfers ownership immediately to a new address.
   * 
   * Use with caution - if you transfer to a wrong address, ownership is lost forever.
   * Consider using `begin_ownership_transfer` instead.
   * 
   * # Panics
   * - `OwnerNotSet` if no owner is currently set
   * - `TransferInProgress` if a 2-step transfer is in progress
   */
  transfer_ownership: ({new_owner}: {new_owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a begin_ownership_transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Begins an ownership transfer to a new address.
   * 
   * The new owner must call `accept_ownership()` within `ttl` ledgers
   * to complete the transfer. The pending transfer will automatically expire after.
   * 
   * # Arguments
   * - `new_owner` - The proposed new owner
   * - `ttl` - Number of ledgers the new owner has to accept.
   * Use `0` to cancel a pending transfer (new_owner must match pending).
   * 
   * # Panics
   * - `OwnerNotSet` if no owner is currently set
   * - `NoPendingTransfer` when cancelling and no pending transfer exists
   * - `InvalidTtl` if ttl exceeds max TTL
   * - `InvalidPendingOwner` when cancelling with wrong new_owner address
   */
  begin_ownership_transfer: ({new_owner, ttl}: {new_owner: string, ttl: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a accept_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accepts a pending 2-step ownership transfer.
   * 
   * Must be called by the pending owner before the TTL expires.
   * 
   * # Panics
   * - `NoPendingTransfer` if there is no pending transfer (or it expired)
   */
  accept_ownership: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a renounce_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permanently renounces ownership.
   * 
   * # Panics
   * - `OwnerNotSet` if no owner is currently set
   * - `TransferInProgress` if a 2-step transfer is in progress (cancel it first)
   */
  renounce_ownership: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a extend_instance_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extends the instance TTL.
   * 
   * # Arguments
   * 
   * * `threshold` - The threshold to extend the TTL (if current TTL is below this, extend).
   * * `extend_to` - The TTL to extend to.
   */
  extend_instance_ttl: ({threshold, extend_to}: {threshold: u32, extend_to: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_ttl_configs transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets TTL configs for instance and persistent storage.
   * 
   * - `None` values remove the corresponding config (disables auto-extension for that type)
   * - Validates that `threshold <= extend_to <= MAX_TTL`
   * 
   * # Arguments
   * - `instance` - TTL config for instance storage
   * - `persistent` - TTL config for persistent storage
   * 
   * # Panics
   * - `TtlConfigFrozen` if configs are frozen
   * - `InvalidTtlConfig` if validation fails
   */
  set_ttl_configs: ({instance, persistent}: {instance: Option<TtlConfig>, persistent: Option<TtlConfig>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a ttl_configs transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the current TTL configs as (instance_config, persistent_config).
   */
  ttl_configs: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [Option<TtlConfig>, Option<TtlConfig>]>>

  /**
   * Construct and simulate a freeze_ttl_configs transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permanently freezes TTL configs, preventing any future modifications.
   * 
   * This is irreversible and provides immutability guarantees to users.
   * Emits `TtlConfigsFrozen` event.
   * 
   * # Panics
   * - `TtlConfigAlreadyFrozen` if already frozen
   */
  freeze_ttl_configs: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_ttl_configs_frozen transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns whether TTL configs are frozen.
   */
  is_ttl_configs_frozen: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {token, shared_decimals, oft_type, endpoint, delegate}: {token: string, shared_decimals: u32, oft_type: OftType, endpoint: string, delegate: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({token, shared_decimals, oft_type, endpoint, delegate}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAADU9GVEZlZVN0b3JhZ2UAAAAAAAADAAAAAAAAAAAAAAANRGVmYXVsdEZlZUJwcwAAAAAAAAEAAAAAAAAABkZlZUJwcwAAAAAAAQAAAAQAAAAAAAAAAAAAABFGZWVEZXBvc2l0QWRkcmVzcwAAAA==",
        "AAAABAAAAAAAAAAAAAAAC09GVEZlZUVycm9yAAAAAAMAAAAAAAAADUludmFsaWRGZWVCcHMAAAAAAAwcAAAAAAAAABhJbnZhbGlkRmVlRGVwb3NpdEFkZHJlc3MAAAwdAAAAAAAAAAlTYW1lVmFsdWUAAAAAAAwe",
        "AAAABQAAAAAAAAAAAAAAEERlZmF1bHRGZWVCcHNTZXQAAAABAAAAE2RlZmF1bHRfZmVlX2Jwc19zZXQAAAAAAQAAAEtUaGUgZGVmYXVsdCBmZWUgcmF0ZSBpbiBiYXNpcyBwb2ludHMsIG9yIE5vbmUgaWYgdGhlIGRlZmF1bHQgZmVlIGlzIHJlbW92ZWQAAAAAB2ZlZV9icHMAAAAD6AAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAACUZlZUJwc1NldAAAAAAAAAEAAAALZmVlX2Jwc19zZXQAAAAAAgAAAAAAAAAHZHN0X2VpZAAAAAAEAAAAAAAAADtUaGUgZmVlIHJhdGUgaW4gYmFzaXMgcG9pbnRzLCBvciBOb25lIGlmIHRoZSBmZWUgaXMgcmVtb3ZlZAAAAAAHZmVlX2JwcwAAAAPoAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAFEZlZURlcG9zaXRBZGRyZXNzU2V0AAAAAQAAABdmZWVfZGVwb3NpdF9hZGRyZXNzX3NldAAAAAABAAAASVRoZSBhZGRyZXNzIHRvIGRlcG9zaXQgZmVlcyB0bywgb3IgTm9uZSB0byByZW1vdmUgdGhlIGZlZSBkZXBvc2l0IGFkZHJlc3MAAAAAAAATZmVlX2RlcG9zaXRfYWRkcmVzcwAAAAPoAAAAEwAAAAAAAAAC",
        "AAAAAgAAAAAAAAAAAAAAEk9GVFBhdXNhYmxlU3RvcmFnZQAAAAAAAQAAAAAAAAAAAAAABlBhdXNlZAAA",
        "AAAABAAAAAAAAAAAAAAAEE9GVFBhdXNhYmxlRXJyb3IAAAACAAAAAAAAAAZQYXVzZWQAAAAADCYAAAAAAAAAFFBhdXNlU3RhdHVzVW5jaGFuZ2VkAAAMJw==",
        "AAAABQAAAAAAAAAAAAAACVBhdXNlZFNldAAAAAAAAAEAAAAKcGF1c2VkX3NldAAAAAAAAQAAAAAAAAAGcGF1c2VkAAAAAAABAAAAAAAAAAI=",
        "AAAAAgAAAAAAAAAAAAAACURpcmVjdGlvbgAAAAAAAAIAAAAAAAAAAAAAAAdJbmJvdW5kAAAAAAAAAAAAAAAACE91dGJvdW5k",
        "AAAAAgAAAAAAAAAAAAAABE1vZGUAAAACAAAAAAAAADNOZXQgcmF0ZSBsaW1pdDogcmVsZWFzZXMgZGVjcmVtZW50IGluLWZsaWdodCBhbW91bnQAAAAAA05ldAAAAAAAAAAAOUdyb3NzIHJhdGUgbGltaXQ6IHJlbGVhc2VzIGRvIG5vdCBhZmZlY3QgaW4tZmxpZ2h0IGFtb3VudAAAAAAAAAVHcm9zcwAAAA==",
        "AAAAAQAAADlDb25maWd1cmF0aW9uIGZvciByYXRlIGxpbWl0aW5nLCB1c2VkIGFzIGlucHV0IHBhcmFtZXRlci4AAAAAAAAAAAAAD1JhdGVMaW1pdENvbmZpZwAAAAADAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAAAAAAABG1vZGUAAAfQAAAABE1vZGUAAAAAAAAADndpbmRvd19zZWNvbmRzAAAAAAAG",
        "AAAABAAAAAAAAAAAAAAADlJhdGVMaW1pdEVycm9yAAAAAAAFAAAAAAAAABFFeGNlZWRlZFJhdGVMaW1pdAAAAAAADDAAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAwxAAAAAAAAABBJbnZhbGlkVGltZXN0YW1wAAAMMgAAAAAAAAANSW52YWxpZENvbmZpZwAAAAAADDMAAAAAAAAACVNhbWVWYWx1ZQAAAAAADDQ=",
        "AAAABQAAAAAAAAAAAAAADFJhdGVMaW1pdFNldAAAAAEAAAAOcmF0ZV9saW1pdF9zZXQAAAAAAAMAAAAAAAAACWRpcmVjdGlvbgAAAAAAB9AAAAAJRGlyZWN0aW9uAAAAAAAAAAAAAAAAAAADZWlkAAAAAAQAAAAAAAAAQlRoZSByYXRlIGxpbWl0IGNvbmZpZ3VyYXRpb24sIG9yIE5vbmUgaWYgdGhlIHJhdGUgbGltaXQgaXMgcmVtb3ZlZAAAAAAABmNvbmZpZwAAAAAD6AAAB9AAAAAPUmF0ZUxpbWl0Q29uZmlnAAAAAAAAAAAC",
        "AAAAAgAAABdUaGUgT0ZUIG9wZXJhdGlvbiB0eXBlLgAAAAAAAAAAB09mdFR5cGUAAAAAAgAAAAAAAAAnTG9jayB0b2tlbnMgb24gc2VuZCwgdW5sb2NrIG9uIHJlY2VpdmUuAAAAAApMb2NrVW5sb2NrAAAAAAABAAAAZUJ1cm4gdG9rZW5zIG9uIHNlbmQsIG1pbnQgb24gcmVjZWl2ZS4KVGhlIGFkZHJlc3MgaXMgdGhlIE1pbnRhYmxlIGNvbnRyYWN0IHVzZWQgZm9yIG1pbnRpbmcgb24gY3JlZGl0AAAAAAAACE1pbnRCdXJuAAAAAQAAABM=",
        "AAAAAAAAAS5TZXRzIG9yIHJlbW92ZXMgYSByYXRlIGxpbWl0IGZvciBhIHNwZWNpZmljIGRpcmVjdGlvbiBhbmQgZW5kcG9pbnQuCgojIEFyZ3VtZW50cwoqIGBkaXJlY3Rpb25gIC0gVGhlIGRpcmVjdGlvbiAoSW5ib3VuZCBvciBPdXRib3VuZCkKKiBgZWlkYCAtIFRoZSBlbmRwb2ludCBJRAoqIGBjb25maWdgIC0gVGhlIHJhdGUgbGltaXQgY29uZmlndXJhdGlvbiwgb3IgTm9uZSB0byByZW1vdmUgdGhlIHJhdGUgbGltaXQKKiBgb3BlcmF0b3JgIC0gVGhlIGFkZHJlc3MgdGhhdCBtdXN0IGhhdmUgUkFURV9MSU1JVEVSX01BTkFHRVJfUk9MRQAAAAAADnNldF9yYXRlX2xpbWl0AAAAAAAEAAAAAAAAAAlkaXJlY3Rpb24AAAAAAAfQAAAACURpcmVjdGlvbgAAAAAAAAAAAAADZWlkAAAAAAQAAAAAAAAABmNvbmZpZwAAAAAD6AAAB9AAAAAPUmF0ZUxpbWl0Q29uZmlnAAAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAA==",
        "AAAAAAAAAG9SZXR1cm5zIHRoZSByYXRlIGxpbWl0IGNvbmZpZ3VyYXRpb24gZm9yIGEgZGlyZWN0aW9uIGFuZCBlbmRwb2ludC4KUmV0dXJucyBOb25lIGlmIG5vIHJhdGUgbGltaXQgaXMgY29uZmlndXJlZC4AAAAAEXJhdGVfbGltaXRfY29uZmlnAAAAAAAAAgAAAAAAAAAJZGlyZWN0aW9uAAAAAAAH0AAAAAlEaXJlY3Rpb24AAAAAAAAAAAAAA2VpZAAAAAAEAAAAAQAAA+gAAAfQAAAAD1JhdGVMaW1pdENvbmZpZwA=",
        "AAAAAAAAAEJSZXR1cm5zIHRoZSBjdXJyZW50IGluLWZsaWdodCBhbW91bnQgZm9yIGEgZGlyZWN0aW9uIGFuZCBlbmRwb2ludC4AAAAAABRyYXRlX2xpbWl0X2luX2ZsaWdodAAAAAIAAAAAAAAACWRpcmVjdGlvbgAAAAAAB9AAAAAJRGlyZWN0aW9uAAAAAAAAAAAAAANlaWQAAAAABAAAAAEAAAAL",
        "AAAAAAAAAG5SZXR1cm5zIHRoZSBhdmFpbGFibGUgY2FwYWNpdHkgZm9yIGEgZGlyZWN0aW9uIGFuZCBlbmRwb2ludC4KUmV0dXJucyBpMTI4OjpNQVggaWYgbm8gcmF0ZSBsaW1pdCBpcyBjb25maWd1cmVkLgAAAAAAE3JhdGVfbGltaXRfY2FwYWNpdHkAAAAAAgAAAAAAAAAJZGlyZWN0aW9uAAAAAAAH0AAAAAlEaXJlY3Rpb24AAAAAAAAAAAAAA2VpZAAAAAAEAAAAAQAAAAs=",
        "AAAAAAAAAU9TZXRzIG9yIHJlbW92ZXMgdGhlIGRlZmF1bHQgZmVlIHJhdGUgaW4gYmFzaXMgcG9pbnRzLgoKLSBgU29tZShuKWA6IHNldHMgdGhlIGRlZmF1bHQgZmVlIHRvIGBuYCBiYXNpcyBwb2ludHMgKG11c3QgYmUgPjAgYW5kIDw9MTAsMDAwKS4KLSBgU29tZSgwKWA6IHJlamVjdGVkIOKAlCB1c2UgYE5vbmVgIHRvIHJlbW92ZSB0aGUgZGVmYXVsdCBmZWUgaW5zdGVhZC4KLSBgTm9uZWA6IHJlbW92ZXMgdGhlIGRlZmF1bHQgZmVlIChlZmZlY3RpdmUgcmF0ZSBiZWNvbWVzIDApLgoqIGBvcGVyYXRvcmAgLSBUaGUgYWRkcmVzcyB0aGF0IG11c3QgaGF2ZSBGRUVfQ09ORklHX01BTkFHRVJfUk9MRQAAAAATc2V0X2RlZmF1bHRfZmVlX2JwcwAAAAACAAAAAAAAAA9kZWZhdWx0X2ZlZV9icHMAAAAD6AAAAAQAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAAbFTZXRzIG9yIHJlbW92ZXMgdGhlIGZlZSByYXRlIGZvciBhIHNwZWNpZmljIGRlc3RpbmF0aW9uIGVuZHBvaW50LgoKLSBgU29tZSgwKWA6IGV4cGxpY2l0bHkgc2V0cyB6ZXJvIGZlZSBmb3IgdGhpcyBkZXN0aW5hdGlvbiwgb3ZlcnJpZGluZyB0aGUgZGVmYXVsdCBmZWUuCi0gYE5vbmVgOiByZW1vdmVzIHRoZSBwZXItZGVzdGluYXRpb24gb3ZlcnJpZGU7IGZhbGxzIGJhY2sgdG8gdGhlIGRlZmF1bHQgZmVlLgoKIyBBcmd1bWVudHMKKiBgZHN0X2VpZGAgLSBUaGUgZGVzdGluYXRpb24gZW5kcG9pbnQgSUQKKiBgZmVlX2Jwc2AgLSBUaGUgZmVlIHJhdGUgKDAtMTAsMDAwKSwgb3IgTm9uZSB0byByZW1vdmUgdGhlIGZlZSBjb25maWd1cmF0aW9uCiogYG9wZXJhdG9yYCAtIFRoZSBhZGRyZXNzIHRoYXQgbXVzdCBoYXZlIEZFRV9DT05GSUdfTUFOQUdFUl9ST0xFAAAAAAAAC3NldF9mZWVfYnBzAAAAAAMAAAAAAAAAB2RzdF9laWQAAAAABAAAAAAAAAAHZmVlX2JwcwAAAAPoAAAABAAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAA==",
        "AAAAAAAAANpTZXRzIG9yIHJlbW92ZXMgdGhlIGFkZHJlc3Mgd2hlcmUgY29sbGVjdGVkIGZlZXMgd2lsbCBiZSBkZXBvc2l0ZWQuCgojIEFyZ3VtZW50cwoqIGBmZWVfZGVwb3NpdF9hZGRyZXNzYCAtIFRoZSBhZGRyZXNzIHRvIGRlcG9zaXQgZmVlcyB0bywgb3IgTm9uZSB0byByZW1vdmUgdGhlIGZlZSBkZXBvc2l0IGFkZHJlc3MKKiBgb3BlcmF0b3JgIC0gVGhlIGF1dGhvcml6ZXIgYWRkcmVzcwAAAAAAF3NldF9mZWVfZGVwb3NpdF9hZGRyZXNzAAAAAAIAAAAAAAAAE2ZlZV9kZXBvc2l0X2FkZHJlc3MAAAAD6AAAABMAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAADVSZXR1cm5zIHRoZSBkZWZhdWx0IGZlZSByYXRlIGluIGJhc2lzIHBvaW50cywgaWYgc2V0LgAAAAAAAA9kZWZhdWx0X2ZlZV9icHMAAAAAAAAAAAEAAAPoAAAABA==",
        "AAAAAAAAADhSZXR1cm5zIHRoZSBmZWUgcmF0ZSBmb3IgYSBzcGVjaWZpYyBkZXN0aW5hdGlvbiwgaWYgc2V0LgAAAAdmZWVfYnBzAAAAAAEAAAAAAAAAB2RzdF9laWQAAAAABAAAAAEAAAPoAAAABA==",
        "AAAAAAAAAFNSZXR1cm5zIHRoZSBlZmZlY3RpdmUgZmVlIHJhdGUgZm9yIGEgZGVzdGluYXRpb24gKGRlc3RpbmF0aW9uLXNwZWNpZmljIG9yIGRlZmF1bHQpLgAAAAARZWZmZWN0aXZlX2ZlZV9icHMAAAAAAAABAAAAAAAAAAdkc3RfZWlkAAAAAAQAAAABAAAABA==",
        "AAAAAAAAAFNSZXR1cm5zIHRydWUgaWYgdGhlIE9GVCBoYXMgYSBmZWUgcmF0ZSBncmVhdGVyIHRoYW4gMCBmb3IgdGhlIHNwZWNpZmllZCBkZXN0aW5hdGlvbgAAAAALaGFzX29mdF9mZWUAAAAAAQAAAAAAAAAHZHN0X2VpZAAAAAAEAAAAAQAAAAE=",
        "AAAAAAAAACBSZXR1cm5zIHRoZSBmZWUgZGVwb3NpdCBhZGRyZXNzLgAAABNmZWVfZGVwb3NpdF9hZGRyZXNzAAAAAAAAAAABAAAD6AAAABM=",
        "AAAAAAAAAKVQYXVzZXMgdGhlIE9GVC4gV2hlbiBwYXVzZWQsIHRoZSBPRlQgd2lsbCByZWplY3QgbmV3IHNlbmQvcmVjZWl2ZS9xdW90ZV9zZW5kL3F1b3RlX29mdCBvcGVyYXRpb25zLgoKIyBBcmd1bWVudHMKKiBgb3BlcmF0b3JgIC0gVGhlIGFkZHJlc3MgdGhhdCBtdXN0IGhhdmUgUEFVU0VSX1JPTEUAAAAAAAAFcGF1c2UAAAAAAAABAAAAAAAAAAhvcGVyYXRvcgAAABMAAAAA",
        "AAAAAAAAAFZVbnBhdXNlcyB0aGUgT0ZULgoKIyBBcmd1bWVudHMKKiBgb3BlcmF0b3JgIC0gVGhlIGFkZHJlc3MgdGhhdCBtdXN0IGhhdmUgVU5QQVVTRVJfUk9MRQAAAAAAB3VucGF1c2UAAAAAAQAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAA==",
        "AAAAAAAAACRSZXR1cm5zIHRoZSBwYXVzZWQgc3RhdGUgb2YgdGhlIE9GVC4AAAAJaXNfcGF1c2VkAAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAAAAAAAAJcXVvdGVfb2Z0AAAAAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAACnNlbmRfcGFyYW0AAAAAB9AAAAAJU2VuZFBhcmFtAAAAAAAAAQAAA+0AAAADAAAH0AAAAAhPRlRMaW1pdAAAA+oAAAfQAAAADE9GVEZlZURldGFpbAAAB9AAAAAKT0ZUUmVjZWlwdAAA",
        "AAAAAAAAAEdSZXR1cm5zIHRoZSBhZGRyZXNzIG9mIHRoZSB1bmRlcmx5aW5nIFNFUC00MSB0b2tlbiBtYW5hZ2VkIGJ5IHRoaXMgT0ZULgAAAAAFdG9rZW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAKFSZXR1cm5zIHRoZSBPRlQgbWVzc2FnaW5nIHByb3RvY29sIHZlcnNpb24gYXMgYChtYWpvciwgbWlub3IpYC4KClRoZSB2ZXJzaW9uIGlzIHVzZWQgYnkgb2ZmLWNoYWluIHRvb2xpbmcgYW5kIHBlZXIgY29udHJhY3RzIHRvIHZlcmlmeSB3aXJlLWZvcm1hdApjb21wYXRpYmlsaXR5LgAAAAAAAAtvZnRfdmVyc2lvbgAAAAAAAAAAAQAAA+0AAAACAAAABgAAAAY=",
        "AAAAAAAAAWZSZXR1cm5zIHRoZSAqKnNoYXJlZCBkZWNpbWFscyoqIOKAlCB0aGUgY29tbW9uIGRlY2ltYWwgcHJlY2lzaW9uIHVzZWQgaW4gY3Jvc3MtY2hhaW4KbWVzc2FnZXMuCgpUb2tlbiBhbW91bnRzIGFyZSBub3JtYWxpemVkIHRvIHRoaXMgcHJlY2lzaW9uIGJlZm9yZSBlbmNvZGluZyBpbnRvIExheWVyWmVybwptZXNzYWdlcywgZW5zdXJpbmcgY29uc2lzdGVudCB2YWx1ZXMgcmVnYXJkbGVzcyBvZiBlYWNoIGNoYWluJ3MgbmF0aXZlIHRva2VuCmRlY2ltYWxzLiBGb3IgZXhhbXBsZSwgYSB0b2tlbiB3aXRoIDE4IGxvY2FsIGRlY2ltYWxzIGFuZCA2IHNoYXJlZCBkZWNpbWFscyBoYXMgYQpjb252ZXJzaW9uIHJhdGUgb2YgMTBeMTIuAAAAAAAPc2hhcmVkX2RlY2ltYWxzAAAAAAAAAAABAAAABA==",
        "AAAAAAAAAUxSZXR1cm5zIHRoZSAqKmRlY2ltYWwgY29udmVyc2lvbiByYXRlKiogKGAxMCBeIChsb2NhbF9kZWNpbWFscyAtIHNoYXJlZF9kZWNpbWFscylgKS4KClRoaXMgbXVsdGlwbGllciBjb252ZXJ0cyBiZXR3ZWVuIGxvY2FsLWRlY2ltYWwgYW1vdW50cyAodXNlZCBvbi1jaGFpbikgYW5kCnNoYXJlZC1kZWNpbWFsIGFtb3VudHMgKHVzZWQgaW4gY3Jvc3MtY2hhaW4gbWVzc2FnZXMpLiBBbnkgc3ViLWNvbnZlcnNpb24tcmF0ZQpyZW1haW5kZXIgKCJkdXN0IikgaXMgc3RyaXBwZWQgYmVmb3JlIHNlbmRpbmcgdG8gYXZvaWQgcm91bmRpbmcgZGlzY3JlcGFuY2llcwphY3Jvc3MgY2hhaW5zLgAAABdkZWNpbWFsX2NvbnZlcnNpb25fcmF0ZQAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAAaxJbmRpY2F0ZXMgd2hldGhlciB0aGUgY2FsbGVyIG11c3QgYXBwcm92ZSBhIHRva2VuIGFsbG93YW5jZSBiZWZvcmUgY2FsbGluZyBbYHNlbmRgXShPRlRDb3JlOjpzZW5kKS4KCi0gKipgZmFsc2VgKiogKGRlZmF1bHQpIOKAlCBubyBzZXBhcmF0ZSBhcHByb3ZhbCBzdGVwIGlzIG5lZWRlZC4KLSAqKmB0cnVlYCoqIOKAlCB0aGUgY2FsbGVyIG11c3QgZ3JhbnQgYSB0b2tlbiBhbGxvd2FuY2UgdG8gdGhpcyBjb250cmFjdCBiZWZvcmUKc2VuZGluZyAoZS5nLiwgdmlhIGB0b2tlbi5hcHByb3ZlKG9mdF9hZGRyZXNzLCBhbW91bnQsIC4uLilgKS4KCldhbGxldCBhbmQgZnJvbnRlbmQgaW50ZWdyYXRvcnMgc2hvdWxkIGNoZWNrIHRoaXMgdG8gZGV0ZXJtaW5lIHdoZXRoZXIgYW4gYXBwcm92YWwKdHJhbnNhY3Rpb24gbXVzdCBwcmVjZWRlIHRoZSBzZW5kLgAAABFhcHByb3ZhbF9yZXF1aXJlZAAAAAAAAAAAAAABAAAAAQ==",
        "AAAAAAAAAS1SZXR1cm5zIHRoZSBjdXJyZW50IG1lc3NhZ2UgaW5zcGVjdG9yIGNvbnRyYWN0IGFkZHJlc3MsIG9yIGBOb25lYCBpZiB1bnNldC4KCldoZW4gc2V0LCB0aGUgaW5zcGVjdG9yJ3MgYGluc3BlY3RgIG1ldGhvZCBpcyBpbnZva2VkIGR1cmluZyBib3RoCltgcXVvdGVfc2VuZGBdKE9GVENvcmU6OnF1b3RlX3NlbmQpIGFuZCBbYHNlbmRgXShPRlRDb3JlOjpzZW5kKSB0byB2YWxpZGF0ZSB0aGUKb3V0Z29pbmcgbWVzc2FnZSBwYXlsb2FkIGFuZCBvcHRpb25zIGJlZm9yZSB0aGV5IHJlYWNoIHRoZSBMYXllclplcm8gZW5kcG9pbnQuAAAAAAAADW1zZ19pbnNwZWN0b3IAAAAAAAAAAAAAAQAAA+gAAAAT",
        "AAAAAAAAAmZTZXRzIG9yIHJlbW92ZXMgdGhlIG1lc3NhZ2UgaW5zcGVjdG9yIGNvbnRyYWN0LgoKVGhlIG1lc3NhZ2UgaW5zcGVjdG9yIGlzIGFuICoqb3B0aW9uYWwqKiB2YWxpZGF0aW9uIGhvb2suIFdoZW4gY29uZmlndXJlZCwgZXZlcnkKb3V0Ym91bmQgbWVzc2FnZSAoZnJvbSBib3RoIGBzZW5kYCBhbmQgYHF1b3RlX3NlbmRgKSBpcyBwYXNzZWQgdG8gdGhlIGluc3BlY3Rvcgpjb250cmFjdCdzIGBpbnNwZWN0KGNvbnRyYWN0LCBtZXNzYWdlLCBvcHRpb25zKWAgbWV0aG9kLiBUaGUgaW5zcGVjdG9yIHNob3VsZAoqKnBhbmljKiogdG8gcmVqZWN0IGludmFsaWQgbWVzc2FnZXMsIGFjdGluZyBhcyBhbiBvbi1jaGFpbiBwb2xpY3kgZ2F0ZS4KClBhc3MgYE5vbmVgIHRvIHJlbW92ZSB0aGUgaW5zcGVjdG9yIGFuZCBkaXNhYmxlIG91dGJvdW5kIHZhbGlkYXRpb24uCgojIEF1dGhvcml6YXRpb24KUmVxdWlyZXMgdGhlIGNhbGxlciB0byBiZSB0aGUgYXV0aG9yaXplci4KCiMgQXJndW1lbnRzCiogYGluc3BlY3RvcmAgLSBBZGRyZXNzIG9mIHRoZSBpbnNwZWN0b3IgY29udHJhY3QsIG9yIGBOb25lYCB0byByZW1vdmUgaXQKKiBgb3BlcmF0b3JgIC0gVGhlIGF1dGhvcml6ZXIgYWRkcmVzcwAAAAAAEXNldF9tc2dfaW5zcGVjdG9yAAAAAAAAAgAAAAAAAAAJaW5zcGVjdG9yAAAAAAAD6AAAABMAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAArBRdW90ZXMgdGhlICoqTGF5ZXJaZXJvIG1lc3NhZ2luZyBmZWUqKiByZXF1aXJlZCBmb3IgYSBjcm9zcy1jaGFpbiBzZW5kLgoKQnVpbGRzIHRoZSBvdXRnb2luZyBtZXNzYWdlIGFuZCBvcHRpb25zIGZyb20gYHNlbmRfcGFyYW1gLCB0aGVuIHF1ZXJpZXMgdGhlCkxheWVyWmVybyBlbmRwb2ludCBmb3IgdGhlIGNvcnJlc3BvbmRpbmcgZmVlLiBJZiBhIG1lc3NhZ2UgaW5zcGVjdG9yIGlzIHNldCwgaXQKd2lsbCBhbHNvIHZhbGlkYXRlIHRoZSBtZXNzYWdlIGF0IHRoaXMgc3RhZ2UuCgojIEFyZ3VtZW50cwoqIGBmcm9tYCAtIFRoZSBhZGRyZXNzIHRoYXQgd291bGQgaW5pdGlhdGUgdGhlIHRyYW5zZmVyCiogYHNlbmRfcGFyYW1gIC0gVGhlIHByb3Bvc2VkIHRyYW5zZmVyIHBhcmFtZXRlcnMKKiBgcGF5X2luX3pyb2AgLSBgdHJ1ZWAgdG8gcGF5IHRoZSBtZXNzYWdpbmcgZmVlIGluIHRoZSBaUk8gdG9rZW47IGBmYWxzZWAgdG8gcGF5CmluIHRoZSBjaGFpbidzIG5hdGl2ZSB0b2tlbgoKIyBSZXR1cm5zCkEgW2BNZXNzYWdpbmdGZWVgXShlbmRwb2ludF92Mjo6TWVzc2FnaW5nRmVlKSBjb250YWluaW5nIHRoZSBgbmF0aXZlX2ZlZWAgYW5kCmB6cm9fZmVlYCByZXF1aXJlZCBieSB0aGUgZW5kcG9pbnQuIFBhc3MgdGhpcyB2YWx1ZSAob3IgYSBzdXBlcnNldCkgdG8KW2BzZW5kYF0oT0ZUQ29yZTo6c2VuZCkuAAAACnF1b3RlX3NlbmQAAAAAAAMAAAAAAAAABGZyb20AAAATAAAAAAAAAApzZW5kX3BhcmFtAAAAAAfQAAAACVNlbmRQYXJhbQAAAAAAAAAAAAAKcGF5X2luX3pybwAAAAAAAQAAAAEAAAfQAAAADE1lc3NhZ2luZ0ZlZQ==",
        "AAAAAAAAA0VFeGVjdXRlcyBhIGNyb3NzLWNoYWluIHRva2VuIHRyYW5zZmVyIHZpYSB0aGUgTGF5ZXJaZXJvIGVuZHBvaW50LgoKQnVpbGRzIHRoZSBPRlQgbWVzc2FnZSBhbmQgb3B0aW9ucywgdGhlbiBzZW5kcyB0aGUgbWVzc2FnZSB0aHJvdWdoIHRoZSBMYXllclplcm8gZW5kcG9pbnQuCgojIEFyZ3VtZW50cwoqIGBmcm9tYCAtIFRoZSB0b2tlbiBzZW5kZXIgKG11c3QgYXV0aG9yaXplIHRoZSBjYWxsKQoqIGBzZW5kX3BhcmFtYCAtIFRyYW5zZmVyIHBhcmFtZXRlcnMgaW5jbHVkaW5nIGRlc3RpbmF0aW9uIGNoYWluIChgZHN0X2VpZGApLApyZWNpcGllbnQgKGB0b2ApLCBhbW91bnQsIHNsaXBwYWdlIGZsb29yIChgbWluX2Ftb3VudF9sZGApLCBleHRyYSBvcHRpb25zLCBhbmQKYW4gb3B0aW9uYWwgY29tcG9zZSBtZXNzYWdlCiogYGZlZWAgLSBUaGUgbWVzc2FnaW5nIGZlZSB0byBwYXkgKG9idGFpbiBmcm9tIFtgcXVvdGVfc2VuZGBdKE9GVENvcmU6OnF1b3RlX3NlbmQpKQoqIGByZWZ1bmRfYWRkcmVzc2AgLSBBZGRyZXNzIHRvIHJlY2VpdmUgYW55IGV4Y2VzcyBmZWUgcmVmdW5kCgojIFJldHVybnMKKiBbYE1lc3NhZ2luZ1JlY2VpcHRgXShlbmRwb2ludF92Mjo6TWVzc2FnaW5nUmVjZWlwdCkg4oCUIHRoZSBMYXllclplcm8gbWVzc2FnZSBHVUlELApub25jZSwgYW5kIGZlZSBhY3R1YWxseSBjb25zdW1lZAoqIFtgT0ZUUmVjZWlwdGBdKGNyYXRlOjp0eXBlczo6T0ZUUmVjZWlwdCkg4oCUIGBhbW91bnRfc2VudF9sZGAgKGRlYml0ZWQpIGFuZApgYW1vdW50X3JlY2VpdmVkX2xkYCAoY3JlZGl0ZWQgb24gZGVzdGluYXRpb24gYWZ0ZXIgZHVzdCByZW1vdmFsIC8gZmVlcykAAAAAAAAEc2VuZAAAAAQAAAAAAAAABGZyb20AAAATAAAAAAAAAApzZW5kX3BhcmFtAAAAAAfQAAAACVNlbmRQYXJhbQAAAAAAAAAAAAADZmVlAAAAB9AAAAAMTWVzc2FnaW5nRmVlAAAAAAAAAA5yZWZ1bmRfYWRkcmVzcwAAAAAAEwAAAAEAAAPtAAAAAgAAB9AAAAAQTWVzc2FnaW5nUmVjZWlwdAAAB9AAAAAKT0ZUUmVjZWlwdAAA",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAUAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAPc2hhcmVkX2RlY2ltYWxzAAAAAAQAAAAAAAAACG9mdF90eXBlAAAH0AAAAAdPZnRUeXBlAAAAAAAAAAAIZW5kcG9pbnQAAAATAAAAAAAAAAhkZWxlZ2F0ZQAAABMAAAAA",
        "AAAAAAAAAD9SZXR1cm5zIHRoZSBPRlQgdHlwZSB3aXRoIGl0cyB0YXJnZXQgYWRkcmVzcyBhbmQgY29uZmlndXJhdGlvbi4AAAAACG9mdF90eXBlAAAAAAAAAAEAAAfQAAAAB09mdFR5cGUA",
        "AAAAAAAAAK5SZXRyaWV2ZXMgdGhlIE9BcHAgdmVyc2lvbiBpbmZvcm1hdGlvbi4KCiMgUmV0dXJucwpBIHR1cGxlIGNvbnRhaW5pbmc6Ci0gYHNlbmRlcl92ZXJzaW9uYDogVGhlIHZlcnNpb24gb2YgdGhlIE9BcHBTZW5kZXIKLSBgcmVjZWl2ZXJfdmVyc2lvbmA6IFRoZSB2ZXJzaW9uIG9mIHRoZSBPQXBwUmVjZWl2ZXIAAAAAAAxvYXBwX3ZlcnNpb24AAAAAAAAAAQAAA+0AAAACAAAABgAAAAY=",
        "AAAAAAAAAGxSZXRyaWV2ZXMgdGhlIExheWVyWmVybyBlbmRwb2ludCBhZGRyZXNzIGFzc29jaWF0ZWQgd2l0aCB0aGUgT0FwcC4KCiMgUmV0dXJucwpUaGUgTGF5ZXJaZXJvIGVuZHBvaW50IGFkZHJlc3MAAAAIZW5kcG9pbnQAAAAAAAAAAQAAABM=",
        "AAAAAAAAAMFSZXRyaWV2ZXMgdGhlIHBlZXIgKE9BcHApIGFzc29jaWF0ZWQgd2l0aCBhIGNvcnJlc3BvbmRpbmcgZW5kcG9pbnQuCgojIEFyZ3VtZW50cwoqIGBlaWRgIC0gVGhlIGVuZHBvaW50IElECgojIFJldHVybnMKVGhlIHBlZXIgYWRkcmVzcyAoT0FwcCBpbnN0YW5jZSkgYXNzb2NpYXRlZCB3aXRoIHRoZSBjb3JyZXNwb25kaW5nIGVuZHBvaW50AAAAAAAABHBlZXIAAAABAAAAAAAAAANlaWQAAAAABAAAAAEAAAPoAAAD7gAAACA=",
        "AAAAAAAAAQtTZXRzIG9yIHJlbW92ZXMgdGhlIHBlZXIgYWRkcmVzcyAoT0FwcCBpbnN0YW5jZSkgZm9yIGEgY29ycmVzcG9uZGluZyBlbmRwb2ludC4KCiMgQXJndW1lbnRzCiogYGVpZGAgLSBUaGUgZW5kcG9pbnQgSUQKKiBgcGVlcmAgLSBUaGUgYWRkcmVzcyBvZiB0aGUgcGVlciB0byBiZSBhc3NvY2lhdGVkIHdpdGggdGhlIGNvcnJlc3BvbmRpbmcgZW5kcG9pbnQsIG9yIE5vbmUgdG8gcmVtb3ZlIHRoZSBwZWVyCiogYG9wZXJhdG9yYCAtIFRoZSBhdXRob3JpemVyIGFkZHJlc3MAAAAACHNldF9wZWVyAAAAAwAAAAAAAAADZWlkAAAAAAQAAAAAAAAABHBlZXIAAAPoAAAD7gAAACAAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAALRTZXRzIHRoZSBkZWxlZ2F0ZSBhZGRyZXNzIGZvciB0aGUgT0FwcCBDb3JlLgoKIyBBcmd1bWVudHMKKiBgZGVsZWdhdGVgIC0gVGhlIGFkZHJlc3Mgb2YgdGhlIGRlbGVnYXRlIHRvIGJlIHNldCwgb3IgTm9uZSB0byByZW1vdmUgdGhlIGRlbGVnYXRlCiogYG9wZXJhdG9yYCAtIFRoZSBhdXRob3JpemVyIGFkZHJlc3MAAAAMc2V0X2RlbGVnYXRlAAAAAgAAAAAAAAAIZGVsZWdhdGUAAAPoAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAA==",
        "AAAAAAAAAQxHcmFudHMgYSByb2xlIHRvIGFuIGFjY291bnQuIENhbGxlciBtdXN0IGJlIG93bmVyIG9yIGhhdmUgdGhlIHJvbGUncyBhZG1pbiByb2xlLgoKIyBBcmd1bWVudHMKKiBgYWNjb3VudGAgLSBUaGUgYWNjb3VudCB0byBncmFudCB0aGUgcm9sZSB0by4KKiBgcm9sZWAgLSBUaGUgcm9sZSB0byBncmFudC4KKiBgY2FsbGVyYCAtIFRoZSBhY2NvdW50IHRoYXQgaXMgZ3JhbnRpbmcgdGhlIHJvbGUuIE11c3QgYmUgb3duZXIgb3IgaGF2ZSB0aGUgcm9sZSdzIGFkbWluIHJvbGUuAAAACmdyYW50X3JvbGUAAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAEcm9sZQAAABEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAA=",
        "AAAAAAAAARNSZXZva2VzIGEgcm9sZSBmcm9tIGFuIGFjY291bnQuIENhbGxlciBtdXN0IGJlIG93bmVyIG9yIGhhdmUgdGhlIHJvbGUncyBhZG1pbiByb2xlLgoKIyBBcmd1bWVudHMKKiBgYWNjb3VudGAgLSBUaGUgYWNjb3VudCB0byByZXZva2UgdGhlIHJvbGUgZnJvbS4KKiBgcm9sZWAgLSBUaGUgcm9sZSB0byByZXZva2UuCiogYGNhbGxlcmAgLSBUaGUgYWNjb3VudCB0aGF0IGlzIHJldm9raW5nIHRoZSByb2xlLiBNdXN0IGJlIG93bmVyIG9yIGhhdmUgdGhlIHJvbGUncyBhZG1pbiByb2xlLgAAAAALcmV2b2tlX3JvbGUAAAAAAwAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==",
        "AAAAAAAAAO1BbGxvd3MgYW4gYWNjb3VudCB0byByZW5vdW5jZSBhIHJvbGUgYXNzaWduZWQgdG8gaXRzZWxmLgpVc2VycyBjYW4gb25seSByZW5vdW5jZSByb2xlcyBmb3IgdGhlaXIgb3duIGFjY291bnQuCgojIEFyZ3VtZW50cwoqIGByb2xlYCAtIFRoZSByb2xlIHRvIHJlbm91bmNlLgoqIGBjYWxsZXJgIC0gVGhlIGFjY291bnQgdGhhdCBpcyByZW5vdW5jaW5nIHRoZSByb2xlLiBNdXN0IGJlIHRoZSBhY2NvdW50IGl0c2VsZi4AAAAAAAANcmVub3VuY2Vfcm9sZQAAAAAAAAIAAAAAAAAABHJvbGUAAAARAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAA",
        "AAAAAAAAAVdTZXRzIGBhZG1pbl9yb2xlYCBhcyB0aGUgYWRtaW4gcm9sZSBvZiBgcm9sZWAuIENhbGxlciBtdXN0IGJlIHRoZSBhdXRob3JpemVyLgoKIyBBcmd1bWVudHMKKiBgcm9sZWAgLSBUaGUgcm9sZSB0byBzZXQgdGhlIGFkbWluIGZvci4KKiBgYWRtaW5fcm9sZWAgLSBUaGUgYWRtaW4gcm9sZSB0byBzZXQgZm9yIHRoZSByb2xlLgoKIyBOb3RlcwoKVGhlIGFkbWluIHJvbGUgY2FuIGJlIGFueSBgU3ltYm9sYCwgaW5jbHVkaW5nIG9uZSB3aXRoIG5vIG1lbWJlcnMuIElmIHRoZSBhZG1pbgpyb2xlIGhhcyBubyBtZW1iZXJzLCBvbmx5IHRoZSBhdXRob3JpemVyIGNhbiBncmFudC9yZXZva2UgdGhlIHJvbGUuAAAAAA5zZXRfcm9sZV9hZG1pbgAAAAAAAgAAAAAAAAAEcm9sZQAAABEAAAAAAAAACmFkbWluX3JvbGUAAAAAABEAAAAA",
        "AAAAAAAAANhSZW1vdmVzIHRoZSBhZG1pbiByb2xlIGZvciBhIHNwZWNpZmllZCByb2xlLiBDYWxsZXIgbXVzdCBiZSB0aGUgYXV0aG9yaXplci4KCiMgQXJndW1lbnRzCiogYHJvbGVgIC0gVGhlIHJvbGUgdG8gcmVtb3ZlIHRoZSBhZG1pbiBmb3IuCgojIEVycm9ycwoqIGBSYmFjRXJyb3I6OkFkbWluUm9sZU5vdEZvdW5kYCAtIElmIG5vIGFkbWluIHJvbGUgaXMgc2V0IGZvciB0aGUgcm9sZS4AAAARcmVtb3ZlX3JvbGVfYWRtaW4AAAAAAAABAAAAAAAAAARyb2xlAAAAEQAAAAA=",
        "AAAAAAAAAPZSZXR1cm5zIGBTb21lKGluZGV4KWAgaWYgdGhlIGFjY291bnQgaGFzIHRoZSBzcGVjaWZpZWQgcm9sZSwgd2hlcmUgYGluZGV4YAppcyB0aGUgaW5kZXggb2YgdGhlIGFjY291bnQgaW4gdGhlIHJvbGUuIFJldHVybnMgYE5vbmVgIGlmIG5vdC4KCiMgQXJndW1lbnRzCiogYGFjY291bnRgIC0gVGhlIGFjY291bnQgdG8gY2hlY2sgdGhlIHJvbGUgZm9yLgoqIGByb2xlYCAtIFRoZSByb2xlIHRvIGNoZWNrIHRoZSBhY2NvdW50IGZvci4AAAAAAAhoYXNfcm9sZQAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAEcm9sZQAAABEAAAABAAAD6AAAAAQ=",
        "AAAAAAAAAHZSZXR1cm5zIHRoZSBhZG1pbiByb2xlIGZvciBhIHNwZWNpZmljIHJvbGUsIG9yIE5vbmUgaWYgbm90IHNldC4KCiMgQXJndW1lbnRzCiogYHJvbGVgIC0gVGhlIHJvbGUgdG8gZ2V0IHRoZSBhZG1pbiBmb3IuAAAAAAAOZ2V0X3JvbGVfYWRtaW4AAAAAAAEAAAAAAAAABHJvbGUAAAARAAAAAQAAA+gAAAAR",
        "AAAAAAAAAHpSZXR1cm5zIHRoZSBudW1iZXIgb2YgYWNjb3VudHMgdGhhdCBoYXZlIHRoZSBzcGVjaWZpZWQgcm9sZS4KCiMgQXJndW1lbnRzCiogYHJvbGVgIC0gVGhlIHJvbGUgdG8gZ2V0IHRoZSBtZW1iZXIgY291bnQgZm9yLgAAAAAAFWdldF9yb2xlX21lbWJlcl9jb3VudAAAAAAAAAEAAAAAAAAABHJvbGUAAAARAAAAAQAAAAQ=",
        "AAAAAAAAAOlSZXR1cm5zIHRoZSBhY2NvdW50IGF0IHRoZSBzcGVjaWZpZWQgaW5kZXggZm9yIGEgZ2l2ZW4gcm9sZS4KCiMgQXJndW1lbnRzCiogYHJvbGVgIC0gVGhlIHJvbGUgdG8gZ2V0IHRoZSBtZW1iZXIgZm9yLgoqIGBpbmRleGAgLSBUaGUgaW5kZXggb2YgdGhlIG1lbWJlciB0byBnZXQuCgojIEVycm9ycwoqIGBSYmFjRXJyb3I6OkluZGV4T3V0T2ZCb3VuZHNgIGlmIHRoZSBpbmRleCBpcyBvdXQgb2YgYm91bmRzLgAAAAAAAA9nZXRfcm9sZV9tZW1iZXIAAAAAAgAAAAAAAAAEcm9sZQAAABEAAAAAAAAABWluZGV4AAAAAAAABAAAAAEAAAAT",
        "AAAAAAAAAPJSZXR1cm5zIGFsbCByb2xlcyB0aGF0IGN1cnJlbnRseSBoYXZlIGF0IGxlYXN0IG9uZSBtZW1iZXIuCkRlZmF1bHRzIHRvIGVtcHR5IHZlY3RvciBpZiBubyByb2xlcyBleGlzdC4KCiMgTm90ZXMKClRoaXMgZnVuY3Rpb24gcmV0dXJucyBhbGwgcm9sZXMgdGhhdCBjdXJyZW50bHkgaGF2ZSBhdCBsZWFzdCBvbmUgbWVtYmVyLgpUaGUgbWF4aW11bSBudW1iZXIgb2Ygcm9sZXMgaXMgbGltaXRlZCBieSBbYE1BWF9ST0xFU2BdLgAAAAAAEmdldF9leGlzdGluZ19yb2xlcwAAAAAAAAAAAAEAAAPqAAAAEQ==",
        "AAAAAAAAALdDaGVja3MgaWYgYSBtZXNzYWdpbmcgcGF0aCBjYW4gYmUgaW5pdGlhbGl6ZWQgZm9yIHRoZSBnaXZlbiBvcmlnaW4uCgojIEFyZ3VtZW50cwoqIGBvcmlnaW5gIC0gVGhlIG9yaWdpbiBvZiB0aGUgbWVzc2FnZQoKIyBSZXR1cm5zClRydWUgaWYgdGhlIHBhdGggY2FuIGJlIGluaXRpYWxpemVkLCBmYWxzZSBvdGhlcndpc2UAAAAAFWFsbG93X2luaXRpYWxpemVfcGF0aAAAAAAAAAEAAAAAAAAABm9yaWdpbgAAAAAH0AAAAAZPcmlnaW4AAAAAAAEAAAAB",
        "AAAAAAAAAfhSZXRyaWV2ZXMgdGhlIG5leHQgbm9uY2UgZm9yIGEgZ2l2ZW4gc291cmNlIGVuZHBvaW50IGFuZCBzZW5kZXIgYWRkcmVzcy4KClRoZSBwYXRoIG5vbmNlIHN0YXJ0cyBmcm9tIDEuIElmIDAgaXMgcmV0dXJuZWQgaXQgbWVhbnMgdGhhdCB0aGVyZSBpcyBOTyBub25jZSBvcmRlcmVkIGVuZm9yY2VtZW50LgpUaGlzIGlzIHJlcXVpcmVkIGJ5IHRoZSBvZmYtY2hhaW4gZXhlY3V0b3IgdG8gZGV0ZXJtaW5lIGlmIHRoZSBPQXBwIGV4cGVjdHMgbWVzc2FnZSBleGVjdXRpb24gdG8gYmUgb3JkZXJlZC4KVGhpcyBpcyBhbHNvIGVuZm9yY2VkIGJ5IHRoZSBPQXBwLgpCeSBkZWZhdWx0IHRoaXMgaXMgTk9UIGVuYWJsZWQsIGkuZS4gbmV4dF9ub25jZSBpcyBoYXJkY29kZWQgdG8gcmV0dXJuIDAuCgojIEFyZ3VtZW50cwoqIGBzcmNfZWlkYCAtIFRoZSBzb3VyY2UgZW5kcG9pbnQgSUQKKiBgc2VuZGVyYCAtIFRoZSBzZW5kZXIgT0FwcCBhZGRyZXNzCgojIFJldHVybnMKVGhlIG5leHQgbm9uY2UAAAAKbmV4dF9ub25jZQAAAAAAAgAAAAAAAAAHc3JjX2VpZAAAAAAEAAAAAAAAAAZzZW5kZXIAAAAAA+4AAAAgAAAAAQAAAAY=",
        "AAAAAAAAAx1FbnRyeSBwb2ludCBmb3IgcmVjZWl2aW5nIG1lc3NhZ2VzIG9yIHBhY2tldHMgZnJvbSB0aGUgTGF5ZXJaZXJvIGVuZHBvaW50LgoKVGhlIGRlZmF1bHQgaW1wbGVtZW50YXRpb24gY2FsbHMgYGNsZWFyX3BheWxvYWRfYW5kX3RyYW5zZmVyYCB0byB2YWxpZGF0ZSB0aGUgbWVzc2FnZQphbmQgY2xlYXIgaXQgZnJvbSB0aGUgZW5kcG9pbnQsIHRoZW4gZGVsZWdhdGVzIHRvIGBfX2x6X3JlY2VpdmVgIGZvciBhcHBsaWNhdGlvbiBsb2dpYy4KCiMgQXJndW1lbnRzCiogYGV4ZWN1dG9yYCAtIFRoZSBhZGRyZXNzIG9mIHRoZSBleGVjdXRvciBmb3IgdGhlIHJlY2VpdmVkIG1lc3NhZ2UKKiBgb3JpZ2luYCAtIFRoZSBvcmlnaW4gaW5mb3JtYXRpb24gY29udGFpbmluZyB0aGUgc291cmNlIGVuZHBvaW50IGFuZCBzZW5kZXIgYWRkcmVzczoKLSBgc3JjX2VpZGA6IFRoZSBzb3VyY2UgZW5kcG9pbnQgSUQKLSBgc2VuZGVyYDogVGhlIHNlbmRlciBhZGRyZXNzIG9uIHRoZSBzb3VyY2UgY2hhaW4KLSBgbm9uY2VgOiBUaGUgbm9uY2Ugb2YgdGhlIG1lc3NhZ2UKKiBgZ3VpZGAgLSBUaGUgdW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSByZWNlaXZlZCBMYXllclplcm8gbWVzc2FnZQoqIGBtZXNzYWdlYCAtIFRoZSBwYXlsb2FkIG9mIHRoZSByZWNlaXZlZCBtZXNzYWdlCiogYGV4dHJhX2RhdGFgIC0gQWRkaXRpb25hbCBhcmJpdHJhcnkgZGF0YSBwcm92aWRlZCBieSB0aGUgY29ycmVzcG9uZGluZyBleGVjdXRvcgoqIGB2YWx1ZWAgLSBUaGUgbmF0aXZlIHRva2VuIHZhbHVlIHNlbnQgd2l0aCB0aGUgbWVzc2FnZQAAAAAAAApsel9yZWNlaXZlAAAAAAAGAAAAAAAAAAhleGVjdXRvcgAAABMAAAAAAAAABm9yaWdpbgAAAAAH0AAAAAZPcmlnaW4AAAAAAAAAAAAEZ3VpZAAAA+4AAAAgAAAAAAAAAAdtZXNzYWdlAAAAAA4AAAAAAAAACmV4dHJhX2RhdGEAAAAAAA4AAAAAAAAABXZhbHVlAAAAAAAACwAAAAA=",
        "AAAAAAAAAexJbmRpY2F0ZXMgd2hldGhlciBhbiBhZGRyZXNzIGlzIGFuIGFwcHJvdmVkIGNvbXBvc2VNc2cgc2VuZGVyIHRvIHRoZSBFbmRwb2ludC4KCkFwcGxpY2F0aW9ucyBjYW4gb3B0aW9uYWxseSBjaG9vc2UgdG8gaW1wbGVtZW50IHNlcGFyYXRlIGNvbXBvc2VNc2cgc2VuZGVycyB0aGF0IGFyZSBOT1QgdGhlIGJyaWRnaW5nIGxheWVyLgpUaGUgZGVmYXVsdCBzZW5kZXIgSVMgdGhlIE9BcHBSZWNlaXZlciBpbXBsZW1lbnRlci4KCiMgQXJndW1lbnRzCiogYG9yaWdpbmAgLSBUaGUgb3JpZ2luIGluZm9ybWF0aW9uIGNvbnRhaW5pbmcgdGhlIHNvdXJjZSBlbmRwb2ludCBhbmQgc2VuZGVyIGFkZHJlc3MKKiBgbWVzc2FnZWAgLSBUaGUgbHpSZWNlaXZlIHBheWxvYWQKKiBgc2VuZGVyYCAtIFRoZSBzZW5kZXIgYWRkcmVzcyB0byBjaGVjawoKIyBSZXR1cm5zClRydWUgaWYgdGhlIHNlbmRlciBpcyBhIHZhbGlkIGNvbXBvc2VNc2cgc2VuZGVyLCBmYWxzZSBvdGhlcndpc2UAAAAVaXNfY29tcG9zZV9tc2dfc2VuZGVyAAAAAAAAAwAAAAAAAAAGb3JpZ2luAAAAAAfQAAAABk9yaWdpbgAAAAAAAAAAAAdtZXNzYWdlAAAAAA4AAAAAAAAABnNlbmRlcgAAAAAAEwAAAAEAAAAB",
        "AAAAAAAAANlSZXRyaWV2ZXMgdGhlIGVuZm9yY2VkIG9wdGlvbnMgZm9yIGEgZ2l2ZW4gZW5kcG9pbnQgYW5kIG1lc3NhZ2UgdHlwZS4KCiMgQXJndW1lbnRzCiogYGVpZGAgLSBUaGUgZW5kcG9pbnQgSUQKKiBgbXNnX3R5cGVgIC0gVGhlIE9BcHAgbWVzc2FnZSB0eXBlCgojIFJldHVybnMKVGhlIGVuZm9yY2VkIG9wdGlvbnMgZm9yIHRoZSBnaXZlbiBlbmRwb2ludCBhbmQgbWVzc2FnZSB0eXBlAAAAAAAAEGVuZm9yY2VkX29wdGlvbnMAAAACAAAAAAAAAANlaWQAAAAABAAAAAAAAAAIbXNnX3R5cGUAAAAEAAAAAQAAA+gAAAAO",
        "AAAAAAAAAsxTZXRzIG9yIHJlbW92ZXMgdGhlIGVuZm9yY2VkIG9wdGlvbnMgZm9yIHNwZWNpZmljIGVuZHBvaW50IGFuZCBtZXNzYWdlIHR5cGUgY29tYmluYXRpb25zLgoKT25seSB0aGUgYGF1dGhvcml6ZXJgIG9mIHRoZSBPQXBwIGNhbiBjYWxsIHRoaXMgZnVuY3Rpb24uClByb3ZpZGVzIGEgd2F5IGZvciB0aGUgT0FwcCB0byBlbmZvcmNlIHRoaW5ncyBsaWtlIHBheWluZyBmb3IgUHJlQ3JpbWUsIEFORC9PUiBtaW5pbXVtIGRzdCBselJlY2VpdmUgZ2FzIGFtb3VudHMgZXRjLgpUaGVzZSBlbmZvcmNlZCBvcHRpb25zIGNhbiB2YXJ5IGFzIHRoZSBwb3RlbnRpYWwgb3B0aW9ucy9leGVjdXRpb24gb24gdGhlIHJlbW90ZSBtYXkgZGlmZmVyIGFzIHBlciB0aGUgbXNnX3R5cGUuCmUuZy4gQW1vdW50IG9mIGx6UmVjZWl2ZSgpIGdhcyBuZWNlc3NhcnkgdG8gZGVsaXZlciBhIGx6Q29tcG9zZSgpIG1lc3NhZ2UgYWRkcyBvdmVyaGVhZCB5b3UgZG9uJ3Qgd2FudCB0byBwYXkKaWYgeW91IGFyZSBvbmx5IG1ha2luZyBhIHN0YW5kYXJkIExheWVyWmVybyBtZXNzYWdlIGllLiBselJlY2VpdmUoKSBXSVRIT1VUIHNlbmRDb21wb3NlKCkuCgojIEFyZ3VtZW50cwoqIGBvcHRpb25zYCAtIEEgdmVjdG9yIG9mIEVuZm9yY2VkT3B0aW9uUGFyYW0gc3RydWN0dXJlcyBzcGVjaWZ5aW5nIGVuZm9yY2VkIG9wdGlvbnMKKiBgb3BlcmF0b3JgIC0gVGhlIGF1dGhvcml6ZXIgYWRkcmVzcwAAABRzZXRfZW5mb3JjZWRfb3B0aW9ucwAAAAIAAAAAAAAAB29wdGlvbnMAAAAD6gAAB9AAAAATRW5mb3JjZWRPcHRpb25QYXJhbQAAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAAnpDb21iaW5lcyBvcHRpb25zIGZvciBhIGdpdmVuIGVuZHBvaW50IGFuZCBtZXNzYWdlIHR5cGUuCgpJZiB0aGVyZSBpcyBhbiBlbmZvcmNlZCBselJlY2VpdmUgb3B0aW9uOgotIHtnYXNfbGltaXQ6IDIwMGssIHZhbHVlOiAxIFhMTX0gQU5EIGEgY2FsbGVyIHN1cHBsaWVzIGEgbHpSZWNlaXZlIG9wdGlvbjoge2dhc19saW1pdDogMTAwaywgdmFsdWU6IDAuNSBYTE19Ci0gVGhlIHJlc3VsdGluZyBvcHRpb25zIHdpbGwgYmUge2dhc19saW1pdDogMzAwaywgdmFsdWU6IDEuNSBYTE19IHdoZW4gdGhlIG1lc3NhZ2UgaXMgZXhlY3V0ZWQgb24gdGhlIHJlbW90ZSBsel9yZWNlaXZlKCkgZnVuY3Rpb24uClRoZSBwcmVzZW5jZSBvZiBkdXBsaWNhdGVkIG9wdGlvbnMgaXMgaGFuZGxlZCBvZmYtY2hhaW4gaW4gdGhlIHZlcmlmaWVyL2V4ZWN1dG9yLgoKIyBBcmd1bWVudHMKKiBgZWlkYCAtIFRoZSBlbmRwb2ludCBJRAoqIGBtc2dfdHlwZWAgLSBUaGUgT0FwcCBtZXNzYWdlIHR5cGUKKiBgZXh0cmFfb3B0aW9uc2AgLSBBZGRpdGlvbmFsIG9wdGlvbnMgcGFzc2VkIGJ5IHRoZSBjYWxsZXIKCiMgUmV0dXJucwpUaGUgY29tYmluYXRpb24gb2YgY2FsbGVyIHNwZWNpZmllZCBvcHRpb25zIEFORCBlbmZvcmNlZCBvcHRpb25zAAAAAAAPY29tYmluZV9vcHRpb25zAAAAAAMAAAAAAAAAA2VpZAAAAAAEAAAAAAAAAAhtc2dfdHlwZQAAAAQAAAAAAAAADWV4dHJhX29wdGlvbnMAAAAAAAAOAAAAAQAAAA4=",
        "AAAAAAAAACtVcGdyYWRlcyB0aGUgY29udHJhY3QgdG8gbmV3IFdBU00gYnl0ZWNvZGUuAAAAAAd1cGdyYWRlAAAAAAIAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAA==",
        "AAAAAAAAACZSdW5zIG1pZ3JhdGlvbiBsb2dpYyBhZnRlciBhbiB1cGdyYWRlLgAAAAAAB21pZ3JhdGUAAAAAAgAAAAAAAAAObWlncmF0aW9uX2RhdGEAAAAAAA4AAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAKYXV0aG9yaXplcgAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAD5SZXR1cm5zIHRoZSBjdXJyZW50IG93bmVyIGFkZHJlc3MsIG9yIE5vbmUgaWYgbm8gb3duZXIgaXMgc2V0LgAAAAAABW93bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAFlSZXR1cm5zIHRoZSBwZW5kaW5nIG93bmVyIGFkZHJlc3MgZm9yIDItc3RlcCB0cmFuc2Zlciwgb3IgTm9uZSBpZiBubyB0cmFuc2ZlciBpcyBwZW5kaW5nLgAAAAAAAA1wZW5kaW5nX293bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAASlUcmFuc2ZlcnMgb3duZXJzaGlwIGltbWVkaWF0ZWx5IHRvIGEgbmV3IGFkZHJlc3MuCgpVc2Ugd2l0aCBjYXV0aW9uIC0gaWYgeW91IHRyYW5zZmVyIHRvIGEgd3JvbmcgYWRkcmVzcywgb3duZXJzaGlwIGlzIGxvc3QgZm9yZXZlci4KQ29uc2lkZXIgdXNpbmcgYGJlZ2luX293bmVyc2hpcF90cmFuc2ZlcmAgaW5zdGVhZC4KCiMgUGFuaWNzCi0gYE93bmVyTm90U2V0YCBpZiBubyBvd25lciBpcyBjdXJyZW50bHkgc2V0Ci0gYFRyYW5zZmVySW5Qcm9ncmVzc2AgaWYgYSAyLXN0ZXAgdHJhbnNmZXIgaXMgaW4gcHJvZ3Jlc3MAAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAABAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAA==",
        "AAAAAAAAAlpCZWdpbnMgYW4gb3duZXJzaGlwIHRyYW5zZmVyIHRvIGEgbmV3IGFkZHJlc3MuCgpUaGUgbmV3IG93bmVyIG11c3QgY2FsbCBgYWNjZXB0X293bmVyc2hpcCgpYCB3aXRoaW4gYHR0bGAgbGVkZ2Vycwp0byBjb21wbGV0ZSB0aGUgdHJhbnNmZXIuIFRoZSBwZW5kaW5nIHRyYW5zZmVyIHdpbGwgYXV0b21hdGljYWxseSBleHBpcmUgYWZ0ZXIuCgojIEFyZ3VtZW50cwotIGBuZXdfb3duZXJgIC0gVGhlIHByb3Bvc2VkIG5ldyBvd25lcgotIGB0dGxgIC0gTnVtYmVyIG9mIGxlZGdlcnMgdGhlIG5ldyBvd25lciBoYXMgdG8gYWNjZXB0LgpVc2UgYDBgIHRvIGNhbmNlbCBhIHBlbmRpbmcgdHJhbnNmZXIgKG5ld19vd25lciBtdXN0IG1hdGNoIHBlbmRpbmcpLgoKIyBQYW5pY3MKLSBgT3duZXJOb3RTZXRgIGlmIG5vIG93bmVyIGlzIGN1cnJlbnRseSBzZXQKLSBgTm9QZW5kaW5nVHJhbnNmZXJgIHdoZW4gY2FuY2VsbGluZyBhbmQgbm8gcGVuZGluZyB0cmFuc2ZlciBleGlzdHMKLSBgSW52YWxpZFR0bGAgaWYgdHRsIGV4Y2VlZHMgbWF4IFRUTAotIGBJbnZhbGlkUGVuZGluZ093bmVyYCB3aGVuIGNhbmNlbGxpbmcgd2l0aCB3cm9uZyBuZXdfb3duZXIgYWRkcmVzcwAAAAAAGGJlZ2luX293bmVyc2hpcF90cmFuc2ZlcgAAAAIAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAA3R0bAAAAAAEAAAAAA==",
        "AAAAAAAAALlBY2NlcHRzIGEgcGVuZGluZyAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyLgoKTXVzdCBiZSBjYWxsZWQgYnkgdGhlIHBlbmRpbmcgb3duZXIgYmVmb3JlIHRoZSBUVEwgZXhwaXJlcy4KCiMgUGFuaWNzCi0gYE5vUGVuZGluZ1RyYW5zZmVyYCBpZiB0aGVyZSBpcyBubyBwZW5kaW5nIHRyYW5zZmVyIChvciBpdCBleHBpcmVkKQAAAAAAABBhY2NlcHRfb3duZXJzaGlwAAAAAAAAAAA=",
        "AAAAAAAAAKRQZXJtYW5lbnRseSByZW5vdW5jZXMgb3duZXJzaGlwLgoKIyBQYW5pY3MKLSBgT3duZXJOb3RTZXRgIGlmIG5vIG93bmVyIGlzIGN1cnJlbnRseSBzZXQKLSBgVHJhbnNmZXJJblByb2dyZXNzYCBpZiBhIDItc3RlcCB0cmFuc2ZlciBpcyBpbiBwcm9ncmVzcyAoY2FuY2VsIGl0IGZpcnN0KQAAABJyZW5vdW5jZV9vd25lcnNoaXAAAAAAAAAAAAAA",
        "AAAAAAAAAKVFeHRlbmRzIHRoZSBpbnN0YW5jZSBUVEwuCgojIEFyZ3VtZW50cwoKKiBgdGhyZXNob2xkYCAtIFRoZSB0aHJlc2hvbGQgdG8gZXh0ZW5kIHRoZSBUVEwgKGlmIGN1cnJlbnQgVFRMIGlzIGJlbG93IHRoaXMsIGV4dGVuZCkuCiogYGV4dGVuZF90b2AgLSBUaGUgVFRMIHRvIGV4dGVuZCB0by4AAAAAAAATZXh0ZW5kX2luc3RhbmNlX3R0bAAAAAACAAAAAAAAAAl0aHJlc2hvbGQAAAAAAAAEAAAAAAAAAAlleHRlbmRfdG8AAAAAAAAEAAAAAA==",
        "AAAAAAAAAY9TZXRzIFRUTCBjb25maWdzIGZvciBpbnN0YW5jZSBhbmQgcGVyc2lzdGVudCBzdG9yYWdlLgoKLSBgTm9uZWAgdmFsdWVzIHJlbW92ZSB0aGUgY29ycmVzcG9uZGluZyBjb25maWcgKGRpc2FibGVzIGF1dG8tZXh0ZW5zaW9uIGZvciB0aGF0IHR5cGUpCi0gVmFsaWRhdGVzIHRoYXQgYHRocmVzaG9sZCA8PSBleHRlbmRfdG8gPD0gTUFYX1RUTGAKCiMgQXJndW1lbnRzCi0gYGluc3RhbmNlYCAtIFRUTCBjb25maWcgZm9yIGluc3RhbmNlIHN0b3JhZ2UKLSBgcGVyc2lzdGVudGAgLSBUVEwgY29uZmlnIGZvciBwZXJzaXN0ZW50IHN0b3JhZ2UKCiMgUGFuaWNzCi0gYFR0bENvbmZpZ0Zyb3plbmAgaWYgY29uZmlncyBhcmUgZnJvemVuCi0gYEludmFsaWRUdGxDb25maWdgIGlmIHZhbGlkYXRpb24gZmFpbHMAAAAAD3NldF90dGxfY29uZmlncwAAAAACAAAAAAAAAAhpbnN0YW5jZQAAA+gAAAfQAAAACVR0bENvbmZpZwAAAAAAAAAAAAAKcGVyc2lzdGVudAAAAAAD6AAAB9AAAAAJVHRsQ29uZmlnAAAAAAAAAA==",
        "AAAAAAAAAEhSZXR1cm5zIHRoZSBjdXJyZW50IFRUTCBjb25maWdzIGFzIChpbnN0YW5jZV9jb25maWcsIHBlcnNpc3RlbnRfY29uZmlnKS4AAAALdHRsX2NvbmZpZ3MAAAAAAAAAAAEAAAPtAAAAAgAAA+gAAAfQAAAACVR0bENvbmZpZwAAAAAAA+gAAAfQAAAACVR0bENvbmZpZwAAAA==",
        "AAAAAAAAAOFQZXJtYW5lbnRseSBmcmVlemVzIFRUTCBjb25maWdzLCBwcmV2ZW50aW5nIGFueSBmdXR1cmUgbW9kaWZpY2F0aW9ucy4KClRoaXMgaXMgaXJyZXZlcnNpYmxlIGFuZCBwcm92aWRlcyBpbW11dGFiaWxpdHkgZ3VhcmFudGVlcyB0byB1c2Vycy4KRW1pdHMgYFR0bENvbmZpZ3NGcm96ZW5gIGV2ZW50LgoKIyBQYW5pY3MKLSBgVHRsQ29uZmlnQWxyZWFkeUZyb3plbmAgaWYgYWxyZWFkeSBmcm96ZW4AAAAAAAASZnJlZXplX3R0bF9jb25maWdzAAAAAAAAAAAAAA==",
        "AAAAAAAAACdSZXR1cm5zIHdoZXRoZXIgVFRMIGNvbmZpZ3MgYXJlIGZyb3plbi4AAAAAFWlzX3R0bF9jb25maWdzX2Zyb3plbgAAAAAAAAAAAAABAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAAClBhY2tldFNlbnQAAAAAAAEAAAALcGFja2V0X3NlbnQAAAAAAwAAAAAAAAAOZW5jb2RlZF9wYWNrZXQAAAAAAA4AAAAAAAAAAAAAAAdvcHRpb25zAAAAAA4AAAAAAAAAAAAAAAxzZW5kX2xpYnJhcnkAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADlBhY2tldFZlcmlmaWVkAAAAAAABAAAAD3BhY2tldF92ZXJpZmllZAAAAAADAAAAAAAAAAZvcmlnaW4AAAAAB9AAAAAGT3JpZ2luAAAAAAABAAAAAAAAAAhyZWNlaXZlcgAAABMAAAABAAAAAAAAAAxwYXlsb2FkX2hhc2gAAAPuAAAAIAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAD1BhY2tldERlbGl2ZXJlZAAAAAABAAAAEHBhY2tldF9kZWxpdmVyZWQAAAACAAAAAAAAAAZvcmlnaW4AAAAAB9AAAAAGT3JpZ2luAAAAAAABAAAAAAAAAAhyZWNlaXZlcgAAABMAAAABAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADkx6UmVjZWl2ZUFsZXJ0AAAAAAABAAAAEGx6X3JlY2VpdmVfYWxlcnQAAAAJAAAAAAAAAAhyZWNlaXZlcgAAABMAAAABAAAAAAAAAAhleGVjdXRvcgAAABMAAAABAAAAAAAAAAZvcmlnaW4AAAAAB9AAAAAGT3JpZ2luAAAAAAABAAAAAAAAAARndWlkAAAD7gAAACAAAAABAAAAAAAAAANnYXMAAAAACwAAAAAAAAAAAAAABXZhbHVlAAAAAAAACwAAAAAAAAAAAAAAB21lc3NhZ2UAAAAADgAAAAAAAAAAAAAACmV4dHJhX2RhdGEAAAAAAA4AAAAAAAAAAAAAAAZyZWFzb24AAAAAAA4AAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAABlpyb1NldAAAAAAAAQAAAAd6cm9fc2V0AAAAAAEAAAAAAAAAA3pybwAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC0RlbGVnYXRlU2V0AAAAAAEAAAAMZGVsZWdhdGVfc2V0AAAAAgAAAAAAAAAEb2FwcAAAABMAAAABAAAAAAAAAAhkZWxlZ2F0ZQAAA+gAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAE0luYm91bmROb25jZVNraXBwZWQAAAAAAQAAABVpbmJvdW5kX25vbmNlX3NraXBwZWQAAAAAAAAEAAAAAAAAAAdzcmNfZWlkAAAAAAQAAAABAAAAAAAAAAZzZW5kZXIAAAAAA+4AAAAgAAAAAQAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAQAAAAAAAAAFbm9uY2UAAAAAAAAGAAAAAQAAAAI=",
        "AAAABQAAAAAAAAAAAAAADlBhY2tldE5pbGlmaWVkAAAAAAABAAAAD3BhY2tldF9uaWxpZmllZAAAAAAFAAAAAAAAAAdzcmNfZWlkAAAAAAQAAAABAAAAAAAAAAZzZW5kZXIAAAAAA+4AAAAgAAAAAQAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAQAAAAAAAAAFbm9uY2UAAAAAAAAGAAAAAQAAAAAAAAAMcGF5bG9hZF9oYXNoAAAD6AAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC1BhY2tldEJ1cm50AAAAAAEAAAAMcGFja2V0X2J1cm50AAAABQAAAAAAAAAHc3JjX2VpZAAAAAAEAAAAAQAAAAAAAAAGc2VuZGVyAAAAAAPuAAAAIAAAAAEAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAEAAAAAAAAABW5vbmNlAAAAAAAABgAAAAEAAAAAAAAADHBheWxvYWRfaGFzaAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEUxpYnJhcnlSZWdpc3RlcmVkAAAAAAAAAQAAABJsaWJyYXJ5X3JlZ2lzdGVyZWQAAAAAAAEAAAAAAAAAB25ld19saWIAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAFURlZmF1bHRTZW5kTGlicmFyeVNldAAAAAAAAAEAAAAYZGVmYXVsdF9zZW5kX2xpYnJhcnlfc2V0AAAAAgAAAAAAAAAHZHN0X2VpZAAAAAAEAAAAAQAAAAAAAAAHbmV3X2xpYgAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAGERlZmF1bHRSZWNlaXZlTGlicmFyeVNldAAAAAEAAAAbZGVmYXVsdF9yZWNlaXZlX2xpYnJhcnlfc2V0AAAAAAIAAAAAAAAAB3NyY19laWQAAAAABAAAAAEAAAAAAAAAB25ld19saWIAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAG0RlZmF1bHRSZWNlaXZlTGliVGltZW91dFNldAAAAAABAAAAH2RlZmF1bHRfcmVjZWl2ZV9saWJfdGltZW91dF9zZXQAAAAAAgAAAAAAAAAHc3JjX2VpZAAAAAAEAAAAAQAAAAAAAAAHdGltZW91dAAAAAPoAAAH0AAAAAdUaW1lb3V0AAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADlNlbmRMaWJyYXJ5U2V0AAAAAAABAAAAEHNlbmRfbGlicmFyeV9zZXQAAAADAAAAAAAAAAZzZW5kZXIAAAAAABMAAAABAAAAAAAAAAdkc3RfZWlkAAAAAAQAAAABAAAAAAAAAAduZXdfbGliAAAAA+gAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEVJlY2VpdmVMaWJyYXJ5U2V0AAAAAAAAAQAAABNyZWNlaXZlX2xpYnJhcnlfc2V0AAAAAAMAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAEAAAAAAAAAB3NyY19laWQAAAAABAAAAAEAAAAAAAAAB25ld19saWIAAAAD6AAAABMAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAGFJlY2VpdmVMaWJyYXJ5VGltZW91dFNldAAAAAEAAAAbcmVjZWl2ZV9saWJyYXJ5X3RpbWVvdXRfc2V0AAAAAAMAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAEAAAAAAAAAA2VpZAAAAAAEAAAAAQAAAAAAAAAHdGltZW91dAAAAAPoAAAH0AAAAAdUaW1lb3V0AAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAC0NvbXBvc2VTZW50AAAAAAEAAAAMY29tcG9zZV9zZW50AAAABQAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAAAAAAABGd1aWQAAAPuAAAAIAAAAAEAAAAAAAAABWluZGV4AAAAAAAABAAAAAEAAAAAAAAAB21lc3NhZ2UAAAAADgAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEENvbXBvc2VEZWxpdmVyZWQAAAABAAAAEWNvbXBvc2VfZGVsaXZlcmVkAAAAAAAABAAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAAAAAAABGd1aWQAAAPuAAAAIAAAAAEAAAAAAAAABWluZGV4AAAAAAAABAAAAAEAAAAC",
        "AAAABQAAAAAAAAAAAAAADkx6Q29tcG9zZUFsZXJ0AAAAAAABAAAAEGx6X2NvbXBvc2VfYWxlcnQAAAAKAAAAAAAAAARmcm9tAAAAEwAAAAEAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAAAAAAIZXhlY3V0b3IAAAATAAAAAQAAAAAAAAAEZ3VpZAAAA+4AAAAgAAAAAQAAAAAAAAAFaW5kZXgAAAAAAAAEAAAAAQAAAAAAAAADZ2FzAAAAAAsAAAAAAAAAAAAAAAV2YWx1ZQAAAAAAAAsAAAAAAAAAAAAAAAdtZXNzYWdlAAAAAA4AAAAAAAAAAAAAAApleHRyYV9kYXRhAAAAAAAOAAAAAAAAAAAAAAAGcmVhc29uAAAAAAAOAAAAAAAAAAI=",
        "AAAABAAAAAAAAAAAAAAADUVuZHBvaW50RXJyb3IAAAAAAAAZAAAAL0xpYnJhcnkgaXMgYWxyZWFkeSByZWdpc3RlcmVkIHdpdGggdGhlIGVuZHBvaW50AAAAABFBbHJlYWR5UmVnaXN0ZXJlZAAAAAAAAAEAAAA2Q29tcG9zZSBtZXNzYWdlIGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIEdVSUQgYW5kIGluZGV4AAAAAAANQ29tcG9zZUV4aXN0cwAAAAAAAAIAAAA2Q29tcG9zZSBtZXNzYWdlIG5vdCBmb3VuZCBmb3IgdGhlIGdpdmVuIEdVSUQgYW5kIGluZGV4AAAAAAAPQ29tcG9zZU5vdEZvdW5kAAAAAAMAAAA6RGVmYXVsdCByZWNlaXZlIGxpYnJhcnkgaXMgbm90IHNldCBmb3IgdGhlIHNvdXJjZSBlbmRwb2ludAAAAAAAHERlZmF1bHRSZWNlaXZlTGliVW5hdmFpbGFibGUAAAAEAAAAPERlZmF1bHQgc2VuZCBsaWJyYXJ5IGlzIG5vdCBzZXQgZm9yIHRoZSBkZXN0aW5hdGlvbiBlbmRwb2ludAAAABlEZWZhdWx0U2VuZExpYlVuYXZhaWxhYmxlAAAAAAAABQAAAC9TdXBwbGllZCBuYXRpdmUgdG9rZW4gZmVlIGlzIGxlc3MgdGhhbiByZXF1aXJlZAAAAAAVSW5zdWZmaWNpZW50TmF0aXZlRmVlAAAAAAAABgAAACxTdXBwbGllZCBaUk8gdG9rZW4gZmVlIGlzIGxlc3MgdGhhbiByZXF1aXJlZAAAABJJbnN1ZmZpY2llbnRacm9GZWUAAAAAAAcAAAArVGltZW91dCBleHBpcnkgaXMgaW52YWxpZCAoYWxyZWFkeSBleHBpcmVkKQAAAAANSW52YWxpZEV4cGlyeQAAAAAAAAgAAAAcQW1vdW50IGlzIGludmFsaWQgKG5lZ2F0aXZlKQAAAA1JbnZhbGlkQW1vdW50AAAAAAAACQAAACtDb21wb3NlIGluZGV4IGV4Y2VlZHMgbWF4aW11bSBhbGxvd2VkIHZhbHVlAAAAAAxJbnZhbGlkSW5kZXgAAAAKAAAALE5vbmNlIGlzIGludmFsaWQgZm9yIHRoZSByZXF1ZXN0ZWQgb3BlcmF0aW9uAAAADEludmFsaWROb25jZQAAAAsAAAAwUGF5bG9hZCBoYXNoIGlzIGludmFsaWQgKGVtcHR5IGhhc2ggbm90IGFsbG93ZWQpAAAAEkludmFsaWRQYXlsb2FkSGFzaAAAAAAADAAAAEFSZWNlaXZlIGxpYnJhcnkgaXMgbm90IHZhbGlkIGZvciB0aGUgcmVjZWl2ZXIgYW5kIHNvdXJjZSBlbmRwb2ludAAAAAAAABVJbnZhbGlkUmVjZWl2ZUxpYnJhcnkAAAAAAAANAAAAMU9wZXJhdGlvbiByZXF1aXJlcyBhIG5vbi1kZWZhdWx0IChjdXN0b20pIGxpYnJhcnkAAAAAAAART25seU5vbkRlZmF1bHRMaWIAAAAAAAAOAAAAJ0xpYnJhcnkgbXVzdCBzdXBwb3J0IHJlY2VpdmluZyBtZXNzYWdlcwAAAAAOT25seVJlY2VpdmVMaWIAAAAAAA8AAAAsTGlicmFyeSBtdXN0IGJlIHJlZ2lzdGVyZWQgd2l0aCB0aGUgZW5kcG9pbnQAAAART25seVJlZ2lzdGVyZWRMaWIAAAAAAAAQAAAAJUxpYnJhcnkgbXVzdCBzdXBwb3J0IHNlbmRpbmcgbWVzc2FnZXMAAAAAAAALT25seVNlbmRMaWIAAAAAEQAAADlNZXNzYWdpbmcgcGF0aCBjYW5ub3QgYmUgaW5pdGlhbGl6ZWQgZm9yIHRoZSBnaXZlbiBvcmlnaW4AAAAAAAAUUGF0aE5vdEluaXRpYWxpemFibGUAAAASAAAAL01lc3NhZ2UgY2Fubm90IGJlIHZlcmlmaWVkIGZvciB0aGUgZ2l2ZW4gb3JpZ2luAAAAABFQYXRoTm90VmVyaWZpYWJsZQAAAAAAABMAAAArUGF5bG9hZCBoYXNoIGRvZXMgbm90IG1hdGNoIHRoZSBzdG9yZWQgaGFzaAAAAAATUGF5bG9hZEhhc2hOb3RGb3VuZAAAAAAUAAAAJ05ldyB2YWx1ZSBpcyB0aGUgc2FtZSBhcyBleGlzdGluZyB2YWx1ZQAAAAAJU2FtZVZhbHVlAAAAAAAAFQAAAC9DYWxsZXIgaXMgbm90IGF1dGhvcml6ZWQgKG5vdCBPQXBwIG9yIGRlbGVnYXRlKQAAAAAMVW5hdXRob3JpemVkAAAAFgAAACtFbmRwb2ludCBJRCBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoZSBsaWJyYXJ5AAAAAA5VbnN1cHBvcnRlZEVpZAAAAAAAFwAAADlaUk8gZmVlIG11c3QgYmUgZ3JlYXRlciB0aGFuIHplcm8gd2hlbiBwYXlfaW5fenJvIGlzIHRydWUAAAAAAAAKWmVyb1pyb0ZlZQAAAAAAGAAAABxaUk8gdG9rZW4gYWRkcmVzcyBpcyBub3Qgc2V0AAAADlpyb1VuYXZhaWxhYmxlAAAAAAAZ",
        "AAAAAQAAAC1QYXJhbWV0ZXJzIGZvciBzZW5kaW5nIGEgY3Jvc3MtY2hhaW4gbWVzc2FnZS4AAAAAAAAAAAAAD01lc3NhZ2luZ1BhcmFtcwAAAAAFAAAAK0Rlc3RpbmF0aW9uIGVuZHBvaW50IElEIChjaGFpbiBpZGVudGlmaWVyKS4AAAAAB2RzdF9laWQAAAAABAAAABxUaGUgbWVzc2FnZSBwYXlsb2FkIHRvIHNlbmQuAAAAB21lc3NhZ2UAAAAADgAAACFFbmNvZGVkIGV4ZWN1dG9yIGFuZCBEVk4gb3B0aW9ucy4AAAAAAAAHb3B0aW9ucwAAAAAOAAAAOVdoZXRoZXIgdG8gcGF5IGZlZXMgaW4gWlJPIHRva2VuIGluc3RlYWQgb2YgbmF0aXZlIHRva2VuLgAAAAAAAApwYXlfaW5fenJvAAAAAAABAAAANVJlY2VpdmVyIGFkZHJlc3Mgb24gdGhlIGRlc3RpbmF0aW9uIGNoYWluICgzMiBieXRlcykuAAAAAAAACHJlY2VpdmVyAAAD7gAAACA=",
        "AAAAAQAAAE1Tb3VyY2UgbWVzc2FnZSBpbmZvcm1hdGlvbiBpZGVudGlmeWluZyB3aGVyZSBhIGNyb3NzLWNoYWluIG1lc3NhZ2UgY2FtZSBmcm9tLgAAAAAAAAAAAAAGT3JpZ2luAAAAAAADAAAAF05vbmNlIGZvciB0aGlzIHBhdGh3YXkuAAAAAAVub25jZQAAAAAAAAYAAAAuU2VuZGVyIGFkZHJlc3Mgb24gdGhlIHNvdXJjZSBjaGFpbiAoMzIgYnl0ZXMpLgAAAAAABnNlbmRlcgAAAAAD7gAAACAAAAAmU291cmNlIGVuZHBvaW50IElEIChjaGFpbiBpZGVudGlmaWVyKS4AAAAAAAdzcmNfZWlkAAAAAAQ=",
        "AAAAAQAAAChGZWUgc3RydWN0dXJlIGZvciBjcm9zcy1jaGFpbiBtZXNzYWdpbmcuAAAAAAAAAAxNZXNzYWdpbmdGZWUAAAACAAAAH0ZlZSBwYWlkIGluIG5hdGl2ZSB0b2tlbiAoWExNKS4AAAAACm5hdGl2ZV9mZWUAAAAAAAsAAAAoRmVlIHBhaWQgaW4gWlJPIHRva2VuIChMYXllclplcm8gdG9rZW4pLgAAAAd6cm9fZmVlAAAAAAs=",
        "AAAAAQAAAEJSZWNlaXB0IHJldHVybmVkIGFmdGVyIHN1Y2Nlc3NmdWxseSBzZW5kaW5nIGEgY3Jvc3MtY2hhaW4gbWVzc2FnZS4AAAAAAAAAAAAQTWVzc2FnaW5nUmVjZWlwdAAAAAMAAAApVGhlIGZlZXMgY2hhcmdlZCBmb3Igc2VuZGluZyB0aGUgbWVzc2FnZS4AAAAAAAADZmVlAAAAB9AAAAAMTWVzc2FnaW5nRmVlAAAAK0dsb2JhbGx5IHVuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgbWVzc2FnZS4AAAAABGd1aWQAAAPuAAAAIAAAACRUaGUgb3V0Ym91bmQgbm9uY2UgZm9yIHRoaXMgcGF0aHdheS4AAAAFbm9uY2UAAAAAAAAG",
        "AAAAAgAAADhUeXBlIG9mIG1lc3NhZ2UgbGlicmFyeSBpbmRpY2F0aW5nIHN1cHBvcnRlZCBvcGVyYXRpb25zLgAAAAAAAAAOTWVzc2FnZUxpYlR5cGUAAAAAAAMAAAAAAAAAH1N1cHBvcnRzIG9ubHkgc2VuZGluZyBtZXNzYWdlcy4AAAAABFNlbmQAAAAAAAAAIVN1cHBvcnRzIG9ubHkgcmVjZWl2aW5nIG1lc3NhZ2VzLgAAAAAAAAdSZWNlaXZlAAAAAAAAAAAtU3VwcG9ydHMgYm90aCBzZW5kaW5nIGFuZCByZWNlaXZpbmcgbWVzc2FnZXMuAAAAAAAADlNlbmRBbmRSZWNlaXZlAAA=",
        "AAAAAQAAALdWZXJzaW9uIGluZm9ybWF0aW9uIGZvciBhIG1lc3NhZ2UgbGlicmFyeS4KCk5vdGU6IGBtaW5vcmAgYW5kIGBlbmRwb2ludF92ZXJzaW9uYCB1c2UgYHUzMmAgaW5zdGVhZCBvZiBgdThgIGJlY2F1c2UgU3RlbGxhciBkb2VzIG5vdApzdXBwb3J0IGB1OGAgdHlwZXMgaW4gY29udHJhY3QgaW50ZXJmYWNlIGZ1bmN0aW9ucy4AAAAAAAAAABFNZXNzYWdlTGliVmVyc2lvbgAAAAAAAAMAAAAzRW5kcG9pbnQgdmVyc2lvbiAoc2hvdWxkIG5vdCBleGNlZWQgdTg6Ok1BWCA9IDI1NSkuAAAAABBlbmRwb2ludF92ZXJzaW9uAAAABAAAABVNYWpvciB2ZXJzaW9uIG51bWJlci4AAAAAAAAFbWFqb3IAAAAAAAAGAAAAN01pbm9yIHZlcnNpb24gbnVtYmVyIChzaG91bGQgbm90IGV4Y2VlZCB1ODo6TUFYID0gMjU1KS4AAAAABW1pbm9yAAAAAAAABA==",
        "AAAAAQAAADZUaW1lb3V0IGNvbmZpZ3VyYXRpb24gZm9yIHJlY2VpdmUgbGlicmFyeSB0cmFuc2l0aW9ucy4AAAAAAAAAAAAHVGltZW91dAAAAAACAAAAM1VuaXggdGltZXN0YW1wIGluIHNlY29uZHMgd2hlbiB0aGUgdGltZW91dCBleHBpcmVzLgAAAAAGZXhwaXJ5AAAAAAAGAAAAQ1RoZSBvbGQgbGlicmFyeSBhZGRyZXNzIHRoYXQgcmVtYWlucyB2YWxpZCBkdXJpbmcgdGhlIGdyYWNlIHBlcmlvZC4AAAAAA2xpYgAAAAAT",
        "AAAAAQAAADVQYXJhbWV0ZXJzIGZvciBzZXR0aW5nIG1lc3NhZ2UgbGlicmFyeSBjb25maWd1cmF0aW9uLgAAAAAAAAAAAAAOU2V0Q29uZmlnUGFyYW0AAAAAAAMAAAAfWERSLWVuY29kZWQgY29uZmlndXJhdGlvbiBkYXRhLgAAAAAGY29uZmlnAAAAAAAOAAAAMFRoZSB0eXBlIG9mIGNvbmZpZ3VyYXRpb24gKGUuZy4sIGV4ZWN1dG9yLCBVTE4pLgAAAAtjb25maWdfdHlwZQAAAAAEAAAAJ1RoZSBlbmRwb2ludCBJRCB0aGlzIGNvbmZpZyBhcHBsaWVzIHRvLgAAAAADZWlkAAAAAAQ=",
        "AAAAAQAAADFSZXNvbHZlZCBsaWJyYXJ5IGluZm9ybWF0aW9uIHdpdGggZGVmYXVsdCBzdGF0dXMuAAAAAAAAAAAAAA9SZXNvbHZlZExpYnJhcnkAAAAAAgAAAERXaGV0aGVyIHRoaXMgaXMgdGhlIGRlZmF1bHQgbGlicmFyeSAodHJ1ZSkgb3IgT0FwcC1zcGVjaWZpYyAoZmFsc2UpLgAAAAppc19kZWZhdWx0AAAAAAABAAAAHVRoZSByZXNvbHZlZCBsaWJyYXJ5IGFkZHJlc3MuAAAAAAAAA2xpYgAAAAAT",
        "AAAAAQAAAEhPdXRib3VuZCBwYWNrZXQgY29udGFpbmluZyBhbGwgaW5mb3JtYXRpb24gZm9yIGNyb3NzLWNoYWluIHRyYW5zbWlzc2lvbi4AAAAAAAAADk91dGJvdW5kUGFja2V0AAAAAAAHAAAAGERlc3RpbmF0aW9uIGVuZHBvaW50IElELgAAAAdkc3RfZWlkAAAAAAQAAAAsR2xvYmFsbHkgdW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoaXMgbWVzc2FnZS4AAAAEZ3VpZAAAA+4AAAAgAAAAFFRoZSBtZXNzYWdlIHBheWxvYWQuAAAAB21lc3NhZ2UAAAAADgAAACBPdXRib3VuZCBub25jZSBmb3IgdGhpcyBwYXRod2F5LgAAAAVub25jZQAAAAAAAAYAAAAxUmVjZWl2ZXIgYWRkcmVzcyBvbiBkZXN0aW5hdGlvbiBjaGFpbiAoMzIgYnl0ZXMpLgAAAAAAAAhyZWNlaXZlcgAAA+4AAAAgAAAAH1NlbmRlciBhZGRyZXNzIG9uIHNvdXJjZSBjaGFpbi4AAAAABnNlbmRlcgAAAAAAEwAAABNTb3VyY2UgZW5kcG9pbnQgSUQuAAAAAAdzcmNfZWlkAAAAAAQ=",
        "AAAAAQAAACtBIGZlZSByZWNpcGllbnQgd2l0aCB0aGUgYW1vdW50IHRvIGJlIHBhaWQuAAAAAAAAAAAMRmVlUmVjaXBpZW50AAAAAgAAABVBbW91bnQgb2YgZmVlIHRvIHBheS4AAAAAAAAGYW1vdW50AAAAAAALAAAAH1RoZSBhZGRyZXNzIHRvIHNlbmQgdGhlIGZlZSB0by4AAAAAAnRvAAAAAAAT",
        "AAAAAQAAADxSZXN1bHQgb2Ygc2VuZCBvcGVyYXRpb24gY29udGFpbmluZyBmZWVzIGFuZCBlbmNvZGVkIHBhY2tldC4AAAAAAAAADUZlZXNBbmRQYWNrZXQAAAAAAAADAAAAKlRoZSBlbmNvZGVkIHBhY2tldCByZWFkeSBmb3IgdHJhbnNtaXNzaW9uLgAAAAAADmVuY29kZWRfcGFja2V0AAAAAAAOAAAAP0xpc3Qgb2YgbmF0aXZlIHRva2VuIGZlZSByZWNpcGllbnRzIChleGVjdXRvciwgRFZOcywgdHJlYXN1cnkpLgAAAAAVbmF0aXZlX2ZlZV9yZWNpcGllbnRzAAAAAAAD6gAAB9AAAAAMRmVlUmVjaXBpZW50AAAALExpc3Qgb2YgWlJPIHRva2VuIGZlZSByZWNpcGllbnRzICh0cmVhc3VyeSkuAAAAEnpyb19mZWVfcmVjaXBpZW50cwAAAAAD6gAAB9AAAAAMRmVlUmVjaXBpZW50",
        "AAAAAgAAAAAAAAAAAAAAD09BcHBDb3JlU3RvcmFnZQAAAAACAAAAAAAAAAAAAAAIRW5kcG9pbnQAAAABAAAAAAAAAARQZWVyAAAAAQAAAAQ=",
        "AAAABQAAAAAAAAAAAAAAB1BlZXJTZXQAAAAAAQAAAAhwZWVyX3NldAAAAAIAAAAAAAAAA2VpZAAAAAAEAAAAAAAAAAAAAAAEcGVlcgAAA+gAAAPuAAAAIAAAAAAAAAAC",
        "AAAAAQAAAAAAAAAAAAAAE0VuZm9yY2VkT3B0aW9uUGFyYW0AAAAAAwAAAAAAAAADZWlkAAAAAAQAAAAAAAAACG1zZ190eXBlAAAABAAAAAAAAAAHb3B0aW9ucwAAAAPoAAAADg==",
        "AAAAAgAAAAAAAAAAAAAAF09BcHBPcHRpb25zVHlwZTNTdG9yYWdlAAAAAAEAAAABAAAAAAAAAA9FbmZvcmNlZE9wdGlvbnMAAAAAAgAAAAQAAAAE",
        "AAAABQAAAAAAAAAAAAAAEUVuZm9yY2VkT3B0aW9uU2V0AAAAAAAAAQAAABNlbmZvcmNlZF9vcHRpb25fc2V0AAAAAAEAAAAAAAAAEGVuZm9yY2VkX29wdGlvbnMAAAPqAAAH0AAAABNFbmZvcmNlZE9wdGlvblBhcmFtAAAAAAAAAAAC",
        "AAAAAgAAAqpSZXByZXNlbnRzIGEgZmVlIHBheWVyIGFkZHJlc3Mgd2l0aCBleHBsaWNpdCBhdXRob3JpemF0aW9uIHN0YXRlLgoKVGhpcyBlbnVtIGZvcmNlcyBjYWxsZXJzIG9mIGBfX2x6X3NlbmRgIHRvIGV4cGxpY2l0bHkgZGVjbGFyZSB3aGV0aGVyCmByZXF1aXJlX2F1dGgoKWAgaGFzIGFscmVhZHkgYmVlbiBjYWxsZWQgZm9yIHRoZSBmZWUgcGF5ZXIgYWRkcmVzcy4KVGhpcyBwcmV2ZW50cyB0aGUgY29tbW9uIG1pc3Rha2Ugb2YgZm9yZ2V0dGluZyB0byBhdXRob3JpemUgdGhlIGZlZSBwYXllci4KCiMgVmFyaWFudHMKLSBgVW52ZXJpZmllZGAg4oCUIFNhZmUgZGVmYXVsdC4gYF9fbHpfc2VuZGAgd2lsbCBjYWxsIGByZXF1aXJlX2F1dGgoKWAgb24gdGhlIGFkZHJlc3MuClVzZSB0aGlzIHdoZW4gdGhlIGNhbGxlciBoYXMgKipub3QqKiBhbHJlYWR5IGF1dGhvcml6ZWQgdGhlIGZlZSBwYXllci4KLSBgVmVyaWZpZWRgIOKAlCBDYWxsZXIgYXNzZXJ0cyB0aGF0IGByZXF1aXJlX2F1dGgoKWAgaGFzIGFscmVhZHkgYmVlbiBjYWxsZWQuClVzZSB0aGlzIHRvIGF2b2lkIGEgZHVwbGljYXRlIGByZXF1aXJlX2F1dGgoKWAgbm9kZSBpbiB0aGUgU29yb2JhbiBhdXRoIHRyZWUKKGUuZy4sIHdoZW4gdGhlIHNhbWUgYWRkcmVzcyB3YXMgYWxyZWFkeSBhdXRob3JpemVkIGFzIHRoZSBtZXNzYWdlIHNlbmRlcikuAAAAAAAAAAAACEZlZVBheWVyAAAAAgAAAAEAAACqVGhlIGZlZSBwYXllciBoYXMgKipub3QqKiBiZWVuIGF1dGhvcml6ZWQgeWV0LgpgX19sel9zZW5kYCB3aWxsIGNhbGwgYGZlZV9wYXllci5yZXF1aXJlX2F1dGgoKWAgYmVmb3JlIHRyYW5zZmVycmluZyBmZWVzLgpUaGlzIGlzIHRoZSBzYWZlIGRlZmF1bHQg4oCUIHVzZSB0aGlzIGlmIHVuc3VyZS4AAAAAAApVbnZlcmlmaWVkAAAAAAABAAAAEwAAAAEAAAFvVGhlIGZlZSBwYXllciBoYXMgKiphbHJlYWR5KiogYmVlbiBhdXRob3JpemVkIGJ5IHRoZSBjYWxsZXIgdmlhIGByZXF1aXJlX2F1dGgoKWAuCmBfX2x6X3NlbmRgIHdpbGwgc2tpcCB0aGUgYXV0aCBjaGVjayB0byBhdm9pZCBjcmVhdGluZyBhIGR1cGxpY2F0ZSBhdXRoIG5vZGUKaW4gdGhlIFNvcm9iYW4gYXV0aG9yaXphdGlvbiB0cmVlLgoKIyBTYWZldHkKT25seSB1c2UgdGhpcyB2YXJpYW50IGlmIHlvdSBoYXZlIGFscmVhZHkgY2FsbGVkIGByZXF1aXJlX2F1dGgoKWAgb24gdGhpcyBhZGRyZXNzCmluIHRoZSBjdXJyZW50IGNvbnRyYWN0IGludm9jYXRpb24uIE1pc3VzZSBtYXkgYWxsb3cgdW5hdXRob3JpemVkIGZlZSBkZWR1Y3Rpb25zLgAAAAAIVmVyaWZpZWQAAAABAAAAEw==",
        "AAAABAAAABRPQXBwRXJyb3I6IDIwMDAtMjA5OQAAAAAAAAAJT0FwcEVycm9yAAAAAAAABAAAAAAAAAAOSW52YWxpZE9wdGlvbnMAAAAAB9AAAAAAAAAABk5vUGVlcgAAAAAH0QAAAAAAAAAIT25seVBlZXIAAAfSAAAAAAAAABNacm9Ub2tlblVuYXZhaWxhYmxlAAAAB9M=",
        "AAAABQAAAAAAAAAAAAAAB09GVFNlbnQAAAAAAQAAAAhvZnRfc2VudAAAAAUAAAAAAAAABGd1aWQAAAPuAAAAIAAAAAEAAAAAAAAAB2RzdF9laWQAAAAABAAAAAEAAAAAAAAABGZyb20AAAATAAAAAQAAAAAAAAAOYW1vdW50X3NlbnRfbGQAAAAAAAsAAAAAAAAAAAAAABJhbW91bnRfcmVjZWl2ZWRfbGQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAC09GVFJlY2VpdmVkAAAAAAEAAAAMb2Z0X3JlY2VpdmVkAAAABAAAAAAAAAAEZ3VpZAAAA+4AAAAgAAAAAQAAAAAAAAAHc3JjX2VpZAAAAAAEAAAAAQAAAAAAAAACdG8AAAAAABMAAAABAAAAAAAAABJhbW91bnRfcmVjZWl2ZWRfbGQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD01zZ0luc3BlY3RvclNldAAAAAABAAAAEW1zZ19pbnNwZWN0b3Jfc2V0AAAAAAAAAQAAAAAAAAAJaW5zcGVjdG9yAAAAAAAD6AAAABMAAAAAAAAAAg==",
        "AAAAAgAAAAAAAAAAAAAACk9GVFN0b3JhZ2UAAAAAAAMAAAAAAAAAAAAAAAxEZWNpbWFsc0RpZmYAAAAAAAAAAAAAAAVUb2tlbgAAAAAAAAAAAAAAAAAADE1zZ0luc3BlY3Rvcg==",
        "AAAABAAAABNPRlRFcnJvcjogMzAwMC0zMDk5AAAAAAAAAAAIT0ZURXJyb3IAAAAGAAAAAAAAAA5JbnZhbGlkQWRkcmVzcwAAAAALuAAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAC7kAAAAAAAAAFEludmFsaWRMb2NhbERlY2ltYWxzAAALugAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAC7sAAAAAAAAACE92ZXJmbG93AAALvAAAAAAAAAAQU2xpcHBhZ2VFeGNlZWRlZAAAC70=",
        "AAAAAQAAAC1QYXJhbWV0ZXJzIGZvciBzZW5kaW5nIE9GVCB0b2tlbnMgY3Jvc3MtY2hhaW4AAAAAAAAAAAAACVNlbmRQYXJhbQAAAAAAAAcAAAAkVGhlIGFtb3VudCB0byBzZW5kIGluIGxvY2FsIGRlY2ltYWxzAAAACWFtb3VudF9sZAAAAAAAAAsAAAA4Q29tcG9zZSBtZXNzYWdlIHRvIGV4ZWN1dGUgb24gdGhlIGRlc3RpbmF0aW9uIChPcHRpb25hbCkAAAALY29tcG9zZV9tc2cAAAAADgAAABtUaGUgZGVzdGluYXRpb24gZW5kcG9pbnQgSUQAAAAAB2RzdF9laWQAAAAABAAAADdBZGRpdGlvbmFsIG9wdGlvbnMgZm9yIHRoZSBMYXllclplcm8gbWVzc2FnZSAoT3B0aW9uYWwpAAAAAA1leHRyYV9vcHRpb25zAAAAAAAADgAAAEVUaGUgbWluaW11bSBhbW91bnQgdG8gcmVjZWl2ZSBpbiBsb2NhbCBkZWNpbWFscyAoc2xpcHBhZ2UgcHJvdGVjdGlvbikAAAAAAAANbWluX2Ftb3VudF9sZAAAAAAAAAsAAAAqT0ZUIGNvbW1hbmQgZm9yIGN1c3RvbSBiZWhhdmlvciAoT3B0aW9uYWwpAAAAAAAHb2Z0X2NtZAAAAAAOAAAAOVRoZSByZWNpcGllbnQgYWRkcmVzcyBvbiB0aGUgZGVzdGluYXRpb24gY2hhaW4gKDMyIGJ5dGVzKQAAAAAAAAJ0bwAAAAAD7gAAACA=",
        "AAAAAQAAACJUcmFuc2ZlciBsaW1pdHMgZm9yIE9GVCBvcGVyYXRpb25zAAAAAAAAAAAACE9GVExpbWl0AAAAAgAAACxUaGUgbWF4aW11bSBhbW91bnQgdG8gc2VuZCBpbiBsb2NhbCBkZWNpbWFscwAAAA1tYXhfYW1vdW50X2xkAAAAAAAACwAAACxUaGUgbWluaW11bSBhbW91bnQgdG8gc2VuZCBpbiBsb2NhbCBkZWNpbWFscwAAAA1taW5fYW1vdW50X2xkAAAAAAAACw==",
        "AAAAAQAAAD9SZWNlaXB0IGNvbnRhaW5pbmcgYW1vdW50cyBzZW50IGFuZCByZWNlaXZlZCBpbiBhbiBPRlQgdHJhbnNmZXIAAAAAAAAAAApPRlRSZWNlaXB0AAAAAAACAAAAM1RoZSBhbW91bnQgcmVjZWl2ZWQgaW4gbG9jYWwgZGVjaW1hbHMgb24gdGhlIHJlbW90ZQAAAAASYW1vdW50X3JlY2VpdmVkX2xkAAAAAAALAAAAIVRoZSBhbW91bnQgc2VudCBpbiBsb2NhbCBkZWNpbWFscwAAAAAAAA5hbW91bnRfc2VudF9sZAAAAAAACw==",
        "AAAAAQAAAC5EZXRhaWxzIGFib3V0IGZlZXMgY2hhcmdlZCBpbiBhbiBPRlQgb3BlcmF0aW9uAAAAAAAAAAAADE9GVEZlZURldGFpbAAAAAIAAAAaVGhlIGRlc2NyaXB0aW9uIG9mIHRoZSBmZWUAAAAAAAtkZXNjcmlwdGlvbgAAAAAOAAAAf1RoZSBhbW91bnQgb2YgdGhlIGZlZSBpbiBsb2NhbCBkZWNpbWFscy4gUG9zaXRpdmUgdmFsdWVzIHJlcHJlc2VudCBmZWVzIGNoYXJnZWQsCndoaWxlIG5lZ2F0aXZlIHZhbHVlcyByZXByZXNlbnQgcmV3YXJkcyBnaXZlbi4AAAAADWZlZV9hbW91bnRfbGQAAAAAAAAL",
        "AAAABAAAABxCdWZmZXJSZWFkZXJFcnJvcjogMTAwMC0xMDA5AAAAAAAAABFCdWZmZXJSZWFkZXJFcnJvcgAAAAAAAAIAAAAAAAAADUludmFsaWRMZW5ndGgAAAAAAAPoAAAAAAAAABVJbnZhbGlkQWRkcmVzc1BheWxvYWQAAAAAAAPp",
        "AAAABAAAABxCdWZmZXJXcml0ZXJFcnJvcjogMTAxMC0xMDE5AAAAAAAAABFCdWZmZXJXcml0ZXJFcnJvcgAAAAAAAAEAAAAAAAAAFUludmFsaWRBZGRyZXNzUGF5bG9hZAAAAAAAA/I=",
        "AAAABAAAAB9UdGxDb25maWd1cmFibGVFcnJvcjogMTAyMC0xMDI5AAAAAAAAAAAUVHRsQ29uZmlndXJhYmxlRXJyb3IAAAADAAAAAAAAABBJbnZhbGlkVHRsQ29uZmlnAAAD/AAAAAAAAAAPVHRsQ29uZmlnRnJvemVuAAAAA/0AAAAAAAAAFlR0bENvbmZpZ0FscmVhZHlGcm96ZW4AAAAAA/4=",
        "AAAABAAAABdPd25hYmxlRXJyb3I6IDEwMzAtMTAzOQAAAAAAAAAADE93bmFibGVFcnJvcgAAAAcAAAAAAAAAEUludmFsaWRBdXRob3JpemVyAAAAAAAEBgAAAAAAAAATSW52YWxpZFBlbmRpbmdPd25lcgAAAAQHAAAAAAAAAApJbnZhbGlkVHRsAAAAAAQIAAAAAAAAABFOb1BlbmRpbmdUcmFuc2ZlcgAAAAAABAkAAAAAAAAAD093bmVyQWxyZWFkeVNldAAAAAQKAAAAAAAAAAtPd25lck5vdFNldAAAAAQLAAAAAAAAABJUcmFuc2ZlckluUHJvZ3Jlc3MAAAAABAw=",
        "AAAABAAAABhCeXRlc0V4dEVycm9yOiAxMDQwLTEwNDkAAAAAAAAADUJ5dGVzRXh0RXJyb3IAAAAAAAABAAAAAAAAAA5MZW5ndGhNaXNtYXRjaAAAAAAEEA==",
        "AAAABAAAABtVcGdyYWRlYWJsZUVycm9yOiAxMDUwLTEwNTkAAAAAAAAAABBVcGdyYWRlYWJsZUVycm9yAAAAAgAAAAAAAAAUSW52YWxpZE1pZ3JhdGlvbkRhdGEAAAQaAAAAAAAAABNNaWdyYXRpb25Ob3RBbGxvd2VkAAAABBs=",
        "AAAABAAAABhNdWx0aVNpZ0Vycm9yOiAxMDYwLTEwNjkAAAAAAAAADU11bHRpU2lnRXJyb3IAAAAAAAAJAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAABCQAAAAAAAAAEUludmFsaWRBdXRob3JpemVyAAAAAAAEJQAAAAAAAAANSW52YWxpZFNpZ25lcgAAAAAABCYAAAAAAAAADlNpZ25hdHVyZUVycm9yAAAAAAQnAAAAAAAAABNTaWduZXJBbHJlYWR5RXhpc3RzAAAABCgAAAAAAAAADlNpZ25lck5vdEZvdW5kAAAAAAQpAAAAAAAAAB1Ub3RhbFNpZ25lcnNMZXNzVGhhblRocmVzaG9sZAAAAAAABCoAAAAAAAAAD1Vuc29ydGVkU2lnbmVycwAAAAQrAAAAAAAAAA1aZXJvVGhyZXNob2xkAAAAAAAELA==",
        "AAAABAAAABRBdXRoRXJyb3I6IDEwNzAtMTA3OQAAAAAAAAAJQXV0aEVycm9yAAAAAAAAAQAAAAAAAAASQXV0aG9yaXplck5vdEZvdW5kAAAAAAQu",
        "AAAABAAAABRSYmFjRXJyb3I6IDEwODAtMTA4OQAAAAAAAAAJUmJhY0Vycm9yAAAAAAAABwAAAAAAAAARQWRtaW5Sb2xlTm90Rm91bmQAAAAAAAQ4AAAAAAAAABBJbmRleE91dE9mQm91bmRzAAAEOQAAAAAAAAAQTWF4Um9sZXNFeGNlZWRlZAAABDoAAAAAAAAAC1JvbGVJc0VtcHR5AAAABDsAAAAAAAAADFJvbGVOb3RGb3VuZAAABDwAAAAAAAAAC1JvbGVOb3RIZWxkAAAABD0AAAAAAAAADFVuYXV0aG9yaXplZAAABD4=",
        "AAAABQAAADBFdmVudCBlbWl0dGVkIHdoZW4gYSBzaWduZXIgaXMgYWRkZWQgb3IgcmVtb3ZlZC4AAAAAAAAACVNpZ25lclNldAAAAAAAAAEAAAAKc2lnbmVyX3NldAAAAAAAAgAAAAAAAAAGc2lnbmVyAAAAAAPuAAAAFAAAAAEAAAAAAAAABmFjdGl2ZQAAAAAAAQAAAAAAAAAC",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gdGhlIHNpZ25hdHVyZSB0aHJlc2hvbGQgaXMgY2hhbmdlZC4AAAAAAAAAAAAMVGhyZXNob2xkU2V0AAAAAQAAAA10aHJlc2hvbGRfc2V0AAAAAAAAAQAAAAAAAAAJdGhyZXNob2xkAAAAAAAABAAAAAAAAAAC",
        "AAAAAgAAAAAAAAAAAAAAD011bHRpU2lnU3RvcmFnZQAAAAACAAAAAAAAAAAAAAAHU2lnbmVycwAAAAAAAAAAAAAAAAlUaHJlc2hvbGQAAAA=",
        "AAAABQAAAFdFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHRyYW5zZmVycmVkIChib3RoIHNpbmdsZS1zdGVwIGFuZCB0d28tc3RlcCBjb21wbGV0aW9uKS4AAAAAAAAAABRPd25lcnNoaXBUcmFuc2ZlcnJlZAAAAAEAAAAVb3duZXJzaGlwX3RyYW5zZmVycmVkAAAAAAAAAgAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAg==",
        "AAAABQAAADtFdmVudCBlbWl0dGVkIHdoZW4gYSAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyIGlzIHByb3Bvc2VkLgAAAAAAAAAAFU93bmVyc2hpcFRyYW5zZmVycmluZwAAAAAAAAEAAAAWb3duZXJzaGlwX3RyYW5zZmVycmluZwAAAAAAAwAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAAAAAAN0dGwAAAAABAAAAAAAAAAC",
        "AAAABQAAADxFdmVudCBlbWl0dGVkIHdoZW4gYSAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyIGlzIGNhbmNlbGxlZC4AAAAAAAAAGk93bmVyc2hpcFRyYW5zZmVyQ2FuY2VsbGVkAAAAAAABAAAAHG93bmVyc2hpcF90cmFuc2Zlcl9jYW5jZWxsZWQAAAACAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAAAAAAABdjYW5jZWxsZWRfcGVuZGluZ19vd25lcgAAAAATAAAAAAAAAAI=",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHJlbm91bmNlZC4AAAAAAAAAAAAST3duZXJzaGlwUmVub3VuY2VkAAAAAAABAAAAE293bmVyc2hpcF9yZW5vdW5jZWQAAAAAAQAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAC",
        "AAAAAgAAAAAAAAAAAAAADk93bmFibGVTdG9yYWdlAAAAAAACAAAAAAAAAAAAAAAFT3duZXIAAAAAAAAAAAAAAAAAAAxQZW5kaW5nT3duZXI=",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIGdyYW50ZWQuAAAAAAAAAAAAAAtSb2xlR3JhbnRlZAAAAAABAAAADHJvbGVfZ3JhbnRlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIHJldm9rZWQuAAAAAAAAAAAAAAtSb2xlUmV2b2tlZAAAAAABAAAADHJvbGVfcmV2b2tlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAACtFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGFkbWluIGlzIGNoYW5nZWQuAAAAAAAAAAAQUm9sZUFkbWluQ2hhbmdlZAAAAAEAAAAScm9sZV9hZG1pbl9jaGFuZ2VkAAAAAAADAAAAAAAAAARyb2xlAAAAEQAAAAEAAAAAAAAAE3ByZXZpb3VzX2FkbWluX3JvbGUAAAAD6AAAABEAAAAAAAAAAAAAAA5uZXdfYWRtaW5fcm9sZQAAAAAD6AAAABEAAAAAAAAAAg==",
        "AAAAAgAAAAAAAAAAAAAAC1JiYWNTdG9yYWdlAAAAAAUAAAAAAAAAAAAAAA1FeGlzdGluZ1JvbGVzAAAAAAAAAQAAAAAAAAASUm9sZUluZGV4VG9BY2NvdW50AAAAAAACAAAAEQAAAAQAAAABAAAAAAAAABJSb2xlQWNjb3VudFRvSW5kZXgAAAAAAAIAAAARAAAAEwAAAAEAAAAAAAAAEVJvbGVBY2NvdW50c0NvdW50AAAAAAAAAQAAABEAAAABAAAAAAAAAAlSb2xlQWRtaW4AAAAAAAABAAAAEQ==",
        "AAAAAQAAAElUVEwgY29uZmlndXJhdGlvbjogdGhyZXNob2xkICh3aGVuIHRvIGV4dGVuZCkgYW5kIGV4dGVuZF90byAodGFyZ2V0IFRUTCkuAAAAAAAAAAAAAAlUdGxDb25maWcAAAAAAAACAAAAKFRhcmdldCBUVEwgYWZ0ZXIgZXh0ZW5zaW9uIChpbiBsZWRnZXJzKS4AAAAJZXh0ZW5kX3RvAAAAAAAABAAAADNUVEwgdGhyZXNob2xkIHRoYXQgdHJpZ2dlcnMgZXh0ZW5zaW9uIChpbiBsZWRnZXJzKS4AAAAACXRocmVzaG9sZAAAAAAAAAQ=",
        "AAAABQAAACdFdmVudCBlbWl0dGVkIHdoZW4gVFRMIGNvbmZpZ3MgYXJlIHNldC4AAAAAAAAAAA1UdGxDb25maWdzU2V0AAAAAAAAAQAAAA90dGxfY29uZmlnc19zZXQAAAAAAgAAAAAAAAAIaW5zdGFuY2UAAAPoAAAH0AAAAAlUdGxDb25maWcAAAAAAAAAAAAAAAAAAApwZXJzaXN0ZW50AAAAAAPoAAAH0AAAAAlUdGxDb25maWcAAAAAAAAAAAAAAg==",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gVFRMIGNvbmZpZ3MgYXJlIGZyb3plbi4AAAAAAAAAAAAQVHRsQ29uZmlnc0Zyb3plbgAAAAEAAAASdHRsX2NvbmZpZ3NfZnJvemVuAAAAAAAAAAAAAg==",
        "AAAAAgAAAAAAAAAAAAAAEFR0bENvbmZpZ1N0b3JhZ2UAAAADAAAAAAAAAAAAAAAGRnJvemVuAAAAAAAAAAAAAAAAAAhJbnN0YW5jZQAAAAAAAAAAAAAAClBlcnNpc3RlbnQAAA==",
        "AAAAAgAAAAAAAAAAAAAAElVwZ3JhZGVhYmxlU3RvcmFnZQAAAAAAAQAAAAAAAAAAAAAACU1pZ3JhdGluZwAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    set_rate_limit: this.txFromJSON<null>,
        rate_limit_config: this.txFromJSON<Option<RateLimitConfig>>,
        rate_limit_in_flight: this.txFromJSON<i128>,
        rate_limit_capacity: this.txFromJSON<i128>,
        set_default_fee_bps: this.txFromJSON<null>,
        set_fee_bps: this.txFromJSON<null>,
        set_fee_deposit_address: this.txFromJSON<null>,
        default_fee_bps: this.txFromJSON<Option<u32>>,
        fee_bps: this.txFromJSON<Option<u32>>,
        effective_fee_bps: this.txFromJSON<u32>,
        has_oft_fee: this.txFromJSON<boolean>,
        fee_deposit_address: this.txFromJSON<Option<string>>,
        pause: this.txFromJSON<null>,
        unpause: this.txFromJSON<null>,
        is_paused: this.txFromJSON<boolean>,
        quote_oft: this.txFromJSON<readonly [OFTLimit, Array<OFTFeeDetail>, OFTReceipt]>,
        token: this.txFromJSON<string>,
        oft_version: this.txFromJSON<readonly [u64, u64]>,
        shared_decimals: this.txFromJSON<u32>,
        decimal_conversion_rate: this.txFromJSON<i128>,
        approval_required: this.txFromJSON<boolean>,
        msg_inspector: this.txFromJSON<Option<string>>,
        set_msg_inspector: this.txFromJSON<null>,
        quote_send: this.txFromJSON<MessagingFee>,
        send: this.txFromJSON<readonly [MessagingReceipt, OFTReceipt]>,
        oft_type: this.txFromJSON<OftType>,
        oapp_version: this.txFromJSON<readonly [u64, u64]>,
        endpoint: this.txFromJSON<string>,
        peer: this.txFromJSON<Option<Buffer>>,
        set_peer: this.txFromJSON<null>,
        set_delegate: this.txFromJSON<null>,
        grant_role: this.txFromJSON<null>,
        revoke_role: this.txFromJSON<null>,
        renounce_role: this.txFromJSON<null>,
        set_role_admin: this.txFromJSON<null>,
        remove_role_admin: this.txFromJSON<null>,
        has_role: this.txFromJSON<Option<u32>>,
        get_role_admin: this.txFromJSON<Option<string>>,
        get_role_member_count: this.txFromJSON<u32>,
        get_role_member: this.txFromJSON<string>,
        get_existing_roles: this.txFromJSON<Array<string>>,
        allow_initialize_path: this.txFromJSON<boolean>,
        next_nonce: this.txFromJSON<u64>,
        lz_receive: this.txFromJSON<null>,
        is_compose_msg_sender: this.txFromJSON<boolean>,
        enforced_options: this.txFromJSON<Option<Buffer>>,
        set_enforced_options: this.txFromJSON<null>,
        combine_options: this.txFromJSON<Buffer>,
        upgrade: this.txFromJSON<null>,
        migrate: this.txFromJSON<null>,
        authorizer: this.txFromJSON<Option<string>>,
        owner: this.txFromJSON<Option<string>>,
        pending_owner: this.txFromJSON<Option<string>>,
        transfer_ownership: this.txFromJSON<null>,
        begin_ownership_transfer: this.txFromJSON<null>,
        accept_ownership: this.txFromJSON<null>,
        renounce_ownership: this.txFromJSON<null>,
        extend_instance_ttl: this.txFromJSON<null>,
        set_ttl_configs: this.txFromJSON<null>,
        ttl_configs: this.txFromJSON<readonly [Option<TtlConfig>, Option<TtlConfig>]>,
        freeze_ttl_configs: this.txFromJSON<null>,
        is_ttl_configs_frozen: this.txFromJSON<boolean>
  }
}