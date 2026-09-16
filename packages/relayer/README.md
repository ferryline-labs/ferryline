# @ferryline/relayer

Completes CCTP transfers on the sender's behalf, in **two independent directions**:

- **Inbound (EVM -> Stellar)**, documented first below: watches Circle's Iris for attestation,
  builds and sponsors the `mint_and_forward` call on Stellar, and confirms delivery.
- **Outbound (Stellar -> EVM)**, documented in its own section further down: watches Circle's Iris
  for a Stellar-source burn's attestation, then submits and sponsors `receiveMessage` on the
  destination EVM chain's `MessageTransmitterV2`, and confirms delivery there.

Both directions run in this same service/process; outbound is **opt-in per deployment**
(`FERRYLINE_OUTBOUND_ENABLED=true`) — see that section for why and how.

## Security property: amount and recipient are never trusted from the API caller

`POST /transfers` accepts only `transferId`, `sourceChain`, `sourceTxHash`, and `rail` — which
source transaction to watch, nothing else. This is deliberate, not an oversight. The transfer's
actual `amount` and `recipient` are extracted only once the transfer reaches `attested`, from the
independently-parsed and verified on-chain CCTP message and its forwarder hook data (see
`work/attest.ts`). They are `null` on the row until that transition writes them.

If a caller could register a transfer claiming a recipient or amount that doesn't match what
actually happened on-chain, the relayer's spend cap and per-recipient rate-limit decisions could be
made against a fabricated fact instead of a verified one. Do not "simplify" this later by accepting
those fields as a convenience at registration time — see the comment on `registerTransferBodySchema`
in `src/http/schemas.ts` for the same note at the code itself.

## Two separate rate limits — do not confuse them

Because the recipient is not known at registration time (see above), the relayer enforces two
distinct rate limits at two different points, and only one of them is the real per-recipient
control:

- **Registration-time, per API key (`FERRYLINE_REGISTRATION_LIMIT_MAX_ATTEMPTS` /
  `FERRYLINE_REGISTRATION_LIMIT_WINDOW_MS`, default 60 attempts / 60 seconds).** Checked on every
  `POST /transfers` call, before the recipient exists. This is a **blunt spam brake**, not a
  precision control — it has no idea who the money is going to, only which API key made the call. Its
  job is to stop one caller from flooding the relayer with junk registrations. It is allowed a
  sensible default (unlike the spend-cap variables below) because getting it wrong risks
  over/under-blocking spam, not mis-spending the sponsor's funds. See
  `src/spend/registration-limit.ts`.
- **At the `pending -> attested` transition, per recipient (`FERRYLINE_MAX_TRANSFERS_PER_RECIPIENT`
  / `FERRYLINE_RECIPIENT_RATE_LIMIT_WINDOW_MS`, no default — required).** This is the **real**
  per-recipient limit, checked only once the recipient is verified from the independently-parsed
  on-chain message. A recipient over this limit gets a specific terminal failure code,
  `RECIPIENT_RATE_LIMITED`, distinct from every other terminal reason (nonce-already-used, malformed
  message, below-minimum-amount, etc.) — see `src/work/errors.ts`. The failed row still records the
  real, verified amount and recipient it was rejected for, so an operator investigating a rate-limited
  recipient has something to look at.

A 429 from `POST /transfers` is the registration-time brake, not evidence about any specific
recipient. Do not read a 429 there as "this recipient is rate-limited" — check
`GET /transfers/:id` for `errorCode: "RECIPIENT_RATE_LIMITED"` for that.

## Environment variables

Copy `.env.example` to `.env` and fill in real values before running the relayer, whether via
Docker Compose or directly with `node dist/main.js`.

**Genuinely required — the relayer refuses to start without these:**

| Variable                    | What it is                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FERRYLINE_NETWORK`         | `"mainnet"` or `"testnet"` — which CCTP network to run against.                                                                                                                                                                                                                                                                                                                                                               |
| `DATABASE_URL`              | A Postgres connection string.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FERRYLINE_STELLAR_RPC_URL` | The Soroban RPC endpoint to use.                                                                                                                                                                                                                                                                                                                                                                                              |
| `FERRYLINE_SPONSOR_SECRET`  | The sponsor account's Stellar secret seed (`S...`). Every `mint_and_forward` fee-bump is signed and paid for by this account. Never a default, never a silently-generated throwaway key — see `src/signer/env-secret-signer.ts`.                                                                                                                                                                                              |
| `FERRYLINE_ADMIN_SECRET`    | Gates `POST`/`DELETE /admin/api-keys` (see below). **Genuinely more sensitive than any integrator API key**: anyone holding this can mint unlimited real, spend-capable integrator keys, all sharing this relayer's one sponsor account and daily spend ceiling. Must be a real, separately-generated secret — never reused from an integrator key or the sponsor secrets above. Never a default — see `src/admin-config.ts`. |

**Spend-related — also required, also NO default.** These control real money movement, so an
unset value is treated the same as a genuine misconfiguration, not "assume something safe":

| Variable                                   | What it is                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `FERRYLINE_MAX_FEE_BUMP_STROOPS`           | Max XLM stroops fee-bumped for a single `mint_and_forward`.                                             |
| `FERRYLINE_DAILY_SPEND_CEILING_STROOPS`    | Max total XLM stroops (actual, confirmed spend) fee-bumped per UTC calendar day, across every transfer. |
| `FERRYLINE_MAX_TRANSFERS_PER_RECIPIENT`    | The real per-recipient rate limit's threshold (see above).                                              |
| `FERRYLINE_RECIPIENT_RATE_LIMIT_WINDOW_MS` | The real per-recipient rate limit's rolling window, in milliseconds.                                    |

This refusal is tested, not just documented — see `src/spend/config.test.ts` and
`src/signer/env-secret-signer.test.ts`, which confirm `loadSpendConfig`/`envSecretSigner` throw for
every one of these when unset, empty, whitespace-only, zero, negative, or non-numeric, rather than
silently falling back to anything. `FERRYLINE_ADMIN_SECRET`'s own refusal is tested the same way in
`src/admin-config.test.ts`; `src/http/routes/admin-api-keys.test.ts` separately proves the two
credential classes can never authenticate each other's routes (a real integrator key is rejected by
`/admin/api-keys`, and a real, freshly-created key genuinely stops working immediately after
revocation).

**Allowed sensible defaults — performance/load knobs, not money-safety controls:**

| Variable                                    | Default   | What it is                                                                             |
| ------------------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `HOST`                                      | `0.0.0.0` | Address the HTTP server binds to.                                                      |
| `PORT`                                      | `8080`    | Port the HTTP server listens on.                                                       |
| `FERRYLINE_POLL_INTERVAL_MS`                | `2000`    | Initial backoff delay when a work-loop phase finds nothing to do.                      |
| `FERRYLINE_POLL_MAX_INTERVAL_MS`            | `30000`   | Ceiling that backoff delay is clamped to.                                              |
| `FERRYLINE_MAX_CONCURRENT_TRANSFERS`        | `20`      | Max transfers driven concurrently, combined across both work-loop phases.              |
| `FERRYLINE_REGISTRATION_LIMIT_MAX_ATTEMPTS` | `60`      | The registration-time (blunt, per-API-key) spam brake's threshold — see above.         |
| `FERRYLINE_REGISTRATION_LIMIT_WINDOW_MS`    | `60000`   | That same brake's rolling window, in milliseconds.                                     |
| `FERRYLINE_RELAYER_VERSION`                 | `0.0.0`   | Reported in `GET /healthz`; set this to your actual deployed version if you track one. |

**CORS — optional, but FAILS CLOSED when unset (never defaults to allow-all):**

| Variable                 | Default                       | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FERRYLINE_CORS_ORIGINS` | _(unset — no origin allowed)_ | Comma-separated list of browser origins allowed to call this relayer cross-origin (e.g. the page hosting `<ferryline-widget>`, if it runs on a different origin than this relayer). A real, pre-existing gap found and fixed during the outbound-auto-registration phase: with this unset, EVERY browser-based caller is silently blocked by the browser itself, before the request ever reaches this server — confirmed directly against a real browser run. Unset is completely safe for a relayer with no browser-based integrator (server-to-server callers are never subject to CORS in the first place). Never set this to `*`. |

**Docker Compose only:**

| Variable             | Default      | What it is                                                                                                                                    |
| -------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`  | _(required)_ | Password for the `ferryline` Postgres role. Shared between the `postgres` and `relayer` services — do not set it independently in two places. |
| `POSTGRES_HOST_PORT` | `5432`       | Host-side port Postgres is exposed on, for local `psql`/GUI inspection. Change this if the host already runs its own Postgres on 5432.        |

**Outbound (Stellar -> EVM) — see the dedicated section below for the full explanation. All of
these are listed here only so the two directions' env vars are documented in one place; leave
`FERRYLINE_OUTBOUND_ENABLED` unset/`false` and ignore the rest of this table entirely for an
inbound-only deployment:**

| Variable                                            | Default  | What it is                                                                                                                                                                                                                                       |
| --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FERRYLINE_OUTBOUND_ENABLED`                        | `false`  | Opt-in switch for the whole outbound direction. Everything else in this table is read but unused (and never required) unless this is exactly `"true"`.                                                                                           |
| `FERRYLINE_OUTBOUND_DESTINATION_CHAIN`              | _(none)_ | **Required if enabled.** The destination EVM chain slug (e.g. `"ethereum-sepolia"`) — must be one `@ferryline/sdk`'s `cctpEvmChain` recognizes for the configured `FERRYLINE_NETWORK`.                                                           |
| `FERRYLINE_OUTBOUND_EVM_RPC_URL`                    | _(none)_ | **Required if enabled.** The destination EVM chain's own JSON-RPC endpoint.                                                                                                                                                                      |
| `FERRYLINE_OUTBOUND_SPONSOR_SECRET`                 | _(none)_ | **Required if enabled.** A `0x`-prefixed 32-byte EVM private key. Every `receiveMessage` call is signed and its gas paid by this account. Never a default, never a silently-generated throwaway key — see `src/signer/env-secret-evm-signer.ts`. |
| `FERRYLINE_OUTBOUND_MAX_GAS_WEI`                    | _(none)_ | **Required if enabled, NO default (spend-related).** Max wei spent on gas for a single `receiveMessage` call.                                                                                                                                    |
| `FERRYLINE_OUTBOUND_DAILY_GAS_CEILING_WEI`          | _(none)_ | **Required if enabled, NO default (spend-related).** Max total wei (actual, confirmed spend) on gas per UTC calendar day, across every outbound transfer.                                                                                        |
| `FERRYLINE_OUTBOUND_MAX_TRANSFERS_PER_RECIPIENT`    | _(none)_ | **Required if enabled, NO default (spend-related).** The real per-recipient rate limit's threshold — same two-rate-limit distinction as the inbound direction, see above.                                                                        |
| `FERRYLINE_OUTBOUND_RECIPIENT_RATE_LIMIT_WINDOW_MS` | _(none)_ | **Required if enabled, NO default (spend-related).** That limit's rolling window, in milliseconds.                                                                                                                                               |
| `FERRYLINE_OUTBOUND_POLL_INTERVAL_MS`               | `2000`   | Initial backoff delay when an outbound work-loop phase finds nothing to do.                                                                                                                                                                      |
| `FERRYLINE_OUTBOUND_POLL_MAX_INTERVAL_MS`           | `30000`  | Ceiling that backoff delay is clamped to.                                                                                                                                                                                                        |
| `FERRYLINE_OUTBOUND_MAX_CONCURRENT_TRANSFERS`       | `20`     | Max outbound transfers driven concurrently, combined across both outbound work-loop phases (independent of the inbound direction's own cap).                                                                                                     |

This refusal is tested, not just documented — see `src/spend/outbound-config.test.ts` and
`src/signer/env-secret-evm-signer.test.ts`, the outbound mirrors of the inbound tests named above,
covering the same unset/empty/whitespace-only/zero/negative/non-numeric/malformed-key cases.

## Docker Compose

Two services: `relayer` and `postgres`, matching the project's self-hostable maintenance plan. From
this directory (`packages/relayer/`):

```sh
cp .env.example .env
# edit .env: at minimum set POSTGRES_PASSWORD, FERRYLINE_STELLAR_RPC_URL, FERRYLINE_SPONSOR_SECRET,
# and the four spend-related variables above.
docker compose up -d --build
```

The build context is the repository root (the Dockerfile needs `packages/core`, `packages/sdk`, and
`packages/relayer` together), which `docker-compose.yml` already points at correctly — you do not
need to `cd` anywhere else. `postgres` reports healthy (via `pg_isready`) before `relayer` starts, so
a fresh `up` never races the database being ready.

### What to expect

`GET /healthz` should report `status: "ok"`, the sponsor account derived from
`FERRYLINE_SPONSOR_SECRET`, and the daily spend ceiling's current state:

```sh
curl http://localhost:8080/healthz
```

```json
{
  "status": "ok",
  "service": "ferryline-relayer",
  "version": "0.0.0",
  "uptimeSeconds": 12,
  "now": "2026-01-01T00:00:00.000Z",
  "sponsor": { "account": "G...", "nativeBalanceStroops": null, "balanceUnknown": true },
  "dailySpend": { "spentStroops": "0", "ceilingStroops": "1000000000", "ceilingReached": false }
}
```

`nativeBalanceStroops`/`balanceUnknown` reflect whatever the sponsor account's real, live balance
actually is on the configured network — `balanceUnknown: true` just means that account does not
exist yet or is not yet funded, not an error in the relayer itself.

### Admin: issuing and revoking real integrator API keys

`POST /transfers` (and every other integrator-facing route) requires a bearer token from the
`api_keys` table. Two admin-only routes manage that table — gated by `FERRYLINE_ADMIN_SECRET`
(see above), a genuinely separate, more sensitive credential from any integrator key it issues:
never the same value, never interchangeable, checked by a completely separate code path
(`requireAdminSecret` in `src/http/auth.ts`, not `requireApiKey`). This replaces the raw-SQL
`INSERT` this README used to document as the only way to add a key — still deliberately minimal
(no sessions, no integrator-facing self-signup, no key rotation UI, no scopes beyond the binary
admin/integrator split), just no longer requiring direct Postgres write access for every new
integrator.

**Create a key** — returns the real, usable plaintext key exactly once; it is never stored or
logged anywhere, so save it immediately, there is no way to retrieve it again after this response:

```sh
curl -X POST http://localhost:8080/admin/api-keys \
  -H "Authorization: Bearer $FERRYLINE_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"label": "acme-corp-integration"}'
# {"apiKey": "<the real, usable plaintext key — save this now>", "keyHash": "...", "label": "acme-corp-integration"}
```

Hand `apiKey` to the integrator over whatever channel you already use; it is what they set as
`relayer-api-key` on `<ferryline-widget>` or pass as their own `Authorization: Bearer` header.

**Revoke a key** — idempotent (revoking an already-revoked or unknown `keyHash` still returns
`204`, not an error), and takes effect immediately: the very next request bearing that key's
plaintext is rejected with `401`:

```sh
curl -X DELETE http://localhost:8080/admin/api-keys/<the keyHash from the create response> \
  -H "Authorization: Bearer $FERRYLINE_ADMIN_SECRET"
```

### Registering a real testnet transfer

Register a real CCTP burn transaction you've already submitted on a supported testnet source
chain (see `@ferryline/sdk`'s `CCTP_EVM_CHAINS` for the current testnet list — `ethereum-sepolia`,
`arbitrum-sepolia`, `base-sepolia`, `polygon-amoy`):

```sh
curl -X POST http://localhost:8080/transfers \
  -H "Authorization: Bearer <the real apiKey from the admin create-key response above>" \
  -H "Content-Type: application/json" \
  -d '{
    "transferId": "<a real ULID — see @ferryline/core newTransferId()>",
    "sourceChain": "ethereum-sepolia",
    "sourceTxHash": "<the real 0x-prefixed 32-byte deposit_for_burn transaction hash>",
    "rail": "usdc-cctp"
  }'
```

A successful registration returns `201` with `status: "pending"`. Poll
`GET /transfers/:id` to watch it progress: `pending` (waiting on Iris) → `attested` (message
verified, amount/recipient now populated from the real on-chain message) → `submitting` (fee-bump
broadcast) → `delivered`. `amount` and `recipient` stay `null` until `attested` — see the security
property at the top of this README for why.

## Outbound (Stellar -> EVM)

Completes a Stellar-source CCTP burn by submitting `receiveMessage(message, attestation)` on the
destination EVM chain's real `MessageTransmitterV2` contract, sponsoring the gas. Mirrors every
mechanism the inbound direction above uses — same state machine (`pending` → `attested` →
`submitting` → `delivered`/`failed`), same "amount/recipient are never trusted from the API caller"
security property, same append-only spend ledger, same atomic reserve-then-commit daily ceiling,
same crash-safe `submitting`-before-broadcast write ordering — adapted for CCTP's mirror-image
direction. See `OUTBOUND_SCOPE.md` and `OUTBOUND_THREAT_MODEL.md` for the full design, and each
`src/work/outbound-*.ts`/`src/spend/outbound-*.ts` file's own doc comments for exactly how and why
each mechanism does or doesn't diverge from its inbound counterpart.

**Why opt-in, not always-on:** a deployment that only wants the inbound direction should not be
forced to configure an EVM signing key, an EVM RPC endpoint, and a full second set of spend caps it
will never use. Set `FERRYLINE_OUTBOUND_ENABLED=true` and fill in every var in the outbound table
above to run both directions from this same process; leave it unset (or `false`) to run
inbound-only exactly as before this direction existed. There is no need to run a second copy of
this service for outbound — it shares the same Postgres database, the same `api_keys` table, and
the same registration-time rate limiter as inbound (see `src/spend/registration-limit.ts`'s own doc
comment for why that shared limiter is correct for both directions).

**v1 scope, per `OUTBOUND_SCOPE.md`:** exactly one destination chain per running relayer instance
(configured via `FERRYLINE_OUTBOUND_DESTINATION_CHAIN`) — Ethereum Sepolia for the real testnet run
this phase's own sign-off required. Registration is push-only: the caller (the widget, an SDK
integration, or a script) supplies an already-confirmed Stellar burn transaction hash; this service
does not watch Stellar for new burns itself. **The widget and `@ferryline/sdk` now register with
this service automatically** (`Ferryline.registerOutboundTransfer`, called once a transfer's final
build step confirms — see `packages/sdk/src/index.ts`'s own doc comment), a later, separate phase
from this relayer's own build — a raw caller (a script, or any integrator not using
`@ferryline/sdk`) can still call `POST /outbound-transfers` directly, exactly as documented below.

### POST /outbound-transfers

Same security property as `POST /transfers`, restated for this direction: accepts only
`transferId`, `sourceTxHash` (the Stellar burn transaction's hash — 64 lowercase hex characters, no
`0x` prefix), `destinationChain`, and `rail`. `amount`/`recipient` are extracted later, at
`attested`, from the independently-verified Iris message — never accepted from the caller. See
`src/http/outbound-schemas.ts`'s own doc comment.

```sh
curl -X POST http://localhost:8080/outbound-transfers \
  -H "Authorization: Bearer your-test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "transferId": "<a real ULID — see @ferryline/core newTransferId()>",
    "sourceTxHash": "<the real 64-char lowercase-hex Stellar deposit_for_burn transaction hash, no 0x prefix>",
    "destinationChain": "ethereum-sepolia",
    "rail": "usdc-cctp"
  }'
```

Uses the **same** bearer-token `api_keys` table and the **same** registration-time rate limiter as
`POST /transfers` above — a key rate-limited by one direction's registrations is rate-limited for
the other too (see the shared-limiter note above).

### GET /outbound-transfers/:id

Identical shape and no-auth reasoning to `GET /transfers/:id`. Progresses `pending` (waiting on
Iris) → `attested` (message verified, amount/recipient now populated) → `submitting`
(`receiveMessage` broadcast, real destination tx hash recorded) → `delivered`.

### GET /healthz, extended

The same endpoint used for inbound also reports the outbound sponsor's live EVM balance and daily
gas-ceiling status — as an additional `outbound` field, present only when
`FERRYLINE_OUTBOUND_ENABLED=true` for this process:

```json
{
  "status": "ok",
  "service": "ferryline-relayer",
  "sponsor": { "account": "G...", "nativeBalanceStroops": "...", "balanceUnknown": false },
  "dailySpend": { "spentStroops": "0", "ceilingStroops": "1000000000", "ceilingReached": false },
  "outbound": {
    "destinationChain": "ethereum-sepolia",
    "sponsor": { "address": "0x...", "nativeBalanceWei": "...", "balanceUnknown": false },
    "dailySpend": { "spentWei": "0", "ceilingWei": "50000000000000000", "ceilingReached": false }
  }
}
```
