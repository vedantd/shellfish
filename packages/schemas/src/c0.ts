import { z } from "zod";

// C0-REP-1 is a proposed producer/consumer contract until Vedant accepts it.
export const AtomicAmount = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const MoneyAmount = z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{2}$/);
export const Commitment = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const NetworkMode = z.enum(["LIVE_DEVNET", "SIMULATED_LOAN"]);
export type NetworkMode = z.infer<typeof NetworkMode>;
const CurrencyAssetRef = z.object({ currency: z.string().min(1), issuer: z.string().min(1).optional() })
  .strict().refine(a => a.currency === "XRP" ? a.issuer === undefined : a.issuer !== undefined,
    "An issued asset needs its issuer. Native XRP has no issuer.");
export const MptLoanAssetRef = z.object({ mpt_issuance_id: z.string().regex(/^[A-Fa-f0-9]{48}$/) }).strict();
export const AssetRef = z.union([CurrencyAssetRef, MptLoanAssetRef]);
export type AssetRef = z.infer<typeof AssetRef>;
export const RepAssetRef = z.object({
  mpt_issuance_id: z.string().min(1), issuer: z.string().min(1), asset_scale: z.literal(6),
}).strict();
export const C0Context = z.object({
  contract_version: z.literal("C0-REP-1"), model_version: z.literal("REP-CURVE-v0.2"),
  network: z.string().min(1), mode: NetworkMode,
}).strict();
export const ReputationState = z.object({
  seed_u: AtomicAmount, available_u: AtomicAmount, reserved_u: AtomicAmount,
  bonded_u: AtomicAmount, pending_return_u: AtomicAmount, growth_u: AtomicAmount,
  forfeited_u: AtomicAmount, suspended: z.boolean(), version: z.number().int().nonnegative(),
}).strict().refine(s => {
  const amounts = [s.seed_u, s.growth_u, s.available_u, s.reserved_u, s.bonded_u, s.pending_return_u, s.forfeited_u];
  if (!amounts.every(v => /^(0|[1-9][0-9]*)$/.test(v))) return false;
  return BigInt(s.seed_u) + BigInt(s.growth_u) === BigInt(s.available_u) + BigInt(s.reserved_u) +
    BigInt(s.bonded_u) + BigInt(s.pending_return_u) + BigInt(s.forfeited_u);
}, "REP conservation failed");
export const CreditSnapshot = z.object({
  active_principal_minor: AtomicAmount, reserved_principal_minor: AtomicAmount,
  defaulted_principal_minor: AtomicAmount,
  facility_committed_minor: AtomicAmount, facility_reserved_minor: AtomicAmount,
  reputation: ReputationState,
}).strict();
export const PaymentSchedule = z.object({
  kind: z.literal("BULLET"), payment_total: z.literal(1),
  payment_interval_seconds: z.number().int().positive(),
  native_acceptance: z.literal("PENDING_VEDANT"),
}).strict();
export const RepSpendConsent = z.object({
  authorized: z.boolean(), model_version: z.literal("REP-CURVE-v0.2"),
  policy_hash: Commitment, rep_asset: RepAssetRef, max_stake_u: AtomicAmount,
}).strict();
export const RepPolicyFixture = z.object({
  model_version: z.literal("REP-CURVE-v0.2"), rep_scale: z.literal(1000000),
  money_scale: z.literal(100), seed_u: AtomicAmount, max_surviving_u: AtomicAmount,
  rolling_reward_cap_u: AtomicAmount, rolling_window_seconds: z.literal(2592000),
  curve: z.object({ linear_numerator: z.literal(1), linear_denominator: z.literal(5),
    quadratic_numerator: z.literal(1), quadratic_denominator: z.literal(25000) }).strict(),
  reward: z.object({ rate_numerator: z.literal(1), rate_denominator: z.literal(100),
    base_numerator: z.literal(1), base_denominator: z.literal(5),
    period_seconds: z.literal(2592000) }).strict(),
  fixed_original_bond_until_full_repayment: z.literal(true),
  default_suspends_principal: z.literal(true),
}).strict();
export const ScenarioFixture = C0Context.extend({
  scenario_id: z.string(), clock: z.string().datetime(), provenance: z.literal("SYNTHETIC"),
  native_signing_permitted: z.literal(false), money_scale: z.literal(100),
  rep_scale: z.literal(1000000), principal_id: z.string(), loan_asset: AssetRef,
  rep_asset: RepAssetRef, policy_hash: Commitment, evidence_version: z.string(),
  facility: z.object({ facility_id: z.string(), lender_id: z.string(), asset: AssetRef,
    limit_minor: AtomicAmount, version: z.number().int().nonnegative() }).strict(),
  opening: CreditSnapshot,
  opening_loans: z.array(z.object({ loan_id: z.string(), principal_minor: AtomicAmount,
    original_bond_u: AtomicAmount, maturity: z.string().datetime(),
    provenance: z.literal("SYNTHETIC") }).strict()),
}).strict();
export const BondQuote = z.object({
  exposure_minor: AtomicAmount, principal_minor: AtomicAmount, bond_u: AtomicAmount,
  policy_hash: Commitment, exposure_version: z.number().int().nonnegative(),
}).strict();
export const ReservationFixture = C0Context.extend({
  reservation_id: z.string(), state: z.literal("AWAITING_STAKE"),
  request: z.object({ request_id: z.string(), idempotency_key: z.string(),
    contract_version: z.literal("C0-REP-1"), mode: NetworkMode,
    principal_id: z.string(), agent_id: z.string(), mandate_id: z.string(), nonce: z.string(),
    offer_id: z.string(), facility_id: z.string(), network: z.string(), asset: AssetRef,
    mandate_hash: Commitment, rep_asset: RepAssetRef,
    evidence_hash: Commitment, commercial_terms_hash: Commitment,
    model_version: z.literal("REP-CURVE-v0.2"), policy_hash: Commitment,
    principal_minor: AtomicAmount, max_stake_u: AtomicAmount, expires_at: z.string().datetime(),
  }).strict(),
  payload_hash: Commitment, quote: BondQuote, before: CreditSnapshot, after: CreditSnapshot,
}).strict();
export const BondCasesFixture = C0Context.extend({
  quote_cases: z.array(z.object({ case_id: z.string(), opening_bonds_u: z.array(AtomicAmount),
    exposure_minor: AtomicAmount, principal_minor: AtomicAmount, available_u: AtomicAmount,
    expected_bond_u: AtomicAmount, expected_admit: z.boolean() }).strict()),
  race_cases: z.array(z.object({ case_id: z.string(), facility_headroom_minor: AtomicAmount,
    exposure_minor: AtomicAmount, available_u: AtomicAmount,
    requests: z.array(z.object({ mandate_id: z.string(), nonce: z.string(),
      principal_minor: AtomicAmount }).strict()).length(2),
    expected_first_bond_u: AtomicAmount, expected_second_bond_u: AtomicAmount,
    expected_success_count: z.number().int().min(1).max(2),
    expected_second_reason: z.enum(["DENY_CAPACITY", "DENY_REP_CAPACITY", "ALLOW"]),
  }).strict()),
  retry_cases: z.array(z.object({ case_id: z.string(),
    relation: z.enum(["IDENTICAL_RETRY", "KEY_PAYLOAD_CONFLICT", "CONSUMED_NONCE"]),
    expected: z.enum(["RETURN_EXISTING", "DENY_IDEMPOTENCY_CONFLICT", "DENY_REPLAY"]),
    expected_additional_reservations: z.literal(0),
  }).strict()),
}).strict();
export const ExecutionCasesFixture = C0Context.extend({
  reservation_id: z.string(),
  stake_proof: z.object({ proof_id: z.string(), request_id: z.string(),
    network: z.string(), rep_asset: RepAssetRef, sender: z.string(), destination: z.string(),
    amount_u: AtomicAmount, payload_hash: Commitment, provenance: z.literal("SYNTHETIC"),
    simulated_verified: z.literal(true), validated: z.literal(false),
    tx_hash: z.null(), ledger_index: z.null(), native_signing_permitted: z.literal(false),
  }).strict(),
  cases: z.array(z.object({ case_id: z.string(),
    event: z.enum(["STAKE_REDEEMED", "ORIGINATION_SUCCESS", "SUBMISSION_UNKNOWN",
      "CANCELLED_BEFORE_BURN", "FAILED_AFTER_BURN", "FULL_REPAYMENT",
      "RETURN_VALIDATED", "DEFAULT", "PARTIAL_REPAYMENT"]),
    parent_case_id: z.string().nullable(), before: CreditSnapshot, after: CreditSnapshot,
    principal_reduction_minor: AtomicAmount, reward_intervals: z.array(z.object({
      principal_minor: AtomicAmount, elapsed_seconds: z.number().int().nonnegative(),
    }).strict()), reward_eligible: z.boolean(), reward_budget_remaining_u: AtomicAmount,
    prior_30_day_awards_u: AtomicAmount,
    expected_growth_u: AtomicAmount, original_bond_u: AtomicAmount,
    native_evidence: z.null(), state: z.enum(["AWAITING_STAKE", "RECONCILING", "ACTIVE",
      "CANCELLED", "RETURN_PENDING", "REPAID", "DEFAULTED"]),
  }).strict()),
}).strict();
export const NetworkSigningContractFixture = C0Context.extend({
  status: z.literal("AWAITING_VEDANT"), native_ready: z.literal(false),
  endpoint: z.null(), native_loan_asset: z.null(), borrower_account: z.null(),
  broker_id: z.null(), native_rep_asset: z.null(), required_signer_route: z.null(),
  native_schedule: z.null(), sdk_pin: z.literal("5.3.0"),
  commitments: z.object({ canonicalization: z.literal("SORTED_KEYS_JSON_UTF8_V1"),
    offer_hash: Commitment, commercial_terms_hash: Commitment, request_payload_hash: Commitment,
    prepared_transaction_commitment: z.null(), final_signed_transaction_hash: z.null(),
    prepared_fields_frozen_after_autofill: z.literal(true),
  }).strict(),
  missing_inputs: z.array(z.string()).min(1),
}).strict();
export const SeedSummaryFixture = C0Context.extend({
  scenario_id: z.string(), borrower: z.string(), clock: z.string().datetime(),
  provenance: z.literal("SYNTHETIC"), asset: AssetRef, known_exposure: MoneyAmount,
  lender_a: z.object({ facility_limit: MoneyAmount, committed: MoneyAmount,
    headroom: MoneyAmount, expected: z.string() }).strict(),
  lender_b: z.object({ expected: z.string() }).strict(),
  reputation: z.object({ seed_u: AtomicAmount, available_u: AtomicAmount,
    opening_bond_u: AtomicAmount, new_bond_u: AtomicAmount,
    available_after_reservation_u: AtomicAmount }).strict(),
  expected_flow: z.array(z.string()), native_signing_permitted: z.literal(false),
}).strict();

export type RepAssetRef = z.infer<typeof RepAssetRef>;
export type ReputationState = z.infer<typeof ReputationState>;
export type CreditSnapshot = z.infer<typeof CreditSnapshot>;
export type BondQuote = z.infer<typeof BondQuote>;
export type AtomicReservationRequest = z.infer<typeof ReservationFixture>["request"];
export type AtomicReservationExample = z.infer<typeof ReservationFixture>;
export type ExecutionOutcomeExample = z.infer<typeof ExecutionCasesFixture>["cases"][number];
