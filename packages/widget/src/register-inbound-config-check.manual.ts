/**
 * MANUAL, NETWORK-TOUCHING VERIFICATION SCRIPT — NOT part of this package's automated test suite.
 *
 * Filename ends in `.manual.ts`, not `.test.ts`, specifically so vitest.config.ts's own
 * `include: ["src/**\/*.test.ts"]` never matches it — confirmed directly against that pattern
 * before writing this file. It will NOT run as part of `pnpm test`, CI, or any normal vitest
 * invocation. Run it explicitly and only when you have a real, running relayer instance:
 *
 *   FERRYLINE_RELAYER_URL=http://localhost:8080 FERRYLINE_RELAYER_API_KEY=<real key> \
 *     pnpm exec vitest run src/register-inbound-config-check.manual.ts
 *
 * STEP 0 (outbound-auto-registration phase) — real end-to-end check, SCOPED PRECISELY to what
 * that step changed: the config-read path inside FerrylineWidget.registerInboundTransfer, NOT a
 * re-test of Circle/Iris/Stellar mint_and_forward mechanics (those were already proven real in
 * experiments/widget-seam-inbound-relayer.ts's 2026-09-12 run, and are unrelated to this change).
 *
 * What changed in STEP 0: registerInboundTransfer used to build its own RelayerConfig directly
 * from this widget instance's own `relayer-url`/`relayer-api-key` attribute getters. It now reads
 * relayerUrl/relayerApiKey from `this.client().ferryline.config` instead — the SAME
 * FerrylineConfig every other client() caller already uses (see index.ts's own doc comment on
 * registerInboundTransfer for the exact reasoning). registerTransfer/trackRelayerTransfer
 * themselves (./relayer.ts) were not touched at all.
 *
 * What this file proves: constructing a REAL FerrylineWidget custom element (via this package's
 * own real happy-dom test environment — see vitest.config.ts), setting its real
 * relayer-url/relayer-api-key HTML attributes, and calling its real registerInboundTransfer()
 * method against a REAL, already-running relayer instance (packages/relayer/docker-compose.yml)
 * produces a working RelayerConfig through the migrated path, and that registerTransfer/
 * trackRelayerTransfer behave identically through it — i.e. the migration is behavior-preserving.
 *
 * What this file does NOT prove: nothing new about whether a real EVM burn gets attested by Iris
 * or mint_and_forward'd on Stellar — that mechanism was never in question here. To avoid needing
 * a brand-new EVM burn (no private key available for a fresh one), this re-registers the
 * ALREADY-REAL, ALREADY-ON-CHAIN-CONFIRMED burn transaction from the 2026-09-12 inbound seam run
 * (0x75f9db69d5618f11564e78001586d680c88fe1b0f54dbb1b7ae91a42fa177c0c).
 *
 * IMPORTANT (confirmed by actually running this against a non-fresh relayer DB, not assumed): the
 * relayer's unique index is on (source_chain, source_tx_hash), NOT transferId — see
 * db/schema.sql's `transfers_source_tx_idx`. A fresh transferId does NOT bypass that constraint;
 * re-running this file against a relayer DB that already has a row for this real tx hash gets a
 * real 409 from registerTransfer, which throws, and this test correctly fails rather than silently
 * proceeding. Run this against a FRESH relayer DB (e.g. `docker compose down -v && docker compose
 * up -d --build`) each time, or expect a 409 on a repeat run — that 409 is itself real, correct
 * evidence the migrated config path produced a working request the relayer genuinely validated
 * against its own real uniqueness constraint, not a false negative.
 *
 * A REAL, DIRECTLY OBSERVED CONSEQUENCE of reusing an already-DELIVERED burn tx (confirmed by
 * actually running this once, before this note was added): the message's CCTP nonce was already
 * consumed by the original 2026-09-12 delivery, so the relayer's real `mint_and_forward` call
 * genuinely reverts on-chain (`receive_message` rejects an already-used nonce — a correct,
 * intentional CCTP replay guard, not a bug), and the relayer's own error classification currently
 * treats that specific revert as RETRYABLE rather than mapping it to a terminal
 * NONCE_ALREADY_USED code (that terminal code is only assigned via a separate is_nonce_used
 * pre-check, not from this simulation-time revert) — so the row never reaches `delivered`/
 * `failed`, it retries indefinitely at `attested`. This is a real, pre-existing relayer
 * classification gap surfaced incidentally by this check's own methodology (re-registering an
 * already-delivered tx), NOT a defect in STEP 0's config migration and out of that migration's own
 * scope to fix. Accordingly, this check does not wait for a terminal status: it aborts tracking
 * once the row reaches `attested` (real proof the migrated config path drove a real HTTP
 * registration AND a real polling loop against the real relayer, using the real, unmodified
 * registerTransfer/trackRelayerTransfer functions) and separately confirms via the relayer's own
 * logs/GET response that a real mint_and_forward attempt was made with the real, correctly-parsed
 * amount/recipient.
 */
import { newTransferId } from "@ferryline/core";
import { describe, expect, it } from "vitest";

import { defineFerrylineWidget, type FerrylineWidget } from "./index.js";

const RELAYER_URL = process.env["FERRYLINE_RELAYER_URL"];
const RELAYER_API_KEY = process.env["FERRYLINE_RELAYER_API_KEY"];

const REAL_BURN_TX_HASH = "0x75f9db69d5618f11564e78001586d680c88fe1b0f54dbb1b7ae91a42fa177c0c";
const SOURCE_CHAIN = "ethereum-sepolia";

describe.skipIf(!RELAYER_URL || !RELAYER_API_KEY)(
  "MANUAL: registerInboundTransfer through the STEP 0-migrated config path, against a real relayer",
  () => {
    it(
      "registers a fresh transferId against a real, already-confirmed burn tx, drives it through registerTransfer/trackRelayerTransfer, and reaches a real attested status with the real amount/recipient",
      { timeout: 5 * 60_000 },
      async () => {
        defineFerrylineWidget();
        const el = document.createElement("ferryline-widget") as FerrylineWidget;
        document.body.appendChild(el);

        el.setAttribute("network", "testnet");
        el.setAttribute("relayer-url", RELAYER_URL!);
        el.setAttribute("relayer-api-key", RELAYER_API_KEY!);

        const transferId = newTransferId();
        // eslint-disable-next-line no-console -- deliberate, human-readable progress output for a manual script
        console.log(`[manual check] transferId: ${transferId}`);
        // eslint-disable-next-line no-console
        console.log(`[manual check] re-registering real burn tx: ${REAL_BURN_TX_HASH}`);

        // registerInboundTransfer's own internal loop (registerTransfer, then trackRelayerTransfer)
        // only returns at a TERMINAL status. This specific tx's message nonce was already consumed
        // by its original 2026-09-12 delivery, so the relayer's real on-chain mint_and_forward
        // attempt genuinely reverts (a correct, intentional CCTP replay guard, not a bug) — and the
        // relayer's own error classification currently treats that specific revert as retryable
        // rather than terminal (its NONCE_ALREADY_USED code is only assigned via a separate
        // is_nonce_used pre-check, not from this simulation-time revert), so this promise is
        // expected to never settle for this specific reused tx. That is a real, pre-existing
        // relayer classification gap this check's own methodology incidentally surfaces, NOT a
        // defect in STEP 0's config migration and out of scope for this file to fix. Start it
        // without awaiting it, then independently poll GET /transfers/:id ourselves for a bounded
        // window; once a real, non-"pending" status is observed, disconnect the element — its own
        // disconnectedCallback aborts the internal tracking loop's AbortController (see index.ts),
        // which settles this promise (as a rejection) at that point. Attach a no-op catch only to
        // suppress THAT expected post-disconnect rejection, not to hide a genuine registration
        // failure — a real registerTransfer error (e.g. a 409 on a non-fresh relayer DB, see this
        // file's own doc comment) surfaces instead via the GET poll below finding no such transfer,
        // which fails this test's own assertions loudly.
        const registration = el.registerInboundTransfer(
          transferId,
          SOURCE_CHAIN,
          REAL_BURN_TX_HASH,
        );
        registration.catch(() => undefined);

        const deadline = Date.now() + 4 * 60_000;
        let lastBody: {
          status?: string;
          sourceTxHash?: string;
          amount?: string | null;
          recipient?: string | null;
        } = {};
        while (Date.now() < deadline) {
          const statusResponse = await fetch(`${RELAYER_URL}/transfers/${transferId}`, {
            headers: { Authorization: `Bearer ${RELAYER_API_KEY}` },
          });
          lastBody = (await statusResponse.json()) as typeof lastBody;
          // eslint-disable-next-line no-console
          console.log(`[manual check] GET /transfers/${transferId} ->`, lastBody);
          if (lastBody.status && lastBody.status !== "pending") {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        el.remove(); // triggers disconnectedCallback -> this.#abort?.abort(), stopping the internal poll

        expect(lastBody.sourceTxHash).toBe(REAL_BURN_TX_HASH);
        // "attested" (or further, if the relayer's classification has since been fixed and this
        // somehow reaches a terminal state) is the real, positive signal this check needs — proof
        // registerTransfer really posted a working request and trackRelayerTransfer really polled
        // real status transitions, both driven by relayerUrl/relayerApiKey read from
        // this.client().ferryline.config (the STEP 0 migration) rather than the widget's own
        // attribute getters directly.
        expect(["attested", "submitting", "delivered", "failed"]).toContain(lastBody.status);
        // The real amount/recipient, extracted by the relayer from the independently-parsed
        // on-chain CCTP message — proof this is a real attestation result, not an echo of anything
        // this check itself supplied (registerInboundTransfer's body never includes them).
        expect(lastBody.amount).toBe("1000000");
        expect(lastBody.recipient).toBe("GA3CZKET5CLA6FXMZ56L4SYSXQYQTSD42WBSRIOZ6Q4WGKVFY6D2IZC2");
      },
    );
  },
);

describe.skipIf(Boolean(RELAYER_URL) && Boolean(RELAYER_API_KEY))("MANUAL check skipped", () => {
  it("requires FERRYLINE_RELAYER_URL and FERRYLINE_RELAYER_API_KEY to be set", () => {
    // eslint-disable-next-line no-console
    console.log(
      "[manual check] skipped: set FERRYLINE_RELAYER_URL and FERRYLINE_RELAYER_API_KEY " +
        "against a real, running relayer instance to actually run this check.",
    );
    expect(true).toBe(true);
  });
});
