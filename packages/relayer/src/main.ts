import { createIrisClient, CCTP_STELLAR } from "@ferryline/sdk";

import { createRelayerStellarRpc } from "./chain/stellar-rpc.js";
import { loadRelayerConfig } from "./config.js";
import { createPool, migrate } from "./db/pool.js";
import { buildApp } from "./http/app.js";
import { PostgresApiKeyStore } from "./http/auth.js";
import { PostgresTransferRepository } from "./repo/postgres-transfers.js";
import { envSecretSigner } from "./signer/env-secret-signer.js";
import { loadSpendConfig } from "./spend/config.js";
import { PostgresSpendCeiling } from "./spend/ceiling.js";
import { PostgresRegistrationLimiter } from "./spend/registration-limit.js";
import { PostgresSpendLog } from "./spend/spend-log.js";
import { runStartupReconciliation, startWorkLoop } from "./work/loop.js";

const config = loadRelayerConfig();
const spendConfig = loadSpendConfig();
const cctp = CCTP_STELLAR[config.network];

const pool = createPool({ connectionString: config.databaseUrl });
await migrate(pool);

const repo = new PostgresTransferRepository(pool);
const apiKeys = new PostgresApiKeyStore(pool);
const spendCeiling = new PostgresSpendCeiling(pool, spendConfig.dailySpendCeilingStroops);
const spendLog = new PostgresSpendLog(pool);
const registrationLimiter = new PostgresRegistrationLimiter(pool, {
  maxAttemptsPerWindow: config.registrationLimitMaxAttempts,
  windowMs: config.registrationLimitWindowMs,
});

const signer = envSecretSigner(process.env, cctp.networkPassphrase);
const sponsorAccount = await signer.publicKey();

const rpc = createRelayerStellarRpc(config.rpcUrl);
const iris = createIrisClient(cctp.irisBaseUrl);

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

// Per the phase-3 sign-off: resolve every transfer left `submitting` from a prior run BEFORE
// starting to poll for new work, so a crash-recovered transfer is never racing a fresh poll pass
// for the same row.
console.error("ferryline-relayer: running startup reconciliation...");
const reconciled = await runStartupReconciliation(workLoopOptions);
console.error(
  `ferryline-relayer: reconciliation complete (${String(reconciled.alreadyDelivered)} already ` +
    `delivered, ${String(reconciled.resubmitted)} resubmitted)`,
);

const loopController = new AbortController();
const loopDone = startWorkLoop(workLoopOptions, loopController.signal);
loopDone.catch((error: unknown) => {
  console.error("ferryline-relayer: work loop crashed:", error);
  process.exit(1);
});

const app = buildApp({
  repo,
  apiKeys,
  network: config.network,
  rpc,
  sponsorAccount,
  spendCeiling,
  dailySpendCeilingStroops: spendConfig.dailySpendCeilingStroops,
  registrationLimiter,
  version: config.version,
});

await app.listen({ host: config.host, port: config.port });
console.error(`ferryline-relayer listening on http://${config.host}:${String(config.port)}`);

const shutdown = (): void => {
  console.error("ferryline-relayer: shutting down...");
  loopController.abort();
  (async () => {
    // Wait for every in-flight row-task to actually finish its abort unwind (startWorkLoop's own
    // contract: see loop.ts's doc comment) BEFORE closing the pool — a task still mid-write when
    // the pool closes underneath it would fail that write for a reason unrelated to the transfer.
    await Promise.all([app.close(), loopDone]);
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
