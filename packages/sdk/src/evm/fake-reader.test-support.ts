/* Test double for EvmReader: answers readContract by function name. Not shipped. */
import type { EvmReader } from "./reader.js";

export type EvmHandler = (args: readonly unknown[]) => unknown;

export class HandlerEvmReader implements EvmReader {
  readonly calls: string[] = [];
  constructor(
    readonly handlers: Record<string, EvmHandler>,
    private nativeBalance: bigint = 10n ** 18n,
  ) {}

  set(functionName: string, handler: EvmHandler): void {
    this.handlers[functionName] = handler;
  }

  readContract(args: { functionName: string; args?: readonly unknown[] }): Promise<unknown> {
    this.calls.push(args.functionName);
    const handler = this.handlers[args.functionName];
    if (!handler) {
      throw new Error(`fake evm: ${args.functionName} not supported`);
    }
    return Promise.resolve(handler(args.args ?? []));
  }

  getBalance(): Promise<bigint> {
    return Promise.resolve(this.nativeBalance);
  }
}
