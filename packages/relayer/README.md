# @ferryline/relayer

Completes CCTP-to-Stellar transfers on the sender's behalf: watches Circle's Iris for attestation,
builds and sponsors the `mint_and_forward` call, and confirms delivery.

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

| Variable                    | What it is                                                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FERRYLINE_NETWORK`         | `"mainnet"` or `"testnet"` — which CCTP network to run against.                                                                                                                                                                  |
| `DATABASE_URL`              | A Postgres connection string.                                                                                                                                                                                                    |
| `FERRYLINE_STELLAR_RPC_URL` | The Soroban RPC endpoint to use.                                                                                                                                                                                                 |
| `FERRYLINE_SPONSOR_SECRET`  | The sponsor account's Stellar secret seed (`S...`). Every `mint_and_forward` fee-bump is signed and paid for by this account. Never a default, never a silently-generated throwaway key — see `src/signer/env-secret-signer.ts`. |

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
silently falling back to anything.

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

**Docker Compose only:**

| Variable             | Default      | What it is                                                                                                                                    |
| -------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`  | _(required)_ | Password for the `ferryline` Postgres role. Shared between the `postgres` and `relayer` services — do not set it independently in two places. |
| `POSTGRES_HOST_PORT` | `5432`       | Host-side port Postgres is exposed on, for local `psql`/GUI inspection. Change this if the host already runs its own Postgres on 5432.        |

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

### Registering a real testnet transfer

`POST /transfers` requires a bearer token from the `api_keys` table (there is no admin endpoint yet
— see STEP 2's "not a full auth system" scope). Insert one directly for local testing:

```sh
docker compose exec postgres psql -U ferryline -d ferryline -c \
  "INSERT INTO api_keys (key_hash, label) VALUES ('$(echo -n 'your-test-key' | sha256sum | cut -d' ' -f1)', 'local-test');"
```

Then register a real CCTP burn transaction you've already submitted on a supported testnet source
chain (see `@ferryline/sdk`'s `CCTP_EVM_CHAINS` for the current testnet list — `ethereum-sepolia`,
`arbitrum-sepolia`, `base-sepolia`, `polygon-amoy`):

```sh
curl -X POST http://localhost:8080/transfers \
  -H "Authorization: Bearer your-test-key" \
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
