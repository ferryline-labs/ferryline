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

  -- 6-decimal USDC units (Circle's CCTP message unit, regardless of chain).
  amount               NUMERIC(38, 0) NOT NULL,
  recipient            TEXT NOT NULL,                 -- Stellar strkey (G/C/M) the forwarder pays out to

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
-- the transfers table must not be able to erase or rewrite this trail. This is
-- the record an operator (or an auditor) reconstructs actual spend from
-- independently of whatever the relayer's own status logic believes happened.
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
-- daily_spend: the global spend ceiling's ledger. One row per UTC calendar
-- day. `spent_stroops` is incremented atomically alongside every CONFIRMED
-- fee-bump broadcast (not an estimate — see src/spend/ceiling.ts), so the
-- ceiling check is always against real, already-committed spend.
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
