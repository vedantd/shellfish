import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as S from "../packages/schemas/src/index.ts";

const dir = resolve(import.meta.dirname, "../fixtures");
const load = (name: string): unknown => JSON.parse(readFileSync(resolve(dir, name), "utf8"));
const policy = S.RepPolicyFixture.parse(load("rep-policy.json"));
const scenario = S.ScenarioFixture.parse(load("scenario.json"));
const evidence = S.EvidencePassport.parse(load("evidence-passport.json"));
const mandate = S.BorrowingMandate.parse(load("mandate.json"));
const offer = S.LenderFacilityOffer.parse(load("offer-lender-a.json"));
const match = S.OfferMatchResult.parse(load("offer-match.json"));
const reservation = S.ReservationFixture.parse(load("reservation.json"));
const receipt = S.AuthorizationReceipt.parse(load("authorization-receipt-allow.json"));
const bonds = S.BondCasesFixture.parse(load("rep-bond-cases.json"));
const execution = S.ExecutionCasesFixture.parse(load("execution-cases.json"));
const network = S.NetworkSigningContractFixture.parse(load("network-signing-contract.json"));
const summary = S.SeedSummaryFixture.parse(load("seed-summary.json"));
const denials = S.ExpectedDenialsFixture.parse(load("expected-denials.json"));

// Exact reference calculations validate vectors. They are not the application engine.
const bond = (e: bigint, p: bigint): bigint => 2000n * p + (2n * e * p + p * p + 249n) / 250n;
const cents = (amount: string): bigint => BigInt(amount.replace(".", ""));
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown): string => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
const omit = (value: object, keys: string[]): object => Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));

describe("C0-REP-1 fixture package", () => {
  const parsers = {
    "rep-policy.json": S.RepPolicyFixture, "scenario.json": S.ScenarioFixture,
    "evidence-passport.json": S.EvidencePassport, "mandate.json": S.BorrowingMandate,
    "offer-lender-a.json": S.LenderFacilityOffer, "lender-b-decline.json": S.LenderEvaluateResult,
    "offer-match.json": S.OfferMatchResult, "reservation.json": S.ReservationFixture,
    "authorization-receipt-allow.json": S.AuthorizationReceipt, "rep-bond-cases.json": S.BondCasesFixture,
    "execution-cases.json": S.ExecutionCasesFixture, "network-signing-contract.json": S.NetworkSigningContractFixture,
    "expected-denials.json": S.ExpectedDenialsFixture, "seed-summary.json": S.SeedSummaryFixture,
  };
  it("parses every JSON fixture with no uncovered files", () => {
    expect(readdirSync(dir).filter(n => n.endsWith(".json")).sort()).toEqual(Object.keys(parsers).sort());
    for (const [name, parser] of Object.entries(parsers)) expect(() => parser.parse(load(name)), name).not.toThrow();
  });
  it("shares principal, asset, network, model and policy references", () => {
    for (const item of [scenario, evidence, mandate, offer, match, reservation, receipt, bonds, execution, network, summary, denials]) {
      expect(item.contract_version).toBe("C0-REP-1");
      expect(item.model_version).toBe(policy.model_version);
      expect(item.network).toBe(scenario.network);
      expect(item.mode).toBe("SIMULATED_LOAN");
    }
    for (const asset of [evidence.known_exposure.asset, mandate.asset, offer.asset, reservation.request.asset, scenario.facility.asset, summary.asset])
      expect(asset).toEqual(scenario.loan_asset);
    for (const principal of [evidence.subject_id, mandate.principal_id, offer.borrower_id, reservation.request.principal_id])
      expect(principal).toBe(scenario.principal_id);
    expect(mandate.rep_consent.rep_asset).toEqual(scenario.rep_asset);
    for (const h of [scenario.policy_hash, mandate.rep_consent.policy_hash, receipt.policy_hash, reservation.request.policy_hash, reservation.quote.policy_hash])
      expect(h).toBe(hash(policy));
  });
  it("recomputes content commitments and separates native transaction commitments", () => {
    expect(evidence.evidence_hash).toBe(hash(omit(evidence, ["signature", "evidence_hash"])));
    expect(mandate.mandate_hash).toBe(hash(omit(mandate, ["principal_signature", "mandate_hash"])));
    expect(offer.offer_hash).toBe(hash(omit(offer, ["lender_signature", "offer_hash"])));
    const keys = ["lender_id", "borrower_id", "facility_id", "offer_id", "asset", "principal", "apr_bps", "rate_kind", "term_days", "fees", "purpose", "expires_at", "schedule", "network"];
    expect(offer.commercial_terms_hash).toBe(hash(Object.fromEntries(Object.entries(offer).filter(([k]) => keys.includes(k)))));
    expect(match.envelope_hash).toBe(hash(omit(match, ["envelope_hash"])));
    expect(reservation.payload_hash).toBe(hash(reservation.request));
    expect(reservation.request.mandate_hash).toBe(mandate.mandate_hash);
    expect(reservation.request.rep_asset).toEqual(mandate.rep_consent.rep_asset);
    expect(reservation.request.mode).toBe(scenario.mode);
    expect(reservation.request.contract_version).toBe(scenario.contract_version);
    expect(receipt.proposal_hash).toBe(reservation.payload_hash);
    expect(receipt.envelope_hash).toBe(match.envelope_hash);
    expect(receipt.commercial_terms_hash).toBe(offer.commercial_terms_hash);
    expect(reservation.request.commercial_terms_hash).toBe(offer.commercial_terms_hash);
    expect(network.commitments.request_payload_hash).toBe(reservation.payload_hash);
    expect(network.commitments.offer_hash).toBe(offer.offer_hash);
    expect(network.commitments.commercial_terms_hash).toBe(offer.commercial_terms_hash);
    expect(network.commitments.prepared_transaction_commitment).toBeNull();
    expect(network.commitments.final_signed_transaction_hash).toBeNull();
  });
  it("derives six history months and evaluates validity at the fixture clock", () => {
    const start = new Date(evidence.history.observation_start), end = new Date(evidence.history.observation_end);
    const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
    expect(end.getUTCDate()).toBe(start.getUTCDate());
    expect(months).toBe(6);
    expect(evidence.history.accepted_history_months).toBe(months);
    expect(months).toBeLessThan(12);
    for (const expiry of [evidence.expires_at, mandate.expires_at, offer.expires_at, reservation.request.expires_at])
      expect(Date.parse(scenario.clock)).toBeLessThan(Date.parse(expiry));
    expect(Date.parse(evidence.issued_at)).toBeLessThanOrEqual(Date.parse(scenario.clock));
    const decline = S.LenderEvaluateResult.parse(load("lender-b-decline.json"));
    expect(decline.decision).toBe("DECLINE");
    if (decline.decision === "DECLINE") expect(decline.evidence_version).toBe(evidence.evidence_version);
  });
  it("preserves firm terms and explicit REP consent", () => {
    expect(match.matched_offers).toEqual([offer]);
    expect(match.permitted_principal).toBe(offer.principal);
    expect(match.permitted_apr_bps).toBe(offer.apr_bps);
    expect(match.permitted_term_days).toBe(offer.term_days);
    expect(cents(offer.principal)).toBeLessThanOrEqual(cents(mandate.max_principal));
    expect(offer.apr_bps).toBeLessThanOrEqual(mandate.max_apr_bps);
    expect(offer.schedule.payment_interval_seconds * offer.schedule.payment_total).toBe(offer.term_days * 86400);
    expect(mandate.rep_consent.authorized).toBe(true);
    expect(BigInt(reservation.quote.bond_u)).toBeLessThanOrEqual(BigInt(mandate.rep_consent.max_stake_u));
  });
  it("backs opening exposure with original bonds and reconciles summary balances", () => {
    expect(scenario.opening_loans.reduce((n, l) => n + BigInt(l.principal_minor), 0n)).toBe(BigInt(scenario.opening.active_principal_minor));
    expect(scenario.opening_loans.reduce((n, l) => n + BigInt(l.original_bond_u), 0n)).toBe(BigInt(scenario.opening.reputation.bonded_u));
    for (const loan of scenario.opening_loans) expect(Date.parse(loan.maturity)).toBeGreaterThan(Date.parse(scenario.clock) + 90 * 86400000);
    expect(cents(evidence.known_exposure.amount)).toBe(BigInt(scenario.opening.active_principal_minor));
    expect(cents(offer.active_commitments)).toBe(BigInt(scenario.opening.facility_committed_minor));
    expect(cents(summary.known_exposure)).toBe(BigInt(scenario.opening.active_principal_minor));
    expect(summary.reputation.new_bond_u).toBe(reservation.quote.bond_u);
    expect(summary.reputation.available_after_reservation_u).toBe(reservation.after.reputation.available_u);
  });
  it("reserves both budgets and binds the synthetic issuer redemption", () => {
    expect(reservation.before).toEqual(scenario.opening);
    const b = BigInt(reservation.quote.bond_u), p = BigInt(reservation.request.principal_minor);
    expect(BigInt(reservation.before.reputation.available_u) - BigInt(reservation.after.reputation.available_u)).toBe(b);
    expect(BigInt(reservation.after.reputation.reserved_u) - BigInt(reservation.before.reputation.reserved_u)).toBe(b);
    expect(BigInt(reservation.after.reserved_principal_minor) - BigInt(reservation.before.reserved_principal_minor)).toBe(p);
    expect(BigInt(reservation.after.facility_reserved_minor) - BigInt(reservation.before.facility_reserved_minor)).toBe(p);
    const proof = execution.stake_proof;
    expect(receipt.reservation_id).toBe(reservation.reservation_id);
    expect(receipt.stake_proof_id).toBe(proof.proof_id);
    expect(proof.destination).toBe(scenario.rep_asset.issuer);
    expect(proof.rep_asset).toEqual(scenario.rep_asset);
    expect(proof.sender).toBe(mandate.xrpl_borrower);
    expect(proof.request_id).toBe(reservation.request.request_id);
    expect(proof.payload_hash).toBe(reservation.payload_hash);
    expect(proof.amount_u).toBe(reservation.quote.bond_u);
    expect(proof.validated).toBe(false);
    expect(proof.tx_hash).toBeNull();
    expect(proof.native_signing_permitted).toBe(false);
    expect(receipt.native_signing_permitted).toBe(false);
    expect(receipt.tx_hash).toBeNull();
    expect(network.native_ready).toBe(false);
  });
  it("rejects missing issuers, broken accounting and false native claims", () => {
    expect(S.AssetRef.safeParse({ currency: "USD" }).success).toBe(false);
    expect(S.AssetRef.safeParse({ currency: "XRP" }).success).toBe(true);
    expect(S.AssetRef.safeParse({ currency: "XRP", issuer: "someone" }).success).toBe(false);
    expect(S.AssetRef.safeParse({ mpt_issuance_id: "00619A08AEC89A7392F7140E381BB17563A6653F7FB221AB" }).success).toBe(true);
    expect(S.AssetRef.safeParse({ mpt_issuance_id: "invalid" }).success).toBe(false);
    expect(S.ReputationState.safeParse({ ...scenario.opening.reputation, available_u: "761000000" }).success).toBe(false);
    for (const amount of ["abc", "1.2", "-1", "01", ""]) expect(S.ReputationState.safeParse({ ...scenario.opening.reputation, available_u: amount }).success).toBe(false);
    expect(S.AuthorizationReceipt.safeParse({ ...receipt, native_signing_permitted: true }).success).toBe(false);
    expect(S.AuthorizationReceipt.safeParse({ ...receipt, tx_hash: "A".repeat(64) }).success).toBe(false);
  });
  it("changes request commitment after consent asset, mandate or execution mode changes", () => {
    const changed = { ...mandate, rep_consent: { ...mandate.rep_consent,
      rep_asset: { ...mandate.rep_consent.rep_asset, mpt_issuance_id: "sim:different-issuance" } } };
    const changedHash = hash(omit(changed, ["principal_signature", "mandate_hash"]));
    expect(changedHash).not.toBe(mandate.mandate_hash);
    expect(hash({ ...reservation.request, mandate_hash: changedHash, rep_asset: changed.rep_consent.rep_asset })).not.toBe(reservation.payload_hash);
    expect(hash({ ...reservation.request, mode: "LIVE_DEVNET" })).not.toBe(reservation.payload_hash);
  });
});

describe("approved curve and lifecycle contract vectors", () => {
  for (const c of bonds.quote_cases) it(`quotes ${c.case_id}`, () => {
    expect(bond(BigInt(c.exposure_minor), BigInt(c.principal_minor))).toBe(BigInt(c.expected_bond_u));
    expect(BigInt(c.expected_bond_u) <= BigInt(c.available_u)).toBe(c.expected_admit);
    expect(c.opening_bonds_u.reduce((n, v) => n + BigInt(v), 0n) + BigInt(c.available_u)).toBe(BigInt(policy.seed_u));
  });
  for (const c of bonds.race_cases) it(`isolates ${c.case_id}`, () => {
    expect(c.requests[0].mandate_id).not.toBe(c.requests[1].mandate_id);
    expect(c.requests[0].nonce).not.toBe(c.requests[1].nonce);
    const e = BigInt(c.exposure_minor), p1 = BigInt(c.requests[0].principal_minor), p2 = BigInt(c.requests[1].principal_minor);
    const first = bond(e, p1), second = bond(e + p1, p2);
    expect(first).toBe(BigInt(c.expected_first_bond_u));
    expect(second).toBe(BigInt(c.expected_second_bond_u));
    expect(second).toBeGreaterThan(bond(e, p2));
    expect(p1).toBeLessThanOrEqual(BigInt(c.facility_headroom_minor));
    expect(first).toBeLessThanOrEqual(BigInt(c.available_u));
    const facilityFits = p2 <= BigInt(c.facility_headroom_minor) - p1;
    const repFits = second <= BigInt(c.available_u) - first;
    expect(1 + Number(facilityFits && repFits)).toBe(c.expected_success_count);
    if (c.expected_second_reason === "DENY_CAPACITY") { expect(facilityFits).toBe(false); expect(repFits).toBe(true); }
    if (c.expected_second_reason === "DENY_REP_CAPACITY") { expect(facilityFits).toBe(true); expect(repFits).toBe(false); }
  });
  for (const c of execution.cases) it(`applies ${c.case_id}`, () => {
    const before = c.before.reputation, after = c.after.reputation, b = BigInt(c.original_bond_u);
    expect(BigInt(after.growth_u) - BigInt(before.growth_u)).toBe(BigInt(c.expected_growth_u));
    if (c.parent_case_id) expect(execution.cases.find(p => p.case_id === c.parent_case_id)?.after).toEqual(c.before);
    if (["STAKE_REDEEMED", "SUBMISSION_UNKNOWN"].includes(c.event)) expect(c.after).toEqual(c.before);
    if (c.event === "ORIGINATION_SUCCESS") {
      expect(BigInt(before.reserved_u) - BigInt(after.reserved_u)).toBe(b);
      expect(BigInt(after.bonded_u) - BigInt(before.bonded_u)).toBe(b);
      expect(after.available_u).toBe(before.available_u);
      expect(BigInt(c.after.active_principal_minor) - BigInt(c.before.active_principal_minor)).toBe(BigInt(reservation.request.principal_minor));
      expect(BigInt(c.before.reserved_principal_minor) - BigInt(c.after.reserved_principal_minor)).toBe(BigInt(reservation.request.principal_minor));
    }
    if (c.event === "PARTIAL_REPAYMENT") {
      expect(after.bonded_u).toBe(before.bonded_u);
      expect(after.available_u).toBe(before.available_u);
    }
    if (c.event === "FULL_REPAYMENT") {
      const numerator = c.reward_intervals.reduce((n, x) => n + BigInt(x.principal_minor) * BigInt(x.elapsed_seconds), 0n) * 1000000n;
      const raw = c.reward_eligible ? numerator / (100n * 5n * 100n * 2592000n) : 0n;
      const surviving = BigInt(before.seed_u) + BigInt(before.growth_u) - BigInt(before.forfeited_u);
      const gap = BigInt(policy.max_surviving_u) > surviving ? BigInt(policy.max_surviving_u) - surviving : 0n;
      const award = [raw, BigInt(c.reward_budget_remaining_u), gap].reduce((a, n) => a < n ? a : n);
      expect(BigInt(c.reward_budget_remaining_u) + BigInt(c.prior_30_day_awards_u)).toBe(BigInt(policy.rolling_reward_cap_u));
      expect(BigInt(c.expected_growth_u)).toBe(award);
      expect(BigInt(before.bonded_u) - BigInt(after.bonded_u)).toBe(b);
      expect(BigInt(after.pending_return_u) - BigInt(before.pending_return_u)).toBe(b + award);
      expect(after.available_u).toBe(before.available_u);
    }
    if (c.event === "DEFAULT") {
      expect(BigInt(before.bonded_u) - BigInt(after.bonded_u)).toBe(b);
      expect(BigInt(after.forfeited_u) - BigInt(before.forfeited_u)).toBe(b);
      expect(after.suspended).toBe(true);
      expect(after.available_u).toBe(before.available_u);
      expect(c.expected_growth_u).toBe("0");
      expect(BigInt(c.after.defaulted_principal_minor) - BigInt(c.before.defaulted_principal_minor)).toBe(BigInt(c.principal_reduction_minor));
    }
    if (["DEFAULT", "FULL_REPAYMENT", "PARTIAL_REPAYMENT"].includes(c.event))
      expect(BigInt(c.before.active_principal_minor) - BigInt(c.after.active_principal_minor)).toBe(BigInt(c.principal_reduction_minor));
    if (c.event === "CANCELLED_BEFORE_BURN") {
      expect(BigInt(after.available_u) - BigInt(before.available_u)).toBe(b);
      expect(BigInt(before.reserved_u) - BigInt(after.reserved_u)).toBe(b);
    }
    if (c.event === "FAILED_AFTER_BURN") {
      expect(after.available_u).toBe(before.available_u);
      expect(BigInt(after.pending_return_u) - BigInt(before.pending_return_u)).toBe(b);
      expect(BigInt(before.reserved_u) - BigInt(after.reserved_u)).toBe(b);
    }
    if (c.event === "RETURN_VALIDATED") expect(BigInt(after.available_u) - BigInt(before.available_u))
      .toBe(BigInt(before.pending_return_u) - BigInt(after.pending_return_u));
    expect(c.native_evidence).toBeNull();
  });
  it("separates retries from conflicts and consumed nonce replay", () => {
    expect(bonds.retry_cases.map(c => [c.relation, c.expected])).toEqual([
      ["IDENTICAL_RETRY", "RETURN_EXISTING"], ["KEY_PAYLOAD_CONFLICT", "DENY_IDEMPOTENCY_CONFLICT"], ["CONSUMED_NONCE", "DENY_REPLAY"],
    ]);
    for (const c of bonds.retry_cases) expect(c.expected_additional_reservations).toBe(0);
  });
});
