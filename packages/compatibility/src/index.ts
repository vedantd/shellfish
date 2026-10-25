import {
  BorrowingMandate as MandateSchema,
  EvidencePassport as EvidenceSchema,
  LenderFacilityOffer as OfferSchema,
  canonicalJson,
  withoutFields,
  type BorrowingMandate,
  type DenialCode,
  type EvidencePassport,
  type LenderEvaluateResult,
  type LenderFacilityOffer,
  type OfferMatchResult,
} from "@shellfish/schemas";

// Shared schemas contain JSON values only. Return detached copies without a DOM/Node global.
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export class CompatibilityError extends Error {
  constructor(public readonly code: DenialCode | "COMPATIBILITY_NOT_CONFIGURED", message: string) {
    super(message);
    this.name = "CompatibilityError";
  }
}
export interface SeededApproval {
  offer: LenderFacilityOffer;
  evidenceHash: string;
  evidenceVersion: string;
}
export interface CompatibilityServiceOptions {
  approvedOffers: readonly SeededApproval[];
  hash: (value: unknown) => string;
  now?: () => Date;
}
export interface MatchOffersInput {
  mandate: BorrowingMandate;
  offers: readonly LenderFacilityOffer[];
  evidence?: EvidencePassport;
}

function amountMinor(value: string, code: DenialCode): bigint {
  if (!/^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(value)) throw new CompatibilityError(code, "Money must be a nonnegative exact two-decimal string");
  return BigInt(value.replace(".", ""));
}
const termsKeys = ["lender_id", "borrower_id", "facility_id", "offer_id", "asset", "principal", "apr_bps", "rate_kind", "term_days", "fees", "purpose", "expires_at", "schedule", "network"];
function validateOffer(raw: unknown, hash: (value: unknown) => string): LenderFacilityOffer {
  const parsed = OfferSchema.safeParse(raw);
  if (!parsed.success) throw new CompatibilityError("DENY_TRANSACTION_MISMATCH", "Offer does not match the shared schema");
  const offer = parsed.data;
  if (hash(withoutFields(offer, ["lender_signature", "offer_hash"])) !== offer.offer_hash ||
      hash(Object.fromEntries(Object.entries(offer).filter(([k]) => termsKeys.includes(k)))) !== offer.commercial_terms_hash)
    throw new CompatibilityError("DENY_TRANSACTION_MISMATCH", "Firm offer content changed");
  if (!Number.isSafeInteger(offer.schedule.payment_interval_seconds) || !Number.isSafeInteger(offer.term_days) ||
      offer.schedule.payment_interval_seconds * offer.schedule.payment_total !== offer.term_days * 86400)
    throw new CompatibilityError("DENY_TERM", "Payment schedule must equal the quoted term");
  if (amountMinor(offer.principal, "DENY_AMOUNT") === 0n) throw new CompatibilityError("DENY_AMOUNT", "Principal must be positive");
  amountMinor(offer.fees, "DENY_FEE");
  return clone(offer);
}
function validateEvidence(raw: unknown, now: Date, hash: (value: unknown) => string): EvidencePassport {
  const parsed = EvidenceSchema.safeParse(raw);
  if (!parsed.success) throw new CompatibilityError("DENY_TRANSACTION_MISMATCH", "Evidence does not match the shared schema");
  const evidence = parsed.data;
  if (hash(withoutFields(evidence, ["signature", "evidence_hash"])) !== evidence.evidence_hash)
    throw new CompatibilityError("DENY_TRANSACTION_MISMATCH", "Evidence content changed");
  const start = new Date(evidence.history.observation_start), end = new Date(evidence.history.observation_end);
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  const anniversary = new Date(start);
  anniversary.setUTCMonth(anniversary.getUTCMonth() + months);
  if (anniversary > end) months--;
  if (end < start || end.getTime() > Date.parse(evidence.issued_at) ||
      Date.parse(evidence.known_exposure.as_of) > Date.parse(evidence.issued_at) ||
      Date.parse(evidence.expires_at) <= Date.parse(evidence.issued_at) || evidence.history.accepted_history_months > months)
    throw new CompatibilityError("DENY_TRANSACTION_MISMATCH", "Accepted history exceeds its observation window");
  if (!Number.isFinite(now.getTime())) throw new TypeError("Invalid compatibility clock");
  if (Date.parse(evidence.issued_at) > now.getTime() || now.getTime() >= Date.parse(evidence.expires_at))
    throw new CompatibilityError("DENY_EVIDENCE_STALE", "Evidence is future-dated or expired");
  return evidence;
}
function decline(lenderId: string, evidenceVersion: string, code: DenialCode, explanation: string): LenderEvaluateResult {
  return { decision: "DECLINE", lender_id: lenderId, reason_codes: [code], human_explanation: explanation,
    evidence_version: evidenceVersion, underwriting_policy: lenderId === "lender-B" ? "lenderB-history-12m-demo-v1" : "seeded-approval-only-v1" };
}

export function createCompatibilityService(options: CompatibilityServiceOptions) {
  const now = options.now ?? (() => new Date());
  const hash = options.hash;
  const approvals = options.approvedOffers.map(seed => ({ offer: validateOffer(seed.offer, hash), evidenceHash: seed.evidenceHash, evidenceVersion: seed.evidenceVersion }));
  async function evaluateLender(lenderId: string, rawEvidence: EvidencePassport): Promise<LenderEvaluateResult> {
    let evidence: EvidencePassport;
    try { evidence = validateEvidence(rawEvidence, now(), hash); }
    catch (error) {
      if (error instanceof CompatibilityError) return decline(lenderId, rawEvidence.evidence_version ?? "unknown", error.code as DenialCode, error.message);
      throw error;
    }
    if (lenderId === "lender-B" && evidence.history.accepted_history_months < 12)
      return decline(lenderId, evidence.evidence_version, "UNDERWRITING_DECLINED", `Requires 12 months of accepted history. The evidence covers ${evidence.history.accepted_history_months} months.`);
    const seed = approvals.find(a => a.offer.lender_id === lenderId && a.offer.borrower_id === evidence.subject_id &&
      a.evidenceHash === evidence.evidence_hash && a.evidenceVersion === evidence.evidence_version &&
      a.offer.network === evidence.network && a.offer.mode === evidence.mode && a.offer.contract_version === evidence.contract_version &&
      a.offer.model_version === evidence.model_version && canonicalJson(a.offer.asset) === canonicalJson(evidence.known_exposure.asset));
    if (!seed) return decline(lenderId, evidence.evidence_version, "NO_OFFER", "No seeded lender approval is bound to this borrower and evidence version");
    if (now().getTime() >= Date.parse(seed.offer.expires_at)) return decline(lenderId, evidence.evidence_version, "DENY_OFFER_EXPIRED", "The seeded firm offer expired");
    return { decision: "APPROVE", offer: clone(seed.offer) };
  }
  function matchOffers(input: MatchOffersInput): OfferMatchResult {
    const parsed = MandateSchema.safeParse(input.mandate);
    if (!parsed.success) throw new CompatibilityError("DENY_TRANSACTION_MISMATCH", "Mandate does not match the shared schema");
    const mandate = parsed.data, instant = now();
    if (!Number.isFinite(instant.getTime())) throw new TypeError("Invalid compatibility clock");
    const context = { contract_version: mandate.contract_version, model_version: mandate.model_version, network: mandate.network, mode: mandate.mode };
    const fail = (codes: DenialCode[]): OfferMatchResult => ({ ...context, compatible: false, matched_offers: [], reason_codes: [...new Set(codes)] });
    if (hash(withoutFields(mandate, ["principal_signature", "mandate_hash"])) !== mandate.mandate_hash)
      return fail(["DENY_TRANSACTION_MISMATCH"]);
    if (instant.getTime() >= Date.parse(mandate.expires_at)) return fail(["DENY_SCOPE"]);
    if (!mandate.rep_consent.authorized) return fail(["DENY_REP_CONSENT"]);
    if (input.evidence) {
      try {
        const evidence = validateEvidence(input.evidence, instant, hash);
        if (evidence.subject_id !== mandate.principal_id) return fail(["DENY_IDENTITY"]);
        if (canonicalJson(evidence.known_exposure.asset) !== canonicalJson(mandate.asset)) return fail(["DENY_ASSET"]);
        if (evidence.network !== mandate.network || evidence.mode !== mandate.mode || evidence.model_version !== mandate.model_version || evidence.contract_version !== mandate.contract_version)
          return fail(["DENY_UNSUPPORTED_NETWORK"]);
      } catch (error) { if (error instanceof CompatibilityError) return fail([error.code as DenialCode]); throw error; }
    }
    const matched: LenderFacilityOffer[] = [], reasons: DenialCode[] = [];
    for (const rawOffer of input.offers) {
      try {
        const offer = validateOffer(rawOffer, hash);
        const codes: DenialCode[] = [];
        if (offer.borrower_id !== mandate.principal_id) codes.push("DENY_IDENTITY");
        if (offer.network !== mandate.network || offer.mode !== mandate.mode || offer.contract_version !== mandate.contract_version || offer.model_version !== mandate.model_version) codes.push("DENY_UNSUPPORTED_NETWORK");
        if (canonicalJson(offer.asset) !== canonicalJson(mandate.asset)) codes.push("DENY_ASSET");
        if (!mandate.allowed_lenders.includes(offer.lender_id)) codes.push("DENY_COUNTERPARTY");
        if (!mandate.allowed_purposes.includes(offer.purpose)) codes.push("DENY_PURPOSE");
        if (instant.getTime() >= Date.parse(offer.expires_at)) codes.push("DENY_OFFER_EXPIRED");
        if (amountMinor(offer.principal, "DENY_AMOUNT") > amountMinor(mandate.max_principal, "DENY_AMOUNT")) codes.push("DENY_AMOUNT");
        if (offer.apr_bps > mandate.max_apr_bps) codes.push("DENY_RATE");
        if (amountMinor(offer.fees, "DENY_FEE") > amountMinor(mandate.max_total_fees, "DENY_FEE")) codes.push("DENY_FEE");
        if (offer.term_days > mandate.max_term_days) codes.push("DENY_TERM");
        if (codes.length) reasons.push(...codes); else matched.push(offer);
      } catch (error) { if (error instanceof CompatibilityError) reasons.push(error.code as DenialCode); else throw error; }
    }
    if (!matched.length) return fail(reasons.length ? reasons : ["NO_OFFER"]);
    const selected = matched[0];
    const result: OfferMatchResult = { ...context, compatible: true, matched_offers: matched,
      permitted_principal: selected.principal, permitted_apr_bps: selected.apr_bps,
      permitted_term_days: selected.term_days, reason_codes: [] };
    return { ...result, envelope_hash: hash(result) };
  }
  return { evaluateLender, matchOffers };
}
export type CompatibilityService = ReturnType<typeof createCompatibilityService>;
let configured: CompatibilityService | undefined;
export function configureCompatibilityService(options: CompatibilityServiceOptions): CompatibilityService {
  configured = createCompatibilityService(options);
  return configured;
}
function service(): CompatibilityService {
  if (!configured) throw new CompatibilityError("COMPATIBILITY_NOT_CONFIGURED", "Configure explicit seeded lender approvals before use");
  return configured;
}
export async function evaluateLender(lenderId: string, evidence: EvidencePassport): Promise<LenderEvaluateResult> { return service().evaluateLender(lenderId, evidence); }
export function matchOffers(input: MatchOffersInput): OfferMatchResult { return service().matchOffers(input); }
export const packageOwner = "Gita" as const;
