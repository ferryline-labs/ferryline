import { parseAbi } from "viem";

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

/** The slice of a viem PublicClient the adapters read through. Tests substitute fakes. */
export interface EvmReader {
  readContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  getBalance(args: { address: `0x${string}` }): Promise<bigint>;
}

export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
