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

## 4. Not yet verified (do not build on these)

1. **Inbound USDT0 `to` semantics.** How the Stellar OFT turns the 32-byte `to` into a Stellar address
   when Stellar is the destination (ed25519 account vs contract id is ambiguous in 32 bytes), and whether a
   muxed recipient is possible at all on this rail. Not on S4, S5, S6 or S7. Needs the OFT source or a
   testnet transfer before the LayerZero adapter handles inbound.
2. **`min_finality_threshold` when Stellar is the destination.** S3 says Fast Transfer is N/A for Stellar,
   yet S1's example still exposes 1000/2000. Unknown whether 1000 is rejected, ignored, or charged.
3. **`max_fee` for Stellar-source burns.** S3 shows "Upfront Fees ❌" for Stellar. What value the
   TokenMessengerMinter expects, and whether Circle charges a Standard Transfer fee on this route.
4. **USDC token contract address on Stellar** (not on S2).
5. **SCF #46 deadline** and the Discord quotes in the technical doc (not code-relevant).
