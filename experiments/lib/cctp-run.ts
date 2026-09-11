/**
 * Shared machinery for the two CCTP burn experiments (testnet). Evidence phase is read-only.
 * The live phase needs the operator account to hold testnet USDC; the script says exactly what is
 * missing when it cannot proceed.
 */
import { Address, Asset, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

import { CCTP, ETHEREUM_DOMAIN, STELLAR_DOMAIN, type FeeRow } from "./cctp.js";
import { env, fetchJson, type Report } from "./report.js";
import {
  MAINNET,
  TESTNET,
  balances,
  ensureTrustline,
  invoke,
  operatorKeypair,
  type StellarNet,
} from "./stellar.js";

export const ZERO32 = `0x${"00".repeat(32)}` as const;

export async function feesEvidence(report: Report): Promise<void> {
  report.section(
    "Evidence: Circle's published fee configuration (GET /v2/burn/USDC/fees/{src}/{dst})",
  );
  for (const [label, base] of [
    ["sandbox (testnet)", CCTP.testnet.iris],
    ["production", CCTP.mainnet.iris],
  ] as const) {
    for (const [src, dst] of [
      [STELLAR_DOMAIN, ETHEREUM_DOMAIN],
      [ETHEREUM_DOMAIN, STELLAR_DOMAIN],
    ] as const) {
      const rows = (await fetchJson(
        `${base}/v2/burn/USDC/fees/${String(src)}/${String(dst)}`,
      )) as FeeRow[];
      report.line(
        `- ${label} ${String(src)} -> ${String(dst)}: ${rows.map((r) => `threshold ${String(r.finalityThreshold)} minimumFee ${String(r.minimumFee)}`).join("; ")}`,
      );
    }
  }
  report.line(
    "- Reading: out of Stellar (27 -> x) both thresholds are listed with minimumFee 0. Into Stellar (x -> 27) threshold 1000 carries a fee, 2000 is 0. Listed is not the same as accepted; the live burn below is the test.",
  );
}

export async function minFeeEvidence(report: Report): Promise<void> {
  report.section(
    "Evidence: on-chain TokenMessengerMinter.get_min_fee(USDC) (read-only simulation)",
  );
  const kp = operatorKeypair();
  if (!kp) {
    report.line("- skipped: no operator key to source the simulation");
    return;
  }
  for (const [net, cfg] of [
    [TESTNET, CCTP.testnet],
    [MAINNET, CCTP.mainnet],
  ] as const) {
    if (net.name === "mainnet") {
      // The testnet operator does not exist on mainnet; use the USDC issuer as a read-only source.
      const server = new Server(net.rpcUrl);
      const { TransactionBuilder, BASE_FEE, Contract } = await import("@stellar/stellar-sdk");
      const account = await server.getAccount(cfg.usdcIssuer);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: net.passphrase,
      })
        .addOperation(
          new Contract(cfg.tokenMessengerMinter).call(
            "get_min_fee",
            new Address(cfg.usdcSac).toScVal(),
          ),
        )
        .setTimeout(60)
        .build();
      const sim = await server.simulateTransaction(tx);
      const value =
        "result" in sim && sim.result
          ? (scValToNative(sim.result.retval) as bigint).toString()
          : `error: ${"error" in sim ? sim.error : "?"}`;
      report.line(`- ${net.name}: get_min_fee(USDC) = ${value}`);
    } else {
      const out = await invoke(
        net,
        kp,
        cfg.tokenMessengerMinter,
        "get_min_fee",
        [new Address(cfg.usdcSac).toScVal()],
        false,
      );
      report.line(
        `- ${net.name}: get_min_fee(USDC) = ${out.retval ? (scValToNative(out.retval) as bigint).toString() : `error: ${out.simulationError ?? "?"}`}`,
      );
    }
  }
}

export interface BurnSetup {
  net: StellarNet;
  keypair: ReturnType<typeof operatorKeypair> & object;
  usdcBalance: string;
}

/** Ensures the testnet operator exists and holds a USDC trustline; returns undefined (after logging) if it has no USDC. */
export async function testnetBurnSetup(
  report: Report,
  amountUsdc: string,
): Promise<BurnSetup | undefined> {
  report.section("Live run (testnet)");
  const keypair = operatorKeypair();
  if (!keypair) {
    report.line(
      "- missing: FERRYLINE_STELLAR_SECRET or a stellar-cli identity named ferryline-testnet-operator",
    );
    return undefined;
  }
  const net = TESTNET;
  const asset = new Asset("USDC", CCTP.testnet.usdcIssuer);
  const trustline = await ensureTrustline(net, keypair, asset);
  const bal = await balances(net, keypair.publicKey());
  const usdc =
    bal?.lines.find((l) => l.code === "USDC" && l.issuer === CCTP.testnet.usdcIssuer)?.balance ??
    "0";
  report.line(
    `- operator: ${keypair.publicKey()} | XLM ${bal?.xlm ?? "0"} | USDC trustline ${trustline} | USDC balance ${usdc}`,
  );
  if (Number(usdc) < Number(amountUsdc)) {
    report.line(
      `- BLOCKED: the operator needs at least ${amountUsdc} testnet USDC (issuer ${CCTP.testnet.usdcIssuer}).`,
    );
    report.line(
      "  Fund it via Circle's faucet (faucet.circle.com) if it offers Stellar Testnet, or from any testnet USDC holder, then re-run this script.",
    );
    return undefined;
  }
  return { net, keypair, usdcBalance: usdc };
}

export interface BurnParams {
  amountStroops: bigint;
  maxFee: bigint;
  minFinalityThreshold: number;
  mintRecipient: `0x${string}`;
}

/** approve(TokenMessengerMinter) then deposit_for_burn; submits both only if their simulations succeed. */
export async function burn(
  setup: BurnSetup,
  p: BurnParams,
  report: Report,
): Promise<{ hash?: string; simulationError?: string }> {
  const cfg = CCTP.testnet;
  const latest = await new Server(setup.net.rpcUrl).getLatestLedger();
  const approve = await invoke(
    setup.net,
    setup.keypair,
    cfg.usdcSac,
    "approve",
    [
      new Address(setup.keypair.publicKey()).toScVal(),
      new Address(cfg.tokenMessengerMinter).toScVal(),
      nativeToScVal(p.amountStroops, { type: "i128" }),
      nativeToScVal(latest.sequence + 500, { type: "u32" }),
    ],
    true,
  );
  report.line(
    `- approve(TokenMessengerMinter, ${p.amountStroops.toString()}): simulation ${approve.simulation}${approve.simulationError ? ` (${approve.simulationError})` : ""}${approve.submitted ? ` submitted ${approve.submitted.hash} ${approve.submitted.status}` : ""}`,
  );
  if (approve.simulation !== "ok") {
    return { simulationError: approve.simulationError ?? "approve failed" };
  }
  const args = [
    new Address(setup.keypair.publicKey()).toScVal(),
    nativeToScVal(p.amountStroops, { type: "i128" }),
    nativeToScVal(ETHEREUM_DOMAIN, { type: "u32" }),
    nativeToScVal(Buffer.from(p.mintRecipient.slice(2), "hex"), { type: "bytes" }),
    new Address(cfg.usdcSac).toScVal(),
    nativeToScVal(Buffer.from(ZERO32.slice(2), "hex"), { type: "bytes" }),
    nativeToScVal(p.maxFee, { type: "i128" }),
    nativeToScVal(p.minFinalityThreshold, { type: "u32" }),
  ];
  const out = await invoke(
    setup.net,
    setup.keypair,
    cfg.tokenMessengerMinter,
    "deposit_for_burn",
    args,
    true,
  );
  report.line(
    `- deposit_for_burn(amount ${p.amountStroops.toString()}, domain 0, max_fee ${p.maxFee.toString()}, min_finality_threshold ${String(p.minFinalityThreshold)}): simulation ${out.simulation}${out.simulationError ? ` (${out.simulationError})` : ""}${out.submitted ? ` submitted ${out.submitted.hash} ${out.submitted.status}` : ""}`,
  );
  if (out.diagnostics.length > 0) {
    report.code("simulation diagnostic events (base64 XDR)", out.diagnostics.join("\n"));
  }
  return out.submitted
    ? { hash: out.submitted.hash }
    : { simulationError: out.simulationError ?? "not submitted" };
}

/** Poll Circle Iris (sandbox) for the message/attestation of a Stellar burn and record the raw response. */
export async function irisEvidence(
  hash: string,
  report: Report,
  maxMs = 15 * 60_000,
): Promise<unknown> {
  const url = `${CCTP.testnet.iris}/v2/messages/${String(STELLAR_DOMAIN)}?transactionHash=${hash}`;
  const deadline = Date.now() + maxMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const response = await fetch(url);
    const body: unknown = await response.json().catch(() => undefined);
    last = { httpStatus: response.status, body };
    const text = JSON.stringify(body);
    if (response.ok && text.includes('"status":"complete"')) {
      break;
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }
  report.code(`Iris ${url}`, JSON.stringify(last, null, 1), "json");
  return last;
}

export function mintRecipientFromEnv(): `0x${string}` {
  const configured = env("FERRYLINE_EVM_ADDRESS");
  const address = configured ?? "0x000000000000000000000000000000000000dEaD";
  return `0x${"00".repeat(12)}${address.slice(2).toLowerCase()}`;
}
