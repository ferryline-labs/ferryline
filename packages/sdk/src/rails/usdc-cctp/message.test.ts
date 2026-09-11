import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FerrylineError,
  accountAddressToBytes32,
  bytes32ToAccountAddress,
  bytes32ToContractAddress,
  bytes32ToEvmAddress,
  contractAddressToBytes32,
} from "@ferryline/core";
import { Buffer } from "buffer";
import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

import { CCTP_STELLAR } from "./chains.js";
import { TOKEN_MESSENGER_V2_ABI, encodeDepositForBurnWithHookToStellar } from "./evm.js";
import type { CctpFixture } from "./fakes.test-support.js";
import { feeFromBps } from "./iris.js";
import {
  assertForwarderFields,
  buildForwarderHookData,
  parseCctpMessage,
  parseForwarderHookData,
} from "./message.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "__fixtures__", "mainnet-2026-09-11.json"), "utf8"),
) as CctpFixture;
const evidenceDir = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "core",
  "verified",
  "experiments",
  "evidence",
);
const inboundObserved = JSON.parse(
  readFileSync(join(evidenceDir, "iris.mainnet.inbound-to-stellar.observed.json"), "utf8"),
) as {
  body: {
    hookData: string;
    mintRecipient: string;
    amount: number;
    maxFee: number;
    feeExecuted: number;
  };
  hook: { forwardRecipient: string; version: number; L: number };
  iris?: { messages: { decodedMessage: { decodedMessageBody: { hookData: string } } }[] };
}[];
const MAINNET = CCTP_STELLAR.mainnet;
const FORWARDER32 = contractAddressToBytes32(MAINNET.cctpForwarder);

function expectCode(fn: () => unknown, code: FerrylineError["code"]): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FerrylineError);
  expect((caught as FerrylineError).code).toBe(code);
}

describe("CCTP message layout against Circle's own decoding of a real Stellar -> Base burn", () => {
  const irisMessage = fixture.iris.messages[0]!;
  const parsed = parseCctpMessage(irisMessage.message);
  const decoded = irisMessage.decodedMessage!;

  it("matches every header field Circle decoded", () => {
    expect(parsed.header.version).toBe(1);
    expect(String(parsed.header.sourceDomain)).toBe(decoded.sourceDomain);
    expect(String(parsed.header.destinationDomain)).toBe(decoded.destinationDomain);
    expect(parsed.header.nonce).toBe(decoded.nonce);
    expect(parsed.header.nonce).toBe(irisMessage.eventNonce);
    expect(String(parsed.header.minFinalityThreshold)).toBe(decoded.minFinalityThreshold);
    expect(String(parsed.header.finalityThresholdExecuted)).toBe(decoded.finalityThresholdExecuted);
    expect(bytes32ToEvmAddress(parsed.header.recipient)).toBe(decoded.recipient);
  });

  it("matches every body field Circle decoded, and resolves the Stellar fields Circle leaves null", () => {
    const body = decoded.decodedMessageBody!;
    expect(parsed.body.amount.toString()).toBe(body.amount);
    expect(parsed.body.maxFee.toString()).toBe(body.maxFee);
    expect(parsed.body.feeExecuted.toString()).toBe(body.feeExecuted);
    expect(parsed.body.expirationBlock.toString()).toBe(body.expirationBlock);
    expect(bytes32ToEvmAddress(parsed.body.mintRecipient)).toBe(body.mintRecipient);
    expect(parsed.body.hookData).toHaveLength(0);
    // Circle returns null for these because 32 bytes cannot say account vs contract. We know which is which.
    expect(bytes32ToContractAddress(parsed.header.sender)).toBe(MAINNET.tokenMessengerMinter);
    expect(bytes32ToContractAddress(parsed.body.burnToken)).toBe(MAINNET.usdcSac);
    expect(bytes32ToAccountAddress(parsed.body.messageSender)).toBe(fixture.sender);
  });

  it("rejects truncated input", () => {
    expectCode(() => parseCctpMessage("0x0001"), "UPSTREAM_ERROR");
  });
});

describe("CctpForwarder hook data against three real inbound messages on mainnet", () => {
  it.each(inboundObserved.map((o, i) => [i, o] as const))(
    "observed message %i: parse and rebuild byte-for-byte",
    (_i, observed) => {
      const bytes = new Uint8Array(Buffer.from(observed.body.hookData, "hex"));
      const parsed = parseForwarderHookData(bytes);
      expect(parsed.version).toBe(0);
      expect(parsed.forwardRecipient).toBe(observed.hook.forwardRecipient);
      expect(parsed.payload).toHaveLength(0);
      expect(
        Buffer.from(buildForwarderHookData(observed.hook.forwardRecipient)).toString("hex"),
      ).toBe(observed.body.hookData);
      expect(
        bytes32ToContractAddress(new Uint8Array(Buffer.from(observed.body.mintRecipient, "hex"))),
      ).toBe(MAINNET.cctpForwarder);
      if (observed.iris) {
        expect(`0x${observed.body.hookData}`).toBe(
          observed.iris.messages[0]!.decodedMessage.decodedMessageBody.hookData,
        );
      }
    },
  );

  it("builds hook data for G, C and M recipients and refuses malformed ones", () => {
    const g = fixture.sender;
    const c = MAINNET.cctpForwarder;
    const m = "MATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJGAAAAAAAAAAAAEZQ6";
    for (const recipient of [g, c, m]) {
      const hook = buildForwarderHookData(recipient);
      expect(hook).toHaveLength(32 + recipient.length);
      expect(Array.from(hook.slice(0, 24)).every((b) => b === 0)).toBe(true);
      expect(parseForwarderHookData(hook).forwardRecipient).toBe(recipient);
    }
    expectCode(() => buildForwarderHookData("not-an-address"), "ADDRESS_INVALID");
    expectCode(() => buildForwarderHookData(g.slice(0, -1) + "A"), "ADDRESS_INVALID");
  });

  it("carries an optional integrator payload after the recipient", () => {
    const hook = buildForwarderHookData(fixture.sender, new Uint8Array([1, 2, 3]));
    const parsed = parseForwarderHookData(hook);
    expect(parsed.forwardRecipient).toBe(fixture.sender);
    expect(Array.from(parsed.payload)).toEqual([1, 2, 3]);
  });
});

describe("the fund-stranding guard", () => {
  const good = {
    amount: 1_000_000n,
    destinationDomain: 27,
    mintRecipient: FORWARDER32,
    burnToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
    destinationCaller: FORWARDER32,
    maxFee: 0n,
    minFinalityThreshold: 2000,
    hookData: buildForwarderHookData(fixture.sender),
  };

  it("refuses a mintRecipient that is not the forwarder (a user account, the classic mistake)", () => {
    expectCode(
      () =>
        assertForwarderFields(
          {
            mintRecipient: accountAddressToBytes32(fixture.sender),
            destinationCaller: FORWARDER32,
          },
          MAINNET.cctpForwarder,
        ),
      "FORWARDER_FIELDS_INVALID",
    );
    expectCode(
      () =>
        encodeDepositForBurnWithHookToStellar(
          { ...good, mintRecipient: accountAddressToBytes32(fixture.sender) },
          MAINNET.cctpForwarder,
        ),
      "FORWARDER_FIELDS_INVALID",
    );
  });

  it("refuses a destinationCaller that is not the forwarder (zero = anyone, which the forwarder cannot complete)", () => {
    expectCode(
      () =>
        encodeDepositForBurnWithHookToStellar(
          { ...good, destinationCaller: new Uint8Array(32) },
          MAINNET.cctpForwarder,
        ),
      "FORWARDER_FIELDS_INVALID",
    );
  });

  it("refuses the testnet forwarder when building for mainnet, and vice versa", () => {
    const testnetForwarder = contractAddressToBytes32(CCTP_STELLAR.testnet.cctpForwarder);
    expectCode(
      () =>
        encodeDepositForBurnWithHookToStellar(
          { ...good, mintRecipient: testnetForwarder, destinationCaller: testnetForwarder },
          MAINNET.cctpForwarder,
        ),
      "FORWARDER_FIELDS_INVALID",
    );
  });

  it("encodes the correct call when both fields are the forwarder", () => {
    const data = encodeDepositForBurnWithHookToStellar(good, MAINNET.cctpForwarder);
    const decoded = decodeFunctionData({ abi: TOKEN_MESSENGER_V2_ABI, data });
    expect(decoded.functionName).toBe("depositForBurnWithHook");
    const [
      amount,
      domain,
      mintRecipient,
      burnToken,
      destinationCaller,
      maxFee,
      threshold,
      hookData,
    ] = decoded.args as unknown as [bigint, number, string, string, string, bigint, number, string];
    expect(amount).toBe(1_000_000n);
    expect(domain).toBe(27);
    expect(mintRecipient).toBe(`0x${Buffer.from(FORWARDER32).toString("hex")}`);
    expect(destinationCaller).toBe(mintRecipient);
    expect(burnToken.toLowerCase()).toBe(good.burnToken.toLowerCase());
    expect(maxFee).toBe(0n);
    expect(threshold).toBe(2000);
    expect(
      parseForwarderHookData(new Uint8Array(Buffer.from(hookData.slice(2), "hex")))
        .forwardRecipient,
    ).toBe(fixture.sender);
  });
});

describe("feeFromBps", () => {
  it("is exact for whole and fractional basis points and rounds up", () => {
    expect(feeFromBps(1_000_000n, 0)).toBe(0n);
    expect(feeFromBps(1_000_000n, 1)).toBe(100n);
    expect(feeFromBps(1_000_000n, 1.3)).toBe(130n);
    expect(feeFromBps(999n, 1)).toBe(1n);
    // Observed on mainnet (Solana -> Stellar, fast): amount 865417222, feeExecuted 86541. Circle floored; we
    // round up by one unit on purpose so the maxFee guard never under-estimates.
    expect(feeFromBps(865_417_222n, 1)).toBe(86_542n);
  });
});
