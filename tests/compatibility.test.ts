import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, withoutFields, type BorrowingMandate, type EvidencePassport, type LenderFacilityOffer } from "../packages/schemas/src/index.ts";
import { createCompatibilityService } from "../packages/compatibility/src/index.ts";
const load = <T>(name: string): T => JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures", name), "utf8")) as T;
const evidence = load<EvidencePassport>("evidence-passport.json");
const mandate = load<BorrowingMandate>("mandate.json");
const offer = load<LenderFacilityOffer>("offer-lender-a.json");
const now = () => new Date("2026-10-24T18:11:00Z");
const hash = (v: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(v)).digest("hex")}`;
const termsKeys = ["lender_id", "borrower_id", "facility_id", "offer_id", "asset", "principal", "apr_bps", "rate_kind", "term_days", "fees", "purpose", "expires_at", "schedule", "network"];
function issueOffer(next: LenderFacilityOffer): LenderFacilityOffer {
  next.commercial_terms_hash = hash(Object.fromEntries(Object.entries(next).filter(([k]) => termsKeys.includes(k))));
  next.offer_hash = hash(withoutFields(next, ["lender_signature", "offer_hash"]));
  return next;
}
function issueEvidence(next: EvidencePassport): EvidencePassport {
  next.evidence_hash = hash(withoutFields(next, ["signature", "evidence_hash"]));
  return next;
}
function issueMandate(next: BorrowingMandate): BorrowingMandate {
  next.mandate_hash = hash(withoutFields(next, ["principal_signature", "mandate_hash"]));
  return next;
}
const service = () => createCompatibilityService({ hash, now, approvedOffers: [{ offer, evidenceHash: evidence.evidence_hash, evidenceVersion: evidence.evidence_version }] });

describe("bounded seeded lender decisions", () => {
  it("returns A approval and B decline for the same evidence", async () => {
    const source = service();
    expect(await source.evaluateLender("lender-A", evidence)).toEqual({ decision: "APPROVE", offer });
    const decline = await source.evaluateLender("lender-B", evidence);
    expect(decline.decision).toBe("DECLINE");
    if (decline.decision === "DECLINE") expect(decline.reason_codes).toEqual(["UNDERWRITING_DECLINED"]);
  });
  it("does not approve an unknown borrower, changed evidence version, or unknown lender", async () => {
    const source = service();
    for (const changed of [issueEvidence({ ...structuredClone(evidence), subject_id: "unknown" }),
      issueEvidence({ ...structuredClone(evidence), evidence_version: "new-version" })]) {
      const result = await source.evaluateLender("lender-A", changed);
      expect(result.decision).toBe("DECLINE");
      if (result.decision === "DECLINE") expect(result.reason_codes).toContain("NO_OFFER");
    }
    expect((await source.evaluateLender("lender-unknown", evidence)).decision).toBe("DECLINE");
  });
  it("does not invent a B offer after the history threshold is met", async () => {
    const next = issueEvidence({ ...structuredClone(evidence), history: { ...evidence.history,
      observation_start: "2025-10-24T18:00:00Z", accepted_history_months: 12 } });
    const result = await service().evaluateLender("lender-B", next);
    expect(result.decision).toBe("DECLINE");
    if (result.decision === "DECLINE") expect(result.reason_codes).toEqual(["NO_OFFER"]);
  });
  it("declines stale, altered and inflated history evidence", async () => {
    const stale = issueEvidence({ ...structuredClone(evidence), expires_at: "2026-10-24T18:10:00Z" });
    const inflated = issueEvidence({ ...structuredClone(evidence), history: { ...evidence.history, accepted_history_months: 12 } });
    for (const [candidate, code] of [[stale, "DENY_EVIDENCE_STALE"], [inflated, "DENY_TRANSACTION_MISMATCH"],
      [{ ...evidence, optional_tier: "forged" }, "DENY_TRANSACTION_MISMATCH"]] as const) {
      const result = await service().evaluateLender("lender-A", candidate);
      expect(result.decision).toBe("DECLINE");
      if (result.decision === "DECLINE") expect(result.reason_codes).toContain(code);
    }
  });
  it("rejects a modified approved offer commitment", () => {
    expect(() => createCompatibilityService({ hash, now, approvedOffers: [{ offer: { ...offer, principal: "1999.00" },
      evidenceHash: evidence.evidence_hash, evidenceVersion: evidence.evidence_version }] })).toThrow("content changed");
  });
});

describe("exact firm offer matching", () => {
  it("reproduces the fixture envelope and preserves all offer terms", () => {
    const expected = load("offer-match.json");
    const result = service().matchOffers({ mandate, offers: [offer], evidence });
    expect(result).toEqual(expected);
    expect(result.matched_offers[0]).toEqual(offer);
  });
  const mutations: Array<[string, (o: LenderFacilityOffer) => void, string]> = [
    ["amount", o => { o.principal = "3000.00"; }, "DENY_AMOUNT"],
    ["rate", o => { o.apr_bps = 900; }, "DENY_RATE"],
    ["fees", o => { o.fees = "30.01"; }, "DENY_FEE"],
    ["term", o => { o.term_days = 91; o.schedule.payment_interval_seconds = 91 * 86400; }, "DENY_TERM"],
    ["issuer", o => { o.asset = { currency: "USD", issuer: "sim:different-issuer" }; }, "DENY_ASSET"],
    ["MPT issuance", o => { o.asset = { mpt_issuance_id: "00619A08AEC89A7392F7140E381BB17563A6653F7FB221AB" }; }, "DENY_ASSET"],
    ["borrower", o => { o.borrower_id = "other-borrower"; }, "DENY_IDENTITY"],
    ["lender", o => { o.lender_id = "lender-B"; }, "DENY_COUNTERPARTY"],
    ["purpose", o => { o.purpose = "unapproved-purpose"; }, "DENY_PURPOSE"],
    ["expiry", o => { o.expires_at = "2026-10-24T18:10:00Z"; }, "DENY_OFFER_EXPIRED"],
    ["network", o => { o.network = "testnet"; }, "DENY_UNSUPPORTED_NETWORK"],
    ["negative principal", o => { o.principal = "-1.00"; }, "DENY_TRANSACTION_MISMATCH"],
    ["negative fees", o => { o.fees = "-1.00"; }, "DENY_FEE"],
  ];
  for (const [name, mutate, code] of mutations) it(`rejects ${name} without rewriting it into an allowed offer`, () => {
    const changed = structuredClone(offer);
    mutate(changed);
    const issued = issueOffer(changed);
    const result = service().matchOffers({ mandate, offers: [issued], evidence });
    expect(result.compatible).toBe(false);
    expect(result.reason_codes).toContain(code);
    expect(result.matched_offers).toEqual([]);
    expect(issued).toEqual(changed);
  });
  it("rejects unsigned content mutations and a changed mandate", () => {
    expect(service().matchOffers({ mandate, offers: [{ ...offer, apr_bps: 900 }] }).reason_codes).toContain("DENY_TRANSACTION_MISMATCH");
    expect(service().matchOffers({ mandate: { ...mandate, max_principal: "9999.00" }, offers: [offer] }).reason_codes).toContain("DENY_TRANSACTION_MISMATCH");
  });
  it("checks evidence identity/freshness and principal REP consent", () => {
    const wrong = issueEvidence({ ...structuredClone(evidence), subject_id: "someone-else" });
    expect(service().matchOffers({ mandate, offers: [offer], evidence: wrong }).reason_codes).toContain("DENY_IDENTITY");
    const stale = issueEvidence({ ...structuredClone(evidence), expires_at: "2026-10-24T18:10:00Z" });
    expect(service().matchOffers({ mandate, offers: [offer], evidence: stale }).reason_codes).toContain("DENY_EVIDENCE_STALE");
    const noConsent = issueMandate({ ...structuredClone(mandate), rep_consent: { ...mandate.rep_consent, authorized: false } });
    expect(service().matchOffers({ mandate: noConsent, offers: [offer] }).reason_codes).toContain("DENY_REP_CONSENT");
  });
  it("keeps one valid lender offer despite other incompatible offers", () => {
    const bad = issueOffer({ ...structuredClone(offer), offer_id: "other", apr_bps: 900 });
    const result = service().matchOffers({ mandate, offers: [bad, offer], evidence });
    expect(result.compatible).toBe(true);
    expect(result.matched_offers).toEqual([offer]);
    expect(result.reason_codes).toEqual([]);
    expect(service().matchOffers({ mandate, offers: [] }).reason_codes).toEqual(["NO_OFFER"]);
  });
  it("compares large monetary strings without floating-point rounding", () => {
    const huge = issueOffer({ ...structuredClone(offer), principal: "9007199254740993.00" });
    const highMandate = issueMandate({ ...structuredClone(mandate), max_principal: "9007199254740992.99" });
    expect(service().matchOffers({ mandate: highMandate, offers: [huge] }).reason_codes).toContain("DENY_AMOUNT");
  });
});
