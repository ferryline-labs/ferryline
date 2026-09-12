-- Ferryline relayer schema.
--
-- Applied once at startup by src/db/migrate.ts (idempotent: every statement is
-- CREATE ... IF NOT EXISTS). No migration framework: this is the whole schema,
-- self-hosters run it by starting the relayer against an empty database.

-- ---------------------------------------------------------------------------
-- transfers: one row per registered CCTP-to-Stellar transfer, and the state
-- machine that drives it.
--
-- Status transitions (see src/repo/transfers.ts for the enforcing code):
--   pending -> attested -> submitting -> delivered
--   (any of pending/attested/submitting) -> failed   [terminal, only for the
--     explicit terminal errors enumerated in src/work/errors.ts — never a
--     catch-all]
--
-- `version` increments on every update and every UPDATE is gated on the
-- version the caller last read (`WHERE id = $1 AND version = $2`), so two
-- concurrent workers (or a worker racing its own crash-recovery pass) cannot
-- silently clobber each other's transition. `updated_at` is maintained by the
-- same statement, not a trigger, so it is always consistent with `version`.
-- ---------------------------------------------------------------------------

CREATE TYPE transfer_status AS ENUM (
  'pending',
  'attested',
  'submitting',
  'delivered',
  'failed'
);

CREATE TABLE IF NOT EXISTS transfers (
  id                   TEXT PRIMARY KEY,             -- ULID, from @ferryline/core newTransferId()
  rail                 TEXT NOT NULL,                 -- currently always 'usdc-cctp'
  status               transfer_status NOT NULL DEFAULT 'pending',

  source_chain         TEXT NOT NULL,
  source_tx_hash       TEXT NOT NULL,
  source_domain        INTEGER NOT NULL,

  destination_chain    TEXT NOT NULL DEFAULT 'stellar',
  destination_tx_hash  TEXT,                          -- Stellar mint_and_forward tx hash, once submitted

  -- NULL until status = 'attested'. Deliberately NOT accepted from the POST /transfers caller: the
  -- registration body only names WHICH source transaction to watch (transferId, sourceChain,
  -- sourceTxHash, rail per STEP 2). amount and recipient are extracted from the real, attested Iris
  -- message body and forwarder hook data (see work/attest.ts, which uses @ferryline/sdk's
  -- parseCctpMessage / parseForwarderHookData — the same parser the adapter uses, not reimplemented
  -- here) and are therefore verified on-chain truth, not a caller's unverified claim about what a
  -- transaction will turn out to contain.
  amount               NUMERIC(38, 0),                 -- 6-decimal USDC units (Circle's CCTP message unit)
  recipient            TEXT,                           -- Stellar strkey (G/C/M) the forwarder pays out to

  -- The two fund-stranding-guard fields, recorded so a corrupted/replayed row can be
  -- re-verified without re-parsing the Iris message. Always the CctpForwarder contract id
  -- once past 'attested' (packages/sdk usdc-cctp/message.ts assertForwarderFields).
  mint_recipient       TEXT,
  destination_caller   TEXT,

  -- Circle attestation, once obtained (status -> 'attested').
  iris_nonce            TEXT,                          -- 0x-prefixed 32-byte hex, Iris eventNonce
  iris_message          TEXT,                          -- 0x-prefixed hex, Iris `message`
  iris_attestation      TEXT,                          -- 0x-prefixed hex, Iris `attestation`

  error_code           TEXT,                          -- set only when status = 'failed'
  error_detail          TEXT,

  version               BIGINT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transfers_status_idx ON transfers (status);
CREATE INDEX IF NOT EXISTS transfers_recipient_idx ON transfers (recipient, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS transfers_source_tx_idx ON transfers (source_chain, source_tx_hash);

-- ---------------------------------------------------------------------------
-- spend_attempts: an append-only, pre-submission record of every fee-bump the
-- relayer is ABOUT to make, written before the transaction is signed or
-- broadcast. Deliberately not a foreign key to transfers.id with ON DELETE
-- CASCADE, and never UPDATEd or DELETEd by the relayer: a bug or corruption in
-- the transfers table must not be able to erase or rewrite this trail.
--
-- This is the RESERVATION-INTENT log specifically: one row per attempt, logged
-- before that attempt's ceiling reservation is even tried. It is NOT, on its
-- own, "actual spend" — an attempt logged here can still be released (the
-- reservation given back) if a concurrent worker won the race to submit first,
-- or if the network rejected the fee-bump before ever broadcasting it. Read
-- this table ALONGSIDE spend_ledger_events (below), which durably records
-- which of these attempts were released and why, and which were actually
-- broadcast. Reconstructing true net spend independently of the relayer's own
-- status logic means joining the two, not reading spend_attempts alone.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS spend_attempts (
  id              BIGSERIAL PRIMARY KEY,
  transfer_id     TEXT NOT NULL,
  amount_stroops  NUMERIC(38, 0) NOT NULL,   -- the fee-bump amount, in XLM stroops
  destination      TEXT NOT NULL,             -- recipient this spend is for
  sponsor_account  TEXT NOT NULL,
  attempted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spend_attempts_transfer_idx ON spend_attempts (transfer_id);
CREATE INDEX IF NOT EXISTS spend_attempts_attempted_at_idx ON spend_attempts (attempted_at);

-- ---------------------------------------------------------------------------
-- spend_ledger_events: STEP 5's completeness fix. Append-only, same discipline
-- as spend_attempts (never UPDATEd or DELETEd), recording what actually
-- happened to each reservation the moment it happens — before the
-- corresponding action, same "log before you act" rule as spend_attempts
-- itself. One row per event:
--
--   'reserved'  — written immediately before spendCeiling.reserve() is called
--                 (submit.ts). Paired 1:1 with a spend_attempts row for the
--                 same transfer_id, but recorded separately here so a
--                 transfer's full event sequence lives in one place.
--   'released'  — written immediately before spendCeiling.release() is called,
--                 for EITHER of the two cases that release a reservation (see
--                 release_reason): a concurrent worker won the race to
--                 `submitting` first, or sendTransaction rejected the fee-bump
--                 before it ever reached the network. Nothing was actually
--                 spent for a released reservation.
--   'broadcast' — written once sendTransaction accepts the fee-bump
--                 (PENDING/DUPLICATE/TRY_AGAIN_LATER — anything but ERROR).
--                 The reservation stands as real, committed spend from this
--                 point; no corresponding release will ever follow it.
--
-- A row's amount_stroops is always the same fee-bump quote across its
-- 'reserved'/'released'/'broadcast' rows for one transfer_id, so net actual
-- spend per transfer (or in aggregate) is reconstructed as:
--   SUM(CASE event_type WHEN 'reserved' THEN amount_stroops
--                        WHEN 'released' THEN -amount_stroops
--                        ELSE 0 END)
-- — a transfer that only ever reached 'reserved' (crashed before this table
-- could record its outcome) nets as reserved-but-outcome-unknown, which is the
-- conservative, correct answer: it is exactly the ambiguity
-- reconcileSubmitting resolves on restart by asking Stellar directly, not
-- something this table can or should guess at.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS spend_ledger_events (
  id              BIGSERIAL PRIMARY KEY,
  transfer_id     TEXT NOT NULL,
  event_type      TEXT NOT NULL,   -- 'reserved' | 'released' | 'broadcast'
  -- Set only when event_type = 'released': WHY the reservation was given
  -- back, preserved as a typed value (not free text) because submit.ts
  -- already distinguishes these as two separate code paths, and "how much
  -- capacity did we lose to broadcast failures vs. worker races" is a
  -- question this table should answer without grepping logs.
  release_reason  TEXT,            -- 'concurrent_race_lost' | 'broadcast_rejected' | NULL
  amount_stroops  NUMERIC(38, 0) NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spend_ledger_events_transfer_idx ON spend_ledger_events (transfer_id);
CREATE INDEX IF NOT EXISTS spend_ledger_events_occurred_at_idx ON spend_ledger_events (occurred_at);

-- ---------------------------------------------------------------------------
-- daily_spend: the global spend ceiling's ledger. One row per UTC calendar day.
--
-- Reservation, not a post-hoc counter: `spent_stroops` is incremented by a
-- single atomic statement (SpendCeiling.reserve, src/spend/ceiling.ts) that
-- checks-and-increments in one round trip, BEFORE broadcast, never after. The
-- statement is:
--
--   INSERT INTO daily_spend (spend_date, spent_stroops) VALUES ($1, $2)
--   ON CONFLICT (spend_date) DO UPDATE
--     SET spent_stroops = daily_spend.spent_stroops + EXCLUDED.spent_stroops
--     WHERE daily_spend.spent_stroops + EXCLUDED.spent_stroops <= $3
--   RETURNING spent_stroops;
--
-- Postgres takes a row-level lock on the (spend_date) row for the statement's
-- full duration, so two concurrent reservations against the same day
-- serialize: whichever commits first "wins" the remaining budget, and the
-- second sees the already-updated total and correctly returns zero rows if it
-- would exceed the ceiling. There is no read-then-write gap for two
-- transfers to both pass a check against room that only fits one — verified
-- under genuine concurrency (two simultaneous connections, not sequential
-- statements) in src/spend/ceiling.integration.test.ts and
-- src/work/loop.integration.test.ts's "only one of two eligible transfers
-- gets minted" test.
--
-- If a reservation succeeds but the fee-bump is then rejected BEFORE ever
-- reaching the network (sendTransaction status "ERROR" — nothing was spent
-- on-chain), the reservation is released with a compensating decrement
-- (SpendCeiling.release), so a build/broadcast failure does not permanently
-- burn ceiling budget that was never actually spent.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_spend (
  spend_date      DATE PRIMARY KEY,
  spent_stroops    NUMERIC(38, 0) NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- api_keys: the MVP bearer-token allow-list for POST /transfers. Deliberately
-- minimal — see STEP 2 of the phase-3 sign-off ("do not build a full auth
-- system"). Keys are stored as a SHA-256 hash, never in plaintext.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash    TEXT PRIMARY KEY,   -- sha256(hex) of the bearer token
  label       TEXT NOT NULL,      -- operator-assigned name, for audit logs only
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- registration_attempts: STEP 4's registration-time defense. One row per
-- POST /transfers call that got past auth, keyed by the CALLER'S api key
-- (key_hash), not by recipient — the recipient is not yet known at
-- registration time (see the security-property comment on
-- registerTransferBodySchema in src/http/schemas.ts). This is deliberately a
-- BLUNT spam brake on "one caller floods us with registrations", not the
-- real per-recipient rate limit — that check runs later, at the pending ->
-- attested transition, once the recipient is verified from the on-chain
-- message (see countByRecipientSince and RECIPIENT_RATE_LIMITED in
-- src/work/errors.ts). Append-only from the relayer's side, same reasoning
-- as spend_attempts: this is a simple rolling-window counter, not a
-- money-safety operation, so unlike daily_spend it does not need a single
-- atomic check-and-increment statement — see src/spend/registration-limit.ts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS registration_attempts (
  id            BIGSERIAL PRIMARY KEY,
  key_hash      TEXT NOT NULL,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_attempts_key_hash_idx
  ON registration_attempts (key_hash, attempted_at);
