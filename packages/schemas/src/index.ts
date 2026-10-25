import { z } from "zod";

/** Canonical denial codes from PRD §9.1 */
export const DenialCode = z.enum([
  "DENY_IDENTITY",
  "DENY_SIGNATURE",
  "DENY_SCOPE",
  "DENY_ASSET",
  "DENY_AMOUNT",
  "DENY_RATE",
  "DENY_FEE",
  "DENY_TERM",
  "DENY_PURPOSE",
  "DENY_COUNTERPARTY",
  "DENY_OFFER_EXPIRED",
  "DENY_EVIDENCE_STALE",
  "DENY_CAPACITY",
  "DENY_REPLAY",
  "DENY_NO_OVERLAP",
  "DENY_TRANSACTION_MISMATCH",
  "DENY_UNSUPPORTED_NETWORK",
  "NO_OFFER",
  "UNDERWRITING_DECLINED",
]);
export type DenialCode = z.infer<typeof DenialCode>;

export const AssetRef = z.object({
  currency: z.string(),
  issuer: z.string().optional(),
});
export type AssetRef = z.infer<typeof AssetRef>;

/** PRD §6.1 — Evidence passport (Gita) */
export const EvidencePassport = z.object({
  subject_id: z.string(),
  issuer_id: z.string(),
  issued_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  evidence_version: z.string(),
  signature: z.string(),
  history: z.object({
    on_time: z.number().int().nonnegative(),
    late: z.number().int().nonnegative(),
    default: z.number().int().nonnegative(),
  }),
  known_exposure: z.object({
    asset: z.string(),
    amount: z.string(),
    coverage: z.literal("participating_sources_only"),
    as_of: z.string().datetime(),
  }),
  optional_tier: z.string().optional(),
  evidence_hash: z.string(),
});
export type EvidencePassport = z.infer<typeof EvidencePassport>;

/** PRD §6.2 — Principal-issued borrowing mandate */
export const BorrowingMandate = z.object({
  mandate_id: z.string(),
  principal_id: z.string(),
  agent_id: z.string(),
  xrpl_borrower: z.string(),
  asset: AssetRef,
  max_principal: z.string(),
  max_apr_bps: z.number().int().nonnegative(),
  max_total_fees: z.string(),
  max_term_days: z.number().int().positive(),
  allowed_purposes: z.array(z.string()),
  allowed_lenders: z.array(z.string()),
  expires_at: z.string().datetime(),
  nonce: z.string(),
  policy_version: z.string(),
  principal_signature: z.string(),
});
export type BorrowingMandate = z.infer<typeof BorrowingMandate>;

/** PRD §6.3 — Lender-issued facility and firm offer */
export const LenderFacilityOffer = z.object({
  lender_id: z.string(),
  borrower_id: z.string(),
  facility_id: z.string(),
  facility_limit: z.string(),
  active_commitments: z.string(),
  reserved: z.string(),
  offer_id: z.string(),
  asset: z.string(),
  principal: z.string(),
  apr_bps: z.number().int().nonnegative(),
  term_days: z.number().int().positive(),
  fees: z.string(),
  purpose: z.string(),
  expires_at: z.string().datetime(),
  underwriting_policy: z.string(),
  approval_ref: z.string(),
  lender_signature: z.string(),
});
export type LenderFacilityOffer = z.infer<typeof LenderFacilityOffer>;

export const CheckResult = z.enum(["PASS", "FAIL", "SKIP"]);
export type CheckResult = z.infer<typeof CheckResult>;

/** PRD §6.4 — Compatibility + authorization receipt */
export const AuthorizationReceipt = z.object({
  request_id: z.string(),
  compatible: z.boolean(),
  offer_id: z.string().nullable(),
  mandate_id: z.string().nullable(),
  proposal_hash: z.string().nullable(),
  envelope_hash: z.string().nullable(),
  decision: z.enum(["ALLOW", "DENY"]),
  reason_codes: z.array(DenialCode),
  checks: z.object({
    identity: CheckResult,
    lender_offer: CheckResult,
    policy: CheckResult,
    exposure: CheckResult,
    nonce: CheckResult,
  }),
  reservation_id: z.string().nullable(),
  signature_state: z.enum([
    "NOT_YET_SIGNED",
    "SIGNATURE_ISSUED",
    "DENIED",
  ]),
  xrpl_state: z.enum([
    "NOT_SUBMITTED",
    "SUBMITTED",
    "VALIDATED_ACTIVE",
    "FAILED",
    "RECONCILING",
    "SIMULATED",
  ]),
  tx_hash: z.string().nullable(),
  decision_time: z.string().datetime(),
});
export type AuthorizationReceipt = z.infer<typeof AuthorizationReceipt>;

export const NetworkMode = z.enum(["LIVE_DEVNET", "SIMULATED_LOAN"]);
export type NetworkMode = z.infer<typeof NetworkMode>;

export const LenderEvaluateResult = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("APPROVE"),
    offer: LenderFacilityOffer,
  }),
  z.object({
    decision: z.literal("DECLINE"),
    lender_id: z.string(),
    reason_codes: z.array(DenialCode),
    human_explanation: z.string(),
  }),
]);
export type LenderEvaluateResult = z.infer<typeof LenderEvaluateResult>;

export const OfferMatchResult = z.object({
  compatible: z.boolean(),
  matched_offers: z.array(LenderFacilityOffer),
  permitted_principal: z.string().optional(),
  permitted_apr_bps: z.number().int().optional(),
  permitted_term_days: z.number().int().optional(),
  reason_codes: z.array(DenialCode).default([]),
  envelope_hash: z.string().optional(),
});
export type OfferMatchResult = z.infer<typeof OfferMatchResult>;
