import { z } from "zod";
import { AssetRef, AtomicAmount, C0Context, Commitment, CreditSnapshot, RepAssetRef } from "./c0.js";

export const CreditStatus = C0Context.extend({
  principal_id: z.string().min(1),
  asset: AssetRef,
  rep_asset: RepAssetRef,
  money_scale: AtomicAmount,
  rep_scale: z.literal(1000000),
  policy_hash: Commitment,
  observed_at: z.string().datetime(),
  coverage: z.literal("participating_sources_only"),
  facility: z.object({
    facility_id: z.string().min(1), lender_id: z.string().min(1),
    approved_limit_minor: AtomicAmount, committed_minor: AtomicAmount,
    reserved_minor: AtomicAmount, headroom_minor: AtomicAmount,
    version: z.number().int().nonnegative(),
  }).strict(),
  portfolio: CreditSnapshot,
  exposure_for_curve_minor: AtomicAmount,
}).strict();
export type CreditStatus = z.infer<typeof CreditStatus>;

export const CreditQuoteRequest = z.object({
  principal_minor: AtomicAmount.refine(s => /^(0|[1-9][0-9]*)$/.test(s) && BigInt(s) > 0n, "Principal must be positive"),
  max_stake_u: AtomicAmount.optional(),
}).strict();
export type CreditQuoteRequest = z.infer<typeof CreditQuoteRequest>;

export const CreditQuoteReason = z.enum(["DENY_SUSPENDED", "DENY_CAPACITY", "DENY_REP_CAPACITY", "DENY_REP_CONSENT"]);
export const CreditQuote = C0Context.extend({
  principal_id: z.string().min(1), facility_id: z.string().min(1), asset: AssetRef,
  policy_hash: Commitment, observed_at: z.string().datetime(),
  exposure_version: z.number().int().nonnegative(), facility_version: z.number().int().nonnegative(),
  exposure_before_minor: AtomicAmount, principal_minor: AtomicAmount, bond_u: AtomicAmount,
  available_rep_u: AtomicAmount, facility_headroom_minor: AtomicAmount,
  max_stake_u: AtomicAmount.nullable(), maximum_additional_principal_minor: AtomicAmount,
  fits_registry_limits: z.boolean(), reason_codes: z.array(CreditQuoteReason),
  grants_permission: z.literal(false), reservation_required: z.literal(true),
  quote_hash: Commitment,
}).strict();
export type CreditQuote = z.infer<typeof CreditQuote>;
