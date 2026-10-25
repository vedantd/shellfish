import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  attachLiveStakeProof,
  authorizeExactAction,
  verifyMandate,
} from "../packages/authorization/src/index.ts";
import { createRegistry, contentHash } from "../packages/registry/src/index.ts";
import {
  AuthorizationReceipt,
  BorrowingMandate,
  LenderFacilityOffer,
  ReservationFixture,
  ScenarioFixture,
} from "../packages/schemas/src/index.ts";

const require = createRequire(new URL("../services/api/package.json", import.meta.url));
const Database = require("better-sqlite3");
const root = resolve(import.meta.dirname, "..");
const load = (name: string) =>
  JSON.parse(readFileSync(resolve(root, "fixtures", name), "utf8"));

const scenario = ScenarioFixture.parse(load("scenario.json"));
const mandate = BorrowingMandate.parse(load("mandate.json"));
const offer = LenderFacilityOffer.parse(load("offer-lender-a.json"));
const reservation = ReservationFixture.parse(load("reservation.json"));
const match = load("offer-match.json") as { envelope_hash: string };
const clock = new Date(scenario.clock);

const connections: InstanceType<typeof Database>[] = [];
const folders: string[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(resolve(tmpdir(), "shellfish-auth-"));
  folders.push(dir);
  const db = new Database(resolve(dir, "t.db"));
  connections.push(db);
  const registry = createRegistry(db, { now: () => clock });
  registry.seedScenario(scenario, "sim:borrower-harbor-supply");
  return { registry };
}

function variant(label: string) {
  return {
    ...reservation.request,
    request_id: `req-auth-${label}`,
    idempotency_key: `idem-auth-${label}`,
    mandate_id: `mandate-auth-${label}`,
    nonce: `nonce-auth-${label}`,
  };
}

describe("authorization kernel", () => {
  it("verifyMandate accepts the C0 fixture mandate and rejects empty signature", () => {
    expect(verifyMandate(mandate)).toBe(true);
    expect(
      verifyMandate({ ...mandate, principal_signature: "" }),
    ).toBe(false);
  });

  it("ALLOW reserves once and returns reservation_id with null tx_hash", () => {
    const { registry } = setup();
    const request = variant("allow");
    const receipt = authorizeExactAction({
      mandate,
      offer,
      proposalHash: contentHash(request),
      evidenceFresh: true,
      reservationRequest: request,
      envelopeHash: match.envelope_hash,
      reserveRequest: (raw) => registry.reserveRequest(raw),
      now: clock,
    });
    const parsed = AuthorizationReceipt.parse(receipt);
    expect(parsed.decision).toBe("ALLOW");
    expect(parsed.reservation_id).toMatch(/^res:/);
    expect(parsed.tx_hash).toBeNull();
    expect(parsed.native_signing_permitted).toBe(false);
    expect(parsed.quote_bond_u).toBe("720000000");
    expect(parsed.mode).toBe("SIMULATED_LOAN");
  });

  it("DENY_AMOUNT for 3000 principal creates no reservation", () => {
    const { registry } = setup();
    const before = registry.getCreditStatus("facility-A-001");
    const receipt = authorizeExactAction({
      mandate,
      offer: { ...offer, principal: "3000.00" },
      proposalHash: contentHash(variant("amt")),
      evidenceFresh: true,
      reservationRequest: variant("amt"),
      reserveRequest: (raw) => registry.reserveRequest(raw),
      now: clock,
    });
    expect(receipt.decision).toBe("DENY");
    expect(receipt.reason_codes).toContain("DENY_AMOUNT");
    expect(receipt.reservation_id).toBeNull();
    expect(registry.getCreditStatus("facility-A-001")).toEqual(before);
  });

  it("DENY_RATE for 900 bps creates no reservation", () => {
    const { registry } = setup();
    const before = registry.getCreditStatus("facility-A-001");
    const receipt = authorizeExactAction({
      mandate,
      offer: { ...offer, apr_bps: 900 },
      proposalHash: contentHash(variant("rate")),
      evidenceFresh: true,
      reservationRequest: variant("rate"),
      reserveRequest: (raw) => registry.reserveRequest(raw),
      now: clock,
    });
    expect(receipt.decision).toBe("DENY");
    expect(receipt.reason_codes).toContain("DENY_RATE");
    expect(receipt.reservation_id).toBeNull();
    expect(registry.getCreditStatus("facility-A-001")).toEqual(before);
  });

  it("DENY_REPLAY when mandate nonce was already consumed", () => {
    const { registry } = setup();
    const first = variant("replay-1");
    authorizeExactAction({
      mandate,
      offer,
      proposalHash: contentHash(first),
      evidenceFresh: true,
      reservationRequest: first,
      reserveRequest: (raw) => registry.reserveRequest(raw),
      now: clock,
    });
    const second = {
      ...variant("replay-2"),
      nonce: first.nonce,
      mandate_id: first.mandate_id,
    };
    const receipt = authorizeExactAction({
      mandate,
      offer,
      proposalHash: contentHash(second),
      evidenceFresh: true,
      reservationRequest: second,
      reserveRequest: (raw) => registry.reserveRequest(raw),
      now: clock,
    });
    expect(receipt.decision).toBe("DENY");
    expect(receipt.reason_codes).toContain("DENY_REPLAY");
    expect(receipt.reservation_id).toBeNull();
  });

  it("attachLiveStakeProof permits native signing only on LIVE ALLOW", () => {
    const liveAllow = {
      ...AuthorizationReceipt.parse({
        contract_version: "C0-REP-1",
        model_version: "REP-CURVE-v0.2",
        network: "devnet",
        mode: "LIVE_DEVNET",
        request_id: "req-live-1",
        compatible: true,
        offer_id: "offer-live",
        mandate_id: "m-live",
        proposal_hash: "sha256:" + "ab".repeat(32),
        envelope_hash: null,
        decision: "ALLOW",
        reason_codes: [],
        checks: {
          identity: "PASS",
          lender_offer: "PASS",
          policy: "PASS",
          exposure: "PASS",
          nonce: "PASS",
        },
        reservation_id: "res:live-1",
        signature_state: "NOT_YET_SIGNED",
        xrpl_state: "NOT_SUBMITTED",
        tx_hash: null,
        decision_time: "2026-10-25T12:00:00Z",
        quote_bond_u: "560000000",
        stake_proof_id: null,
        policy_hash:
          "sha256:7145bfb7a2359fd64bcca981a56cfa776c4e95056641577b38c653ccf9b65773",
        commercial_terms_hash: "sha256:" + "cd".repeat(32),
        prepared_tx_commitment: null,
        native_signing_permitted: false,
      }),
    };
    const permitted = attachLiveStakeProof(liveAllow, {
      stakeProofId: "A".repeat(64),
      preparedTxCommitment: "sha256:" + "ef".repeat(32),
    });
    expect(permitted.native_signing_permitted).toBe(true);
    expect(permitted.stake_proof_id).toBe("A".repeat(64));
    expect(() =>
      attachLiveStakeProof(
        { ...liveAllow, mode: "SIMULATED_LOAN" },
        {
          stakeProofId: "A".repeat(64),
          preparedTxCommitment: "sha256:" + "ef".repeat(32),
        },
      ),
    ).toThrow(/LIVE_DEVNET/);
  });
});
