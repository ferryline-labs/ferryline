# Verified upstream facts

Paper trail for every upstream interface Ferryline's money-moving code depends on.
Each entry has a source, the date it was checked, and how. When a fact here changes
upstream, the code that relies on it is wrong until this file and that code are updated together.

**Checked: 2026-09-11.** Methods: (a) fetched and read the pages below; (b) grepped the raw HTML
of Circle's Stellar reference for exact identifier spellings; (c) pulled the deployed contract
interfaces from Stellar mainnet with `stellar contract info interface` (stellar-cli 26.1.0). The
raw interface dumps are committed next to this file in [verified/](verified/).

Sources:

- S1 https://developers.circle.com/cctp/references/stellar
- S2 https://developers.circle.com/cctp/references/stellar-contracts
- S3 https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- S4 https://developers.stellar.org/docs/tokens/usdt0-layerzero
- S5 https://developers.stellar.org/launch/usdt0
- S6 https://docs.layerzero.network/v2/tools/api/oft-examples
- S7 https://docs.usdt0.to/technical-documentation/developer
- M1 Stellar mainnet, contract `CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6` (USDT0 OFT) → [verified/usdt0-oft.mainnet.rs](verified/usdt0-oft.mainnet.rs)
- M2 Stellar mainnet, contract `CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T` (CctpForwarder) → [verified/cctp-forwarder.mainnet.rs](verified/cctp-forwarder.mainnet.rs)
- M3 Stellar mainnet, contract `CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL` (TokenMessengerMinter) → [verified/cctp-token-messenger-minter.mainnet.rs](verified/cctp-token-messenger-minter.mainnet.rs)

---

## 1. CCTP: the two fields that strand funds

### 1.1 The rule (S1, quoted)

> Always use CctpForwarder when routing CCTP USDC to a Stellar address. Set both mintRecipient and
> destinationCaller to the CctpForwarder contract address. If destinationCaller is wrong, the forwarder
> cannot complete the transfer. If mintRecipient is set to a user account or muxed address, USDC is not
> sent to the forwarder. In either case, funds become permanently stuck and cannot be recovered.

### 1.2 Exact field names

| Where | Function | Fields | Type | Source |
|---|---|---|---|---|
| EVM source chain → Stellar | `depositForBurnWithHook` | `mintRecipient`, `destinationCaller`, `hookData` (camelCase) | `bytes32`, `bytes32`, `bytes` (0x hex in the TS example) | S1 reference code, quoted in 1.4 |
| Stellar source chain → elsewhere | `deposit_for_burn_with_hook` | `mint_recipient`, `destination_caller`, `hook_data` (snake_case) | `BytesN<32>`, `BytesN<32>`, `Bytes` | M3 |
| Stellar source chain → elsewhere | `deposit_for_burn` | `mint_recipient`, `destination_caller` | `BytesN<32>`, `BytesN<32>` | M3 |

Stellar-side signatures, verbatim from M3:

```rust
fn deposit_for_burn(
    env: soroban_sdk::Env,
    caller: soroban_sdk::Address,
    amount: i128,
    destination_domain: u32,
    mint_recipient: soroban_sdk::BytesN<32>,
    burn_token: soroban_sdk::Address,
    destination_caller: soroban_sdk::BytesN<32>,
    max_fee: i128,
    min_finality_threshold: u32,
);

fn deposit_for_burn_with_hook(
    env: soroban_sdk::Env,
    caller: soroban_sdk::Address,
    amount: i128,
    destination_domain: u32,
    mint_recipient: soroban_sdk::BytesN<32>,
    burn_token: soroban_sdk::Address,
    destination_caller: soroban_sdk::BytesN<32>,
    max_fee: i128,
    min_finality_threshold: u32,
    hook_data: soroban_sdk::Bytes,
);
```

### 1.3 What goes in those fields for a Stellar recipient

Both `mintRecipient` and `destinationCaller` = the **32-byte contract id of CctpForwarder**, i.e.
`StrKey.decodeContract("C…forwarder")`. The real recipient does **not** go in either field.
It goes in the hook data as its **strkey string, UTF-8 encoded** (G…, C… or M…), so a muxed
recipient is carried in full. Layout (S1, quoted):

| Bytes | Type | Data |
|---|---|---|
| 0-23 | `bytes24` | Magic. Circle-reserved bytes; use all zero bytes |
| 24-27 | `uint32` | Version; set to `0` |
| 28-31 | `uint32` | `L`: length of `forwardRecipient` in bytes |
| `32..(32+L-1)` | `bytes` | `forwardRecipient` as a `strkey` |
| `(32+L)..` | `bytes` | Optional integrator-defined payload; omit if unused |

### 1.4 Circle's reference code (S1, quoted; whitespace re-flowed, identifiers untouched)

```ts
import { StrKey } from "@stellar/stellar-sdk";

function contractStrkeyToBytes32(strkey: string): `0x${string}` {
  if (!StrKey.isValidContract(strkey)) {
    throw new Error(`Invalid contract strkey: ${strkey}`);
  }
  return `0x${Buffer.from(StrKey.decodeContract(strkey)).toString("hex")}`;
}

/**
 * Hook data layout:
 *   bytes 0–23: reserved (zeroed)
 *   bytes 24–27: hook data version (u32 BE, currently 0)
 *   bytes 28–31: forward_recipient byte length (u32 BE)
 *   bytes 32+ : forward_recipient (UTF-8 encoded Stellar strkey)
 */
function buildCctpForwarderHookData(forwardRecipientStrkey: string): `0x${string}` {
  const isValid =
    StrKey.isValidEd25519PublicKey(forwardRecipientStrkey) ||
    StrKey.isValidContract(forwardRecipientStrkey) ||
    StrKey.isValidMed25519PublicKey(forwardRecipientStrkey);
  if (!isValid) {
    throw new Error(`Invalid forward recipient: ${forwardRecipientStrkey} (expected G..., C..., or M... address)`);
  }
  const recipientBytes = Buffer.from(forwardRecipientStrkey, "utf8");
  const hookData = Buffer.alloc(32 + recipientBytes.length);
  hookData.writeUInt32BE(0, 24); // hook version = 0
  hookData.writeUInt32BE(recipientBytes.length, 28); // recipient byte length
  recipientBytes.copy(hookData, 32); // recipient strkey as UTF-8
  return `0x${hookData.toString("hex")}`;
}

interface DepositForBurnWithHookParams {
  amount: bigint;
  destinationDomain: number;
  mintRecipient: `0x${string}`;
  burnToken: `0x${string}`;
  destinationCaller: `0x${string}`;
  maxFee: bigint;
  minFinalityThreshold: number;
  hookData: `0x${string}`;
}

function prepareEvmDepositForBurnWithHookToStellar(
  amount: bigint,
  cctpForwarderStrkey: string,
  burnToken: `0x${string}`,
  maxFee: bigint,
  minFinalityThreshold: number, // "(1000 = fast, 2000 = standard)" per the page's doc comment
  forwardRecipientStrkey: string,
): DepositForBurnWithHookParams {
  const cctpForwarderHex = contractStrkeyToBytes32(cctpForwarderStrkey);
  const hookData = buildCctpForwarderHookData(forwardRecipientStrkey);
  return {
    amount,
    destinationDomain: 27,
    mintRecipient: cctpForwarderHex,
    burnToken,
    destinationCaller: cctpForwarderHex,
    maxFee,
    minFinalityThreshold,
    hookData,
  };
}
```

### 1.5 CctpForwarder (M2, S1)

- Entry point: `mint_and_forward(message: Bytes, attestation: Bytes)`. Takes the raw CCTP message and
  Circle's attestation; there is no recipient argument. The forwarder validates the message, extracts
  `forwardRecipient` from hook data, calls `receive_message` on MessageTransmitter to mint, and transfers
  to the recipient, all in one invocation (S1).
- Event `MintAndForward { forward_recipient: MuxedAddress, token: Address, amount: i128 }` (M2), so the
  forwarder itself delivers to muxed recipients.
- Error codes the relayer must map (M2): `HookDataTooShort = 7300`, `InvalidMintRecipient = 7301`,
  `InvalidRecipient = 7302`, `InvalidMessageFormat = 7303`, `UnsupportedMessageVersion = 7304`,
  `InvalidBurnMessageFormat = 7305`, `UnsupportedBurnMessageVersion = 7306`, `InvalidForwardRecipient = 7307`,
  `InvalidHookVersion = 7313`, `NoTokensMinted = 7314`. Plus `PausableError::EnforcedPause = 1000`.
- Getters for `get_expected_message_version` and `get_expected_burn_msg_version` exist (M2); the SDK
  should read them rather than hard-code versions.

### 1.6 Addresses (S2)

| Contract | Mainnet | Testnet |
|---|---|---|
| TokenMessengerMinter | `CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL` | `CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP` |
| MessageTransmitter | `CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV` | `CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY` |
| CctpForwarder | `CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T` | `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ` |

The USDC token contract address is **not** on S2; it must be resolved on-chain (the TokenMessengerMinter
links it) before the CCTP adapter hard-codes anything.

### 1.7 Chain capabilities (S3, Stellar row quoted)

`Stellar | ✅ | N/A | ❌ | ❌` = Standard Transfer supported, Fast Transfer N/A, Upfront Fees not
supported, Forwarding Service not supported. Domain **27**. Decimals: USDC on Stellar has 7, CCTP messages
carry 6; when Stellar is the source the 7th decimal stays with the user; when Stellar is the destination
the 6-decimal amount is scaled by 10 (S1).

---

## 2. USDT0 OFT on Stellar

### 2.1 Interface (M1, verbatim)

```rust
fn quote_oft(env: Env, from: Address, send_param: SendParam) -> (OFTLimit, Vec<OFTFeeDetail>, OFTReceipt);
fn quote_send(env: Env, from: Address, send_param: SendParam, pay_in_zro: bool) -> MessagingFee;
fn send(env: Env, from: Address, send_param: SendParam, fee: MessagingFee, refund_address: Address) -> (MessagingReceipt, OFTReceipt);
fn shared_decimals(env: Env) -> u32;
fn decimal_conversion_rate(env: Env) -> i128;
fn approval_required(env: Env) -> bool;
fn token(env: Env) -> Address;
fn peer(env: Env, eid: u32) -> Option<BytesN<32>>;
fn is_paused(env: Env) -> bool;
fn has_oft_fee(env: Env, dst_eid: u32) -> bool;
fn effective_fee_bps(env: Env, dst_eid: u32) -> u32;
fn rate_limit_config(env: Env, direction: Direction, eid: u32) -> Option<RateLimitConfig>;
fn rate_limit_capacity(env: Env, direction: Direction, eid: u32) -> i128;

pub struct SendParam {
    pub amount_ld: i128,
    pub compose_msg: Bytes,
    pub dst_eid: u32,
    pub extra_options: Bytes,
    pub min_amount_ld: i128,
    pub oft_cmd: Bytes,
    pub to: BytesN<32>,
}
pub struct MessagingFee { pub native_fee: i128, pub zro_fee: i128 }
pub struct MessagingReceipt { pub fee: MessagingFee, pub guid: BytesN<32>, pub nonce: u64 }
pub struct OFTReceipt { pub amount_received_ld: i128, pub amount_sent_ld: i128 }
pub struct OFTLimit { pub max_amount_ld: i128, pub min_amount_ld: i128 }
pub struct OFTFeeDetail { pub description: Bytes, pub fee_amount_ld: i128 }
pub enum Direction { Inbound, Outbound }
pub struct RateLimitConfig { pub limit: i128, pub mode: Mode, pub window_seconds: u64 }
```

(`_ld` = local decimals, i.e. 7 on Stellar.)

### 2.2 Facts (S4, S5)

- Asset `USDT0:GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q`; SAC
  `CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF`; OFT
  `CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6`; EndpointV2
  `CCQLLRE5JBAWYCW3KTWOIWLMFDUOKROQVZNSALQMGOSXNW3ERUOWTZGK`; Stellar endpoint id `30600`.
- "SAC's `decimals()` returns `7`"; OFT shared decimals are 6 (S4).
- "Send 1.2345678 and 1.234567 moves; the remaining 0.0000008 is floored off as dust and refunded to
  you before the debit." (S5) → encoded as a test in `amount.test.ts`.
- "A trustline has to exist before the first payment lands. Sending USDT0 to an account that has no
  USDT0 trustline fails with op_no_trust." (S5)
- "Minimum transfer amounts are set per contract, so call quoteOFT() for the route you intend to use." (S5)
- S4 does not document the Soroban interface; it points to S7, and S7 has **no Stellar-specific content**
  (EVM `SendParam`/`quoteSend`/`send` only). M1 is the only interface source.

### 2.3 LayerZero OFT Transfer API (S6)

- `GET https://metadata.layerzero-api.com/v1/metadata/experiment/ofts/list` and
  `.../ofts/transfer`; API key in header `x-layerzero-api-key`.
- Chains named on the page: Ethereum, BSC, Arbitrum, Abstract, Base, Optimism, Polygon, Solana.
  **No Stellar, no eid 30600.** Consistent with the spec's landscape table.

---

## 3. Where upstream differs from the spec's API sketch

1. **CCTP recipient is not bytes32.** The spec's SDK bullet "G / C / M address encoding, CCTP hook data" and
   the threat row "Wrong recipient encoding (G/C/M → bytes32, hook data)" assume the recipient is packed
   into 32 bytes. Upstream: the recipient is the UTF-8 strkey inside hook data (1.3), and the only
   bytes32 values are the forwarder's contract id in `mintRecipient`/`destinationCaller`.
2. **A quote needs two calls, not one.** `quote_send` returns only `MessagingFee`. Route limits
   (`OFTLimit`), any OFT bps fee (`has_oft_fee`/`effective_fee_bps`, `OFTFeeDetail`) and the exact
   amounts sent/received (`OFTReceipt`) come from `quote_oft`. The spec only mentions `quote_send`/`send`.
3. **`send` takes a `refund_address`.** Absent from the sketch; it receives dust and fee refunds.
4. **`deposit_for_burn` has `max_fee` and `min_finality_threshold`.** Absent from the sketch. See open
   question 2 below.
5. **Tracking key.** Already fixed in the doc: `track(transferId)`, not `track(hash)`. The rail-native ids
   are `MessagingReceipt.guid` (LayerZero) and the CCTP message nonce/attestation (Circle).
6. **Fee shape.** The sketch's `q.fee.xlm` is `MessagingFee.native_fee` (i128 in stroops) plus the
   Stellar transaction fee, plus possibly an OFT bps fee. Core models this as `Quote.fees: Fee[]`.

---

### 2.4 A real send, decoded (added 2026-09-11, phase 2)

Mainnet transaction `9d130f64b3a4a9316222f8d7e246fe6992225e9438d45ca573e61540f8495f8a` (ledger 64288127), fetched
over RPC and decoded with `stellar xdr decode`; saved at
[verified/experiments/evidence/stellar-tx.mainnet.9d130f64.decoded.json](verified/experiments/evidence/stellar-tx.mainnet.9d130f64.decoded.json):

```
send(
  from            = GBBFBZR6OSK5RPZMOMRIODZH6TKOKEIENFBD54DB66G2UWAJOTSAZS3Z,
  send_param      = { amount_ld: 10000000, min_amount_ld: 10000000, dst_eid: 30109 (Polygon),
                      to: 000000000000000000000000e4b5fcce3cfbc86fdbb9fae472b14eea68fb301f,
                      extra_options: "", compose_msg: "", oft_cmd: "" },
  fee             = { native_fee: 3720767, zro_fee: 0 },
  refund_address  = GBBFBZR6OSK5RPZMOMRIODZH6TKOKEIENFBD54DB66G2UWAJOTSAZS3Z )
memo: none · tx fee: 99857 stroops
```

- **`to` encoding verified.** `to` is 12 zero bytes followed by the 20-byte EVM address. The Polygon receipt for
  the destination transaction `0x35fea5be…` ([evidence/polygon-receipt.0x35fea5be.json](verified/experiments/evidence/polygon-receipt.0x35fea5be.json))
  shows an ERC-20 `Transfer` of `1000000` (1.000000 USDT, 6 decimals) from `0x0` to exactly
  `0xe4b5fcce3cfbc86fdbb9fae472b14eea68fb301f`. `evmAddressToBytes32` in core matches this and is exported.
- **Decimals verified end to end:** 10000000 stroops (7 dec) debited on Stellar, 1000000 (6 dec) minted on Polygon.
- `refund_address` was simply the sender; `extra_options` empty is accepted (enforced options exist on the OFT).
- **LayerZero Scan** (`GET https://scan.layerzero-api.com/v1/messages/tx/{hash}`, no key) indexes Stellar hashes:
  [evidence/layerzero-scan.mainnet.9d130f64.json](verified/experiments/evidence/layerzero-scan.mainnet.9d130f64.json).
  Observed shape: `data[]` of `{ guid, status: { name, message }, pathway: { srcEid, dstEid, sender, receiver, nonce },
  source: { status, tx }, destination: { status, tx }, verification: { dvn } }`. Observed status name: `DELIVERED`
  ("Executor transaction confirmed"). Time from Stellar ledger close to executor confirmation: 1834 s and 1838 s
  for the two recorded sends. The status vocabulary beyond DELIVERED is **not** verified by this repo (the Scan
  docs page could not be fetched); the adapter maps unknown names to "submitted".
- **Volume note:** RPC `getEvents` on the OFT over the last ~100k ledgers (about a week) returned five `oft_sent`
  events and no `oft_received` events.

### 2.5 USDT0 deployments and the absence of a testnet (added 2026-09-11, phase 2)

- docs.usdt0.to/technical-documentation/deployments lists Stellar mainnet only: LZ EID 30600, Token
  `CBSJZEIO…R26YF`, OFT `CBOWOLFS…MMF6`, OneSig `CBCZ5CETG3XR5MZVDC7QBDOTIH6P7MOLUH2SSC52J3NVBYIV45D4QKR6`,
  classic asset `USDT0:GATISXX…HN6Q`. No testnet chain of any kind appears on that page.
- LayerZero's public OFT list (`metadata.layerzero-api.com/v1/metadata/experiment/ofts/list?symbols=USDT0`, no key)
  returns `{}` for `chainNames=stellar-testnet`. Horizon testnet lists 13 unrelated issuers of an asset coded
  "USDT0". **Conclusion: USDT0 cannot be exercised on Stellar testnet.** The adapter refuses `network: "testnet"`.
- The 13-chain USDT0 mesh Stellar is peered with (per the entry whose Polygon deployment `0x6ba1…` is the receiver
  Scan reports) and its endpoint ids are pinned in `packages/sdk/src/rails/usdt0-layerzero/chains.ts`, recorded at
  [evidence/usdt0-mesh.layerzero-metadata.json](verified/experiments/evidence/usdt0-mesh.layerzero-metadata.json).
  Only Ethereum's OFT adapter has `approvalRequired = true`.
- LayerZero does run a Stellar testnet endpoint: eid `40600`, EndpointV2
  `CALTBA5S6GRJEHAXFP45LGGLKWWAF7HTZCPNUBUJF2HWWRRLQNV35AIV` (deployments metadata). No USDT0 OFT is attached to it.

### 2.6 Recorded mainnet responses used by the adapter tests

`packages/sdk/src/rails/usdt0-layerzero/__fixtures__/mainnet-2026-09-11.json`, produced by
`pnpm --filter @ferryline/sdk record:usdt0-fixtures` (read-only simulations, nothing signed or submitted):
`is_paused`, `approval_required`, `shared_decimals`, `decimal_conversion_rate`, `peer(30109)`, `peer(4242)`,
`has_oft_fee(30109)`, `quote_oft`, `quote_send`, SAC `balance`, a full `send` simulation (minResourceFee 98605,
one auth entry), the sender's trustline and account ledger entries, and `getTransaction` for the send above.
Decoded: `quote_oft` limit min 0 / max 18446744073709551615, receipt sent == received == 12345670 (no bps fee on
this route), `quote_send` native_fee 3558611 stroops.

---

## 3b. CCTP facts added in phase 2 (2026-09-11)

- **`get_min_fee(USDC) = 0`** on both networks (read-only simulation against TokenMessengerMinter; USDC SAC ids
  derived with `stellar contract id asset`: mainnet `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`,
  testnet `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`; issuers from Circle's USDC address page:
  mainnet `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`, testnet
  `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`).
- **Circle fee API** (`GET /v2/burn/USDC/fees/{src}/{dst}`, sandbox and production agree): out of Stellar (27 -> 0/3/6)
  both thresholds 1000 and 2000 are listed with `minimumFee 0`; into Stellar (0/3/6 -> 27) threshold 1000 carries
  `minimumFee` 1 to 1.4 and 2000 is 0. Listed is not the same as accepted.
- **Stellar-source burns use the allowance model.** Read-only simulations of `deposit_for_burn` on mainnet and
  testnet stop at `USDC.transfer_from(TokenMessengerMinter, caller, TokenMessengerMinter, amount)` with
  "not enough allowance to spend". A burn is therefore `approve` then `deposit_for_burn`, two transactions.
  Those simulations never reached the fee or threshold checks, so they say nothing about `max_fee` or
  `min_finality_threshold`.
- The MessageTransmitter interface is committed at
  [verified/cctp-message-transmitter.mainnet.rs](verified/cctp-message-transmitter.mainnet.rs).

---

## 3c. CCTP facts added while building the adapter (2026-09-11, phase 2b)

- **Real Stellar-source burns, Iris production, 13 of 13 in the last ~6 days** ([evidence/iris.mainnet.stellar-source-burns.summary.json](verified/experiments/evidence/iris.mainnet.stellar-source-burns.summary.json)):
  every one `status: "complete"`, `maxFee "0"`, `feeExecuted "0"`, `delayReason null`. Destinations: Base (6), Solana (5),
  Polygon (7). Twelve requested `minFinalityThreshold 2000` and executed at 2000; **one requested 1000 and was executed
  at 2000** (`d4337ce7…`, 1 USDC to Base). These are other operators' transactions, observed, not run by this repo.
  They are evidence toward experiments 3 and 4 but the SDK still ships **no default** for either parameter.
- **Real inbound messages to Stellar, 3 decoded** ([evidence/iris.mainnet.inbound-to-stellar.observed.json](verified/experiments/evidence/iris.mainnet.inbound-to-stellar.observed.json)):
  `mintRecipient` bytes32 == CctpForwarder contract id in all three; hook data exactly `24 zero bytes | u32 0 | u32 56 | G… strkey`,
  no trailing payload. Two were Standard (2000 -> 2000, fee 0). **One was a Fast Transfer into Stellar** (Solana -> Stellar,
  1000 -> 1000, `maxFee 103849`, `feeExecuted 86541` on `865417222`, about 1 bps). So Fast Transfer *into* Stellar is live;
  the chains table's "Fast N/A" applies to Stellar as source, where the one 1000 request was executed at 2000.
- **Message layout** (Circle technical guide, developers.circle.com/cctp/references/technical-guide): header 148 bytes
  `version u32 | sourceDomain u32 | destinationDomain u32 | nonce 32 | sender 32 | recipient 32 | destinationCaller 32 |
  minFinalityThreshold u32 | finalityThresholdExecuted u32`, then BurnMessage body 228 bytes `version u32 | burnToken 32 |
  mintRecipient 32 | amount u256 | messageSender 32 | maxFee u256 | feeExecuted u256 | expirationBlock u256 | hookData…`.
  Cross-checked field by field against Circle's own `decodedMessage` for burn `150b5711…`. In that message
  `header.sender` decodes to the TokenMessengerMinter contract id, `body.burnToken` to the USDC SAC, and
  `body.messageSender` to the burner's G account; Circle returns those three as `null` ("the API cannot distinguish a
  32-byte Stellar account from a contract"). `header.version 1`, `body.version 1`.
- **A real `deposit_for_burn` invocation, decoded** (tx `150b5711…`, [sdk fixture](../sdk/src/rails/usdc-cctp/__fixtures__/mainnet-2026-09-11.json)):
  `caller G…`, `amount 6458000000` (7-decimal; the message carried 645800000 at 6), `destination_domain 6`,
  `mint_recipient` = 12 zero bytes + EVM address, `burn_token` = USDC SAC, `destination_caller` = 32 zero bytes,
  `max_fee 0`, `min_finality_threshold 2000`. No memo. Resource fee 43101 stroops. A test encodes the same call with
  the adapter's encoder and asserts byte-identical XDR.
- **Iris v2 API, observed** (production): `GET /v2/messages/{sourceDomain}?transactionHash=…` and `?nonce=0x…` both return
  `{ messages: [{ message, eventNonce, attestation, cctpVersion: 2, status, delayReason, decodedMessage }], sourceTxHash }`;
  unknown transaction -> HTTP 404 `{"error":"Message not found for provided parameters"}`. Python's default user agent is
  rejected with 403; curl and Node fetch are fine. **Only `status: "complete"` has been observed (17 messages); Circle's
  technical guide lists the endpoints but does not enumerate status or delayReason values.** The adapter treats any other
  status as "attestation pending" and surfaces it verbatim.
- **Fees** (developers.circle.com/cctp/concepts/fees): "Standard Transfers are free"; the fee is deducted from the amount
  when USDC is minted on the destination; `maxFee` caps it and "if the actual fee exceeds your specified maxFee, the
  transaction will revert on the source blockchain, and no USDC will be burned". `minimumFee` is in basis points.
- **`is_nonce_used` semantics:** on Stellar's MessageTransmitter it answers for *inbound* messages (the outbound burn's
  nonce reads `false` there; it is consumed on the destination). The adapter checks delivery on the destination's
  transmitter accordingly: EVM `MessageTransmitterV2.usedNonces(bytes32)` for Stellar -> EVM, Stellar `is_nonce_used`
  for EVM -> Stellar.
- **EVM contracts** (developers.circle.com/cctp/references/contract-addresses): TokenMessengerV2 `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`
  and MessageTransmitterV2 `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` on Ethereum (0), Arbitrum (3), Base (6), Polygon (7)
  mainnet; testnet `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` / `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`. Both are
  EIP-1967 proxies. **Selectors verified in the implementation bytecode on Base mainnet:** `depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)`
  = `779b432d` and `depositForBurn(…)` = `8e0250ee` in TokenMessengerV2 impl `0x555e2725…`; `receiveMessage(bytes,bytes)`
  = `57ecfd28`, `usedNonces(bytes32)` = `feb61724`, `localDomain()` = `8d3638f4` in MessageTransmitterV2 impl `0x7db629f6…`.
  USDC addresses from developers.circle.com/stablecoins/usdc-contract-addresses.
- `TokenMessengerMinter.get_min_fee_amount(USDC, 1 USDC) = 0` and `paused() = false` on mainnet; `MessageTransmitter.paused() = false`,
  `get_local_domain() = 27` (read-only simulations, recorded in the sdk fixture).

## 4. Not yet verified (do not build on these)

Status after phase 2. The experiment scripts under `experiments/` exist for each item; their dated result files
live in [verified/experiments/](verified/experiments/). All four are **BLOCKED** on operator assets, none was
substituted with an assumption.

1. **Inbound USDT0 `to` semantics for C addresses** and **muxed recipients**: unresolved. Needs a mainnet run of
   `experiments/inbound-usdt0-c-address.ts`. The SDK throws `UNSUPPORTED_RECIPIENT_KIND` for C and M inbound.
2. **Inbound USDT0 with no trustline, and whether delivery is retried after the trustline is added**: unresolved.
   Needs a mainnet run of `experiments/inbound-usdt0-no-trustline.ts`. The SDK's inbound quote fails the
   `recipient-trustline` check and `build()` refuses.
3. **`min_finality_threshold` accepted for Stellar-as-source**: not run by this repo. Observed on mainnet (§3c): 2000 is
   accepted and executed at 2000; one 1000 request was accepted and executed at 2000. Needs
   `experiments/cctp-finality-threshold.ts` with testnet USDC for a first-party result. No default ships.
4. **`max_fee = 0` accepted end to end**: not run by this repo. Observed on mainnet (§3c): 13 of 13 recent burns used
   `maxFee 0` and were attested `complete` with `feeExecuted 0`. Needs `experiments/cctp-burn-max-fee-zero.ts` for a
   first-party result. No default ships.
4b. **Unit of `max_fee` on the Stellar TokenMessengerMinter**: every observed burn passed 0, so 6- versus 7-decimal units
   are unverified. The adapter converts the caller's USDC amount to 7 decimals (the same units as `amount`), which is
   the safe direction if wrong: a too-large cap cannot increase the fee Circle charges, a too-small one only reverts.
5. **LayerZero Scan status vocabulary** beyond `DELIVERED`.
6. **EVM-side `send` calldata** (`IOFT_ABI` in the SDK) has not been executed against a live chain by this repo.
7. **SCF #46 deadline** and the Discord quotes in the technical doc (not code-relevant).
