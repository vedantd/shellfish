import { z } from "zod";
import { AssetRef, C0Context, Commitment, MoneyAmount, PaymentSchedule, RepSpendConsent } from "./c0.js";
export * from "./c0.js";
export * from "./commitments.js";
export * from "./credit.js";

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
  "DENY_REP_CONSENT",
  "DENY_REP_CAPACITY",
  "DENY_STAKE_PROOF",
  "DENY_SUSPENDED",
  "DENY_IDEMPOTENCY_CONFLICT",
  "NO_OFFER",
  "UNDERWRITING_DECLINED",
]);
export type DenialCode = z.infer<typeof DenialCode>;

/** PRD §6.1 — Evidence passport (Gita) */
export const EvidencePassport = z.object({
  ...C0Context.shape,
  subject_id: z.string(),
  issuer_id: z.string(),
  issued_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  evidence_version: z.string(),
  signature: z.string(),
  history: z.object({
    observation_start: z.string().datetime(),
    observation_end: z.string().datetime(),
    accepted_history_months: z.number().int().nonnegative(),
    on_time: z.number().int().nonnegative(),
    late: z.number().int().nonnegative(),
    default: z.number().int().nonnegative(),
  }),
  known_exposure: z.object({
    asset: AssetRef,
    amount: MoneyAmount,
    coverage: z.literal("participating_sources_only"),
    as_of: z.string().datetime(),
  }),
  optional_tier: z.string().optional(),
  evidence_hash: Commitment,
}).strict();
export type EvidencePassport = z.infer<typeof EvidencePassport>;

/** PRD §6.2 — Principal-issued borrowing mandate */
export const BorrowingMandate = z.object({
  ...C0Context.shape,
  mandate_id: z.string(),
  principal_id: z.string(),
  agent_id: z.string(),
  xrpl_borrower: z.string(),
  asset: AssetRef,
  max_principal: MoneyAmount,
  max_apr_bps: z.number().int().nonnegative(),
  max_total_fees: z.string(),
  max_term_days: z.number().int().positive(),
  allowed_purposes: z.array(z.string()),
  allowed_lenders: z.array(z.string()),
  expires_at: z.string().datetime(),
  nonce: z.string(),
  policy_version: z.string(),
  principal_signature: z.string(),
  mandate_hash: Commitment,
  rep_consent: RepSpendConsent,
}).strict();
export type BorrowingMandate = z.infer<typeof BorrowingMandate>;

/** PRD §6.3 — Lender-issued facility and firm offer */
export const LenderFacilityOffer = z.object({
  ...C0Context.shape,
  lender_id: z.string(),
  borrower_id: z.string(),
  facility_id: z.string(),
  facility_limit: z.string(),
  active_commitments: z.string(),
  reserved: z.string(),
  offer_id: z.string(),
  asset: AssetRef,
  principal: MoneyAmount,
  apr_bps: z.number().int().nonnegative(),
  rate_kind: z.literal("NOMINAL_ANNUAL"),
  term_days: z.number().int().positive(),
  fees: z.string(),
  purpose: z.string(),
  expires_at: z.string().datetime(),
  underwriting_policy: z.string(),
  approval_ref: z.string(),
  lender_signature: z.string(),
  schedule: PaymentSchedule,
  offer_hash: Commitment,
  commercial_terms_hash: Commitment,
}).strict();
export type LenderFacilityOffer = z.infer<typeof LenderFacilityOffer>;

export const CheckResult = z.enum(["PASS", "FAIL", "SKIP"]);
export type CheckResult = z.infer<typeof CheckResult>;

/** PRD §6.4 — Compatibility + authorization receipt */
export const AuthorizationReceipt = z.object({
  ...C0Context.shape,
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
  quote_bond_u: z.string().regex(/^(0|[1-9][0-9]*)$/),
  stake_proof_id: z.string().nullable(),
  policy_hash: Commitment,
  commercial_terms_hash: Commitment,
  prepared_tx_commitment: Commitment.nullable(),
  native_signing_permitted: z.boolean(),
}).strict().superRefine((receipt, ctx) => {
  if (receipt.mode === "SIMULATED_LOAN" && (receipt.native_signing_permitted || receipt.tx_hash !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Simulation cannot grant native signing or claim a native transaction hash" });
  }
  if (receipt.native_signing_permitted && (!receipt.reservation_id || !receipt.stake_proof_id || !receipt.prepared_tx_commitment || receipt.decision !== "ALLOW")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Native signing requires ALLOW, reservation, stake proof and prepared commitment" });
  }
});
export type AuthorizationReceipt = z.infer<typeof AuthorizationReceipt>;

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
    evidence_version: z.string(),
    underwriting_policy: z.string(),
  }),
]);
export type LenderEvaluateResult = z.infer<typeof LenderEvaluateResult>;

export const OfferMatchResult = z.object({
  ...C0Context.shape,
  compatible: z.boolean(),
  matched_offers: z.array(LenderFacilityOffer),
  permitted_principal: z.string().optional(),
  permitted_apr_bps: z.number().int().optional(),
  permitted_term_days: z.number().int().optional(),
  reason_codes: z.array(DenialCode).default([]),
  envelope_hash: z.string().optional(),
}).strict();
export type OfferMatchResult = z.infer<typeof OfferMatchResult>;

export const ExpectedDenialsFixture = z.object({
  ...C0Context.shape,
  baseline_scenario_id: z.string(),
  cases: z.array(z.object({
    id: z.string(), mutation: z.record(z.unknown()), expected_code: DenialCode,
    expected_new_reservations: z.literal(0), expected_native_signatures: z.literal(0),
    note: z.string(),
  }).strict()),
}).strict();
