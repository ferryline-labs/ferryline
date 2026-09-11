import { encodeFunctionData, parseAbi } from "viem";

import type { EvmUsdt0Chain } from "./chains.js";

/**
 * LayerZero V2 IOFT surface Ferryline uses, per the USDT0 developer guide (docs.usdt0.to, checked
 * 2026-09-11): `quoteSend(SendParam, bool)`, `quoteOFT(SendParam)`, `send(SendParam, MessagingFee,
 * address refundAddress)` with SendParam = (dstEid, to, amountLD, minAmountLD, extraOptions, composeMsg,
 * oftCmd). Not yet executed against a live EVM chain by this repo; see the phase report.
 */
export const IOFT_ABI = parseAbi([
  "struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }",
  "struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }",
  "struct OFTLimit { uint256 minAmountLD; uint256 maxAmountLD; }",
  "struct OFTFeeDetail { int256 feeAmountLD; string description; }",
  "struct OFTReceipt { uint256 amountSentLD; uint256 amountReceivedLD; }",
  "function quoteSend(SendParam sendParam, bool payInLzToken) view returns (MessagingFee fee)",
  "function quoteOFT(SendParam sendParam) view returns (OFTLimit limit, OFTFeeDetail[] oftFeeDetails, OFTReceipt receipt)",
  "function send(SendParam sendParam, MessagingFee fee, address refundAddress) payable",
  "function approvalRequired() view returns (bool)",
  "function token() view returns (address)",
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

/** The slice of a viem PublicClient the adapter reads through. Tests substitute fakes. */
export interface EvmReader {
  readContract(args: {
    address: `0x${string}`;
    abi: typeof IOFT_ABI | typeof ERC20_ABI;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  getBalance(args: { address: `0x${string}` }): Promise<bigint>;
}

export interface EvmSendParam {
  readonly dstEid: number;
  readonly to: `0x${string}`;
  readonly amountLD: bigint;
  readonly minAmountLD: bigint;
}

const EMPTY = "0x" as const;

function sendParamTuple(p: EvmSendParam): {
  dstEid: number;
  to: `0x${string}`;
  amountLD: bigint;
  minAmountLD: bigint;
  extraOptions: `0x${string}`;
  composeMsg: `0x${string}`;
  oftCmd: `0x${string}`;
} {
  return { ...p, extraOptions: EMPTY, composeMsg: EMPTY, oftCmd: EMPTY };
}

export async function quoteSendOnEvm(
  reader: EvmReader,
  chain: EvmUsdt0Chain,
  param: EvmSendParam,
): Promise<{ nativeFee: bigint; lzTokenFee: bigint }> {
  const fee = (await reader.readContract({
    address: chain.oft,
    abi: IOFT_ABI,
    functionName: "quoteSend",
    args: [sendParamTuple(param), false],
  })) as { nativeFee: bigint; lzTokenFee: bigint };
  return { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee };
}

export async function quoteOftOnEvm(
  reader: EvmReader,
  chain: EvmUsdt0Chain,
  param: EvmSendParam,
): Promise<{ minAmountLD: bigint; maxAmountLD: bigint; amountReceivedLD: bigint }> {
  const [limit, , receipt] = (await reader.readContract({
    address: chain.oft,
    abi: IOFT_ABI,
    functionName: "quoteOFT",
    args: [sendParamTuple(param)],
  })) as [
    { minAmountLD: bigint; maxAmountLD: bigint },
    unknown,
    { amountSentLD: bigint; amountReceivedLD: bigint },
  ];
  return {
    minAmountLD: limit.minAmountLD,
    maxAmountLD: limit.maxAmountLD,
    amountReceivedLD: receipt.amountReceivedLD,
  };
}

export function encodeApprove(spender: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] });
}

export function encodeSend(
  param: EvmSendParam,
  fee: { nativeFee: bigint; lzTokenFee: bigint },
  refundAddress: `0x${string}`,
): `0x${string}` {
  return encodeFunctionData({
    abi: IOFT_ABI,
    functionName: "send",
    args: [
      sendParamTuple(param),
      { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee },
      refundAddress,
    ],
  });
}

export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
