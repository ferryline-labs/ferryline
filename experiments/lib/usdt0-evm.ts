import type { EvmUsdt0Chain } from "@ferryline/sdk";
import { createScanClient, type ScanMessage } from "@ferryline/sdk";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Report } from "./report.js";

/** Minimal IOFT + ERC-20 ABI, see packages/sdk/src/rails/usdt0-layerzero/evm.ts for provenance. */
const ABI = parseAbi([
  "struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }",
  "struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }",
  "function quoteSend(SendParam sendParam, bool payInLzToken) view returns (MessagingFee fee)",
  "function send(SendParam sendParam, MessagingFee fee, address refundAddress) payable",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export interface SendArgs {
  chain: EvmUsdt0Chain;
  rpcUrl: string;
  privateKey: `0x${string}`;
  amountLD: bigint;
  toBytes32: `0x${string}`;
  dstEid: number;
  report: Report;
}

export async function sendUsdt0FromEvm(
  args: SendArgs,
): Promise<{ txHash: `0x${string}`; nativeFee: bigint }> {
  const account = privateKeyToAccount(args.privateKey);
  const transport = http(args.rpcUrl);
  const publicClient = createPublicClient({ transport });
  const wallet = createWalletClient({ account, transport });
  const sendParam = {
    dstEid: args.dstEid,
    to: args.toBytes32,
    amountLD: args.amountLD,
    minAmountLD: args.amountLD,
    extraOptions: "0x" as const,
    composeMsg: "0x" as const,
    oftCmd: "0x" as const,
  };
  if (args.chain.approvalRequired) {
    const allowance = await publicClient.readContract({
      address: args.chain.innerToken,
      abi: ABI,
      functionName: "allowance",
      args: [account.address, args.chain.oft],
    });
    if (allowance < args.amountLD) {
      const approveHash = await wallet.writeContract({
        chain: null,
        address: args.chain.innerToken,
        abi: ABI,
        functionName: "approve",
        args: [args.chain.oft, args.amountLD],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      args.report.line(`- approve tx: ${approveHash}`);
    }
  }
  const fee = await publicClient.readContract({
    address: args.chain.oft,
    abi: ABI,
    functionName: "quoteSend",
    args: [sendParam, false],
  });
  const txHash = await wallet.writeContract({
    chain: null,
    address: args.chain.oft,
    abi: ABI,
    functionName: "send",
    args: [sendParam, { nativeFee: fee.nativeFee, lzTokenFee: 0n }, account.address],
    value: fee.nativeFee,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  args.report.line(
    `- send receipt status: ${receipt.status} in block ${receipt.blockNumber.toString()}`,
  );
  return { txHash, nativeFee: fee.nativeFee };
}

/** Poll LayerZero Scan until a terminal status or the deadline; log every transition. */
export async function pollScan(
  txHash: string,
  maxMs: number,
  report: Report,
  previous?: string,
): Promise<ScanMessage | undefined> {
  const scan = createScanClient();
  const deadline = Date.now() + maxMs;
  let last = previous;
  let message: ScanMessage | undefined;
  while (Date.now() < deadline) {
    const messages = await scan.messagesByTx(txHash);
    message = messages[0];
    const name = message?.status.name;
    if (name !== last) {
      report.line(
        `- ${new Date().toISOString()} Scan: ${name ?? "not indexed yet"} ${message?.status.message ?? ""}`,
      );
      last = name;
    }
    if (
      name === "DELIVERED" ||
      name === "FAILED" ||
      name === "BLOCKED" ||
      name === "PAYLOAD_STORED"
    ) {
      return message;
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return message;
}
