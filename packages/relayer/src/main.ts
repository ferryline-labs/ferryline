import { cctpEvmChain, createIrisClient, CCTP_STELLAR } from "@ferryline/sdk";
import { defineChain } from "viem";

import { loadAdminConfig } from "./admin-config.js";
import { createRelayerEvmRpc } from "./chain/evm-rpc.js";
import { createRelayerStellarRpc } from "./chain/stellar-rpc.js";
import {
  loadOutboundRelayerConfig,
  loadRelayerConfig,
  outboundEnabled,
  type OutboundRelayerConfig,
} from "./config.js";
import { createPool, migrate } from "./db/pool.js";
import { buildApp, type BuildAppOutboundOptions } from "./http/app.js";
import { PostgresApiKeyStore } from "./http/auth.js";
import { PostgresOutboundTransferRepository } from "./repo/postgres-outbound-transfers.js";
import { PostgresTransferRepository } from "./repo/postgres-transfers.js";
import { envSecretEvmSigner } from "./signer/env-secret-evm-signer.js";
import { envSecretSigner } from "./signer/env-secret-signer.js";
import { loadSpendConfig } from "./spend/config.js";
import { loadOutboundSpendConfig } from "./spend/outbound-config.js";
import { PostgresSpendCeiling } from "./spend/ceiling.js";
import { PostgresOutboundSpendCeiling } from "./spend/outbound-ceiling.js";
import { PostgresRegistrationLimiter } from "./spend/registration-limit.js";
import { PostgresSpendLog } from "./spend/spend-log.js";
import { PostgresOutboundSpendLog } from "./spend/outbound-spend-log.js";
import { runStartupReconciliation, startWorkLoop } from "./work/loop.js";
import {
  runOutboundStartupReconciliation,
  startOutboundWorkLoop,
  type OutboundWorkLoopOptions,
} from "./work/outbound-loop.js";

const config = loadRelayerConfig();
const spendConfig = loadSpendConfig();
const adminConfig = loadAdminConfig();
const cctp = CCTP_STELLAR[config.network];

// Outbound (Stellar -> EVM) is opt-in per deployment (FERRYLINE_OUTBOUND_ENABLED=true) — see
// config.ts's own doc comment for why. Every outbound-specific value (this config, spend/
// outbound-config.ts, and FERRYLINE_OUTBOUND_SPONSOR_SECRET) is loaded and validated here, BEFORE
// the Postgres pool is even created, so a misconfigured outbound deployment fails fast and loud —
// identical "refuse to start, never run partially configured" discipline as every other
// money-related value in this file.
const runOutbound = outboundEnabled();
const outboundConfig: OutboundRelayerConfig | undefined = runOutbound
  ? loadOutboundRelayerConfig()
  : undefined;
const outboundSpendConfig = runOutbound ? loadOutboundSpendConfig() : undefined;
const outboundChain = outboundConfig
  ? cctpEvmChain(config.network, outboundConfig.destinationChain)
  : undefined;
if (runOutbound && !outboundChain) {
  throw new Error(
    `FERRYLINE_OUTBOUND_DESTINATION_CHAIN="${outboundConfig?.destinationChain ?? ""}" is not a ` +
      `CCTP EVM chain @ferryline/sdk recognizes for network "${config.network}". The relayer ` +
      `refuses to start with an outbound destination it cannot resolve a real MessageTransmitterV2 ` +
      `address for.`,
  );
}

const pool = createPool({ connectionString: config.databaseUrl });
await migrate(pool);

const repo = new PostgresTransferRepository(pool);
const apiKeys = new PostgresApiKeyStore(pool);
const spendCeiling = new PostgresSpendCeiling(pool, spendConfig.dailySpendCeilingStroops);
const spendLog = new PostgresSpendLog(pool);
// Shared, unmodified, across both directions — see spend/registration-limit.ts's own doc comment
// for why this blunt per-API-key spam brake is deliberately not direction-specific.
const registrationLimiter = new PostgresRegistrationLimiter(pool, {
  maxAttemptsPerWindow: config.registrationLimitMaxAttempts,
  windowMs: config.registrationLimitWindowMs,
});

const signer = envSecretSigner(process.env, cctp.networkPassphrase);
const sponsorAccount = await signer.publicKey();

const rpc = createRelayerStellarRpc(config.rpcUrl);
const iris = createIrisClient(cctp.irisBaseUrl);

// --- Outbound (Stellar -> EVM) construction, only when enabled ---
const outboundRepo = runOutbound ? new PostgresOutboundTransferRepository(pool) : undefined;
const outboundSpendCeiling =
  runOutbound && outboundSpendConfig
    ? new PostgresOutboundSpendCeiling(pool, outboundSpendConfig.dailyGasCeilingWei)
    : undefined;
const outboundSpendLog = runOutbound ? new PostgresOutboundSpendLog(pool) : undefined;
// envSecretEvmSigner reads FERRYLINE_OUTBOUND_SPONSOR_SECRET directly from process.env and throws
// with a specific, actionable message if it is unset/malformed — the same refusal-to-start
// discipline as envSecretSigner above, extended to the EVM signing key.
const outboundSigner = runOutbound ? envSecretEvmSigner(process.env) : undefined;
const outboundEvmChain =
  runOutbound && outboundChain && outboundConfig
    ? defineChain({
        id: outboundChain.chainId,
        name: outboundConfig.destinationChain,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [outboundConfig.evmRpcUrl] } },
      })
    : undefined;
const outboundRpc =
  runOutbound && outboundEvmChain && outboundSigner
    ? createRelayerEvmRpc({
        chain: outboundEvmChain,
        rpcUrl: outboundConfig!.evmRpcUrl,
        account: outboundSigner.account,
      })
    : undefined;

const workLoopOptions = {
  repo,
  iris,
  rpc,
  signer,
  sponsorAccount,
  networkPassphrase: cctp.networkPassphrase,
  forwarderContractId: cctp.cctpForwarder,
  messageTransmitterContractId: cctp.messageTransmitter,
  maxFeeBumpStroops: spendConfig.maxFeeBumpStroops,
  spendCeiling,
  maxDailySpendCeilingStroops: spendConfig.dailySpendCeilingStroops,
  spendLog,
  maxTransfersPerRecipient: spendConfig.maxTransfersPerRecipient,
  recipientRateLimitWindowMs: spendConfig.recipientRateLimitWindowMs,
  pollIntervalMs: config.pollIntervalMs,
  pollMaxIntervalMs: config.pollMaxIntervalMs,
  maxConcurrentTransfers: config.maxConcurrentTransfers,
};

const outboundWorkLoopOptions: OutboundWorkLoopOptions | undefined =
  runOutbound &&
  outboundRepo &&
  outboundRpc &&
  outboundSigner &&
  outboundConfig &&
  outboundChain &&
  outboundSpendCeiling &&
  outboundSpendLog &&
  outboundSpendConfig
    ? {
        repo: outboundRepo,
        iris,
        rpc: outboundRpc,
        signer: outboundSigner,
        messageTransmitterV2: outboundChain.messageTransmitterV2,
        destinationChain: outboundConfig.destinationChain,
        maxGasCostWei: outboundSpendConfig.maxGasCostWei,
        spendCeiling: outboundSpendCeiling,
        maxDailyGasCeilingWei: outboundSpendConfig.dailyGasCeilingWei,
        spendLog: outboundSpendLog,
        maxTransfersPerRecipient: outboundSpendConfig.maxTransfersPerRecipient,
        recipientRateLimitWindowMs: outboundSpendConfig.recipientRateLimitWindowMs,
        pollIntervalMs: outboundConfig.pollIntervalMs,
        pollMaxIntervalMs: outboundConfig.pollMaxIntervalMs,
        maxConcurrentTransfers: outboundConfig.maxConcurrentTransfers,
      }
    : undefined;

// Per the phase-3 sign-off: resolve every transfer left `submitting` from a prior run BEFORE
// starting to poll for new work, so a crash-recovered transfer is never racing a fresh poll pass
// for the same row. Outbound's own reconciliation runs the same way, independently, only when
// outbound is enabled.
console.error("ferryline-relayer: running startup reconciliation...");
const reconciled = await runStartupReconciliation(workLoopOptions);
console.error(
  `ferryline-relayer: reconciliation complete (${String(reconciled.alreadyDelivered)} already ` +
    `delivered, ${String(reconciled.resubmitted)} resubmitted)`,
);
if (outboundWorkLoopOptions) {
  console.error("ferryline-relayer: running OUTBOUND startup reconciliation...");
  const outboundReconciled = await runOutboundStartupReconciliation(outboundWorkLoopOptions);
  console.error(
    `ferryline-relayer: outbound reconciliation complete ` +
      `(${String(outboundReconciled.alreadyDelivered)} already delivered, ` +
      `${String(outboundReconciled.resubmitted)} resubmitted)`,
  );
}

const loopController = new AbortController();
const loopDone = startWorkLoop(workLoopOptions, loopController.signal);
loopDone.catch((error: unknown) => {
  console.error("ferryline-relayer: work loop crashed:", error);
  process.exit(1);
});

const outboundLoopDone = outboundWorkLoopOptions
  ? startOutboundWorkLoop(outboundWorkLoopOptions, loopController.signal)
  : undefined;
outboundLoopDone?.catch((error: unknown) => {
  console.error("ferryline-relayer: outbound work loop crashed:", error);
  process.exit(1);
});

const outboundAppOptions: BuildAppOutboundOptions | undefined =
  outboundWorkLoopOptions &&
  outboundRepo &&
  outboundRpc &&
  outboundSigner &&
  outboundSpendCeiling &&
  outboundSpendConfig
    ? {
        repo: outboundRepo,
        registrationLimiter,
        healthz: {
          rpc: outboundRpc,
          sponsorAddress: await outboundSigner.address(),
          destinationChain: outboundWorkLoopOptions.destinationChain,
          spendCeiling: outboundSpendCeiling,
          dailyGasCeilingWei: outboundSpendConfig.dailyGasCeilingWei,
        },
      }
    : undefined;

const app = buildApp({
  repo,
  apiKeys,
  adminSecret: adminConfig.adminSecret,
  network: config.network,
  rpc,
  sponsorAccount,
  spendCeiling,
  dailySpendCeilingStroops: spendConfig.dailySpendCeilingStroops,
  registrationLimiter,
  version: config.version,
  corsOrigins: config.corsOrigins,
  ...(outboundAppOptions ? { outbound: outboundAppOptions } : {}),
});

await app.listen({ host: config.host, port: config.port });
console.error(`ferryline-relayer listening on http://${config.host}:${String(config.port)}`);
console.error(
  `ferryline-relayer: outbound direction is ${runOutbound ? "ENABLED" : "disabled"} ` +
    `(FERRYLINE_OUTBOUND_ENABLED)`,
);
console.error(
  config.corsOrigins.length > 0
    ? `ferryline-relayer: CORS allows browser origins: ${config.corsOrigins.join(", ")}`
    : "ferryline-relayer: CORS is fail-closed — no browser origin is allowed (set FERRYLINE_CORS_ORIGINS to change this)",
);

const shutdown = (): void => {
  console.error("ferryline-relayer: shutting down...");
  loopController.abort();
  (async () => {
    // Wait for every in-flight row-task (both directions) to actually finish its abort unwind
    // (startWorkLoop's/startOutboundWorkLoop's own contract) BEFORE closing the pool — a task still
    // mid-write when the pool closes underneath it would fail that write for a reason unrelated to
    // the transfer.
    const pending: Promise<unknown>[] = [app.close(), loopDone];
    if (outboundLoopDone) {
      pending.push(outboundLoopDone);
    }
    await Promise.all(pending);
    await pool.end();
  })().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
