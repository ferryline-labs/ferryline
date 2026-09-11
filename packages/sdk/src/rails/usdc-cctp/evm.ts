import { encodeFunctionData, parseAbi } from "viem";

import { ERC20_ABI } from "../../evm/reader.js";
import { assertForwarderFields, bytesToHex } from "./message.js";

/**
 * CCTP V2 EVM surface. Parameter names and order follow Circle's Stellar reference code (VERIFIED.md §1.4);
 * Solidity types are the standard TokenMessengerV2 / MessageTransmitterV2 ABI. The four selectors
 * (depositForBurnWithHook, depositForBurn, receiveMessage, usedNonces) were verified present in the
 * proxy implementation bytecode on Base mainnet on 2026-09-11 (VERIFIED.md §3c).
 */
export const TOKEN_MESSENGER_V2_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);

export const MESSAGE_TRANSMITTER_V2_ABI = parseAbi([
  "function usedNonces(bytes32 nonce) view returns (uint256)",
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
  "function localDomain() view returns (uint32)",
]);

export interface DepositForBurnWithHookFields {
  readonly amount: bigint;
  readonly destinationDomain: number;
  readonly mintRecipient: Uint8Array;
  readonly burnToken: `0x${string}`;
  readonly destinationCaller: Uint8Array;
  readonly maxFee: bigint;
  readonly minFinalityThreshold: number;
  readonly hookData: Uint8Array;
}

/**
 * Encode an EVM burn toward Stellar. Refuses (FORWARDER_FIELDS_INVALID) unless mintRecipient and
 * destinationCaller are both the CctpForwarder's contract id, because anything else strands the funds.
 */
export function encodeDepositForBurnWithHookToStellar(
  fields: DepositForBurnWithHookFields,
  forwarderContractId: string,
): `0x${string}` {
  assertForwarderFields(fields, forwarderContractId);
  return encodeFunctionData({
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: "depositForBurnWithHook",
    args: [
      fields.amount,
      fields.destinationDomain,
      bytesToHex(fields.mintRecipient),
      fields.burnToken,
      bytesToHex(fields.destinationCaller),
      fields.maxFee,
      fields.minFinalityThreshold,
      bytesToHex(fields.hookData),
    ],
  });
}

export function encodeErc20Approve(spender: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] });
}
