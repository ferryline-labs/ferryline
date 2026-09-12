/**
 * One-off, real submission of a real, already-attested CCTP message to Sepolia's real
 * MessageTransmitterV2. Not part of the widget or SDK's own code — CCTP's receiveMessage is
 * permissionless (anyone can pay the gas to submit an already-attested message), and this phase's
 * own real E2E run found that neither Circle's testnet auto-relay, the widget, nor Ferryline's
 * relayer (which only handles the opposite direction) submits it automatically on testnet. This
 * script completes that one specific transfer's delivery manually, using the real message and
 * attestation bytes Circle's own Iris API already returned.
 */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const PRIVATE_KEY = process.env.GAS_ACCOUNT_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  throw new Error("set GAS_ACCOUNT_PRIVATE_KEY to the funded scratch account's real private key");
}

const MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
const SOURCE_TX_HASH = process.argv[2];
if (!SOURCE_TX_HASH) {
  throw new Error("usage: node submit-receive-message.mjs <sourceTxHash>");
}

const abi = parseAbi(["function receiveMessage(bytes message, bytes attestation) returns (bool)"]);

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http() });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http() });

console.log("Gas account:", account.address);

const irisResponse = await fetch(
  `https://iris-api-sandbox.circle.com/v2/messages/27?transactionHash=${SOURCE_TX_HASH}`,
);
const iris = await irisResponse.json();
const real = iris.messages?.[0];
if (!real || real.status !== "complete") {
  throw new Error(`Iris message not complete: ${JSON.stringify(iris)}`);
}
console.log("Real Iris message status:", real.status, "nonce:", real.eventNonce);

const { request } = await publicClient.simulateContract({
  account,
  address: MESSAGE_TRANSMITTER_V2,
  abi,
  functionName: "receiveMessage",
  args: [real.message, real.attestation],
});

console.log("Simulation succeeded. Submitting real transaction...");
const hash = await walletClient.writeContract(request);
console.log("Submitted:", hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("Status:", receipt.status);
console.log("Block:", receipt.blockNumber);
