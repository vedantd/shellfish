import { contentHash, APPROVED_REP_POLICY_HASH } from "@shellfish/registry";
import type { LiveRuntimeConfig } from "./live-config.js";

/** Build LIVE_DEVNET mandate / offer / reservation request from env-backed config. */
export function buildLiveAuthMaterials(config: LiveRuntimeConfig, now: Date) {
  const asset = { mpt_issuance_id: config.loanMptIssuanceId };
  const repAsset = {
    mpt_issuance_id: config.repIssuanceId,
    issuer: config.repIssuerAddress,
    asset_scale: 6,
  };
  const expires = new Date(now.getTime() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  if (!/^[1-9][0-9]*$/.test(config.principalMinor)) throw new Error("LIVE_CONFIG invalid principal minor units");
  const minor = BigInt(config.principalMinor);
  const principalDisplay = `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
  const schedule = {
    kind: "BULLET" as const,
    payment_total: 1 as const,
    payment_interval_seconds: config.paymentIntervalSec ?? 90 * 86400,
    native_acceptance: "PENDING_VEDANT" as const,
  };
  // Do not rewrite the accepted 90-day, zero-fee commercial terms to fit env defaults.
  if (schedule.payment_interval_seconds * (config.paymentTotal ?? 1) !== 90 * 86400 || (config.paymentTotal ?? 1) !== 1 ||
      !/^(0|0\.0+)$/.test(config.loanOriginationFee ?? "0") || !/^(0|0\.0+)$/.test(config.loanServiceFee ?? "0")) {
    throw new Error("LIVE_CONFIG_TERMS_MISMATCH: select and accept exact native schedule and fees before authorization");
  }
  const offer = {
    lender_id: config.brokerAddress,
    borrower_id: config.principalId,
    facility_id: config.facilityId,
    facility_limit: "100000.00",
    active_commitments: "0.00",
    reserved: "0.00",
    offer_id: `offer-live-${config.loanBrokerId.slice(0, 8)}`,
    asset,
    principal: principalDisplay,
    apr_bps: 550,
    term_days: 90,
    fees: "0.00",
    purpose: "working_capital",
    expires_at: expires,
    underwriting_policy: "live-devnet-v1",
    approval_ref: "uw-live",
    lender_signature: "sig-live-lender-env",
    contract_version: "C0-REP-1" as const,
    model_version: "REP-CURVE-v0.2" as const,
    network: "devnet" as const,
    mode: "LIVE_DEVNET" as const,
    rate_kind: "NOMINAL_ANNUAL" as const,
    schedule,
    commercial_terms_hash: "",
    offer_hash: "",
  };

  const termsKeys = ["lender_id", "borrower_id", "facility_id", "offer_id", "asset", "principal", "apr_bps", "rate_kind", "term_days", "fees", "purpose", "expires_at", "schedule", "network"];
  offer.commercial_terms_hash = contentHash(Object.fromEntries(Object.entries(offer).filter(([key]) => termsKeys.includes(key))));
  offer.offer_hash = contentHash(Object.fromEntries(Object.entries(offer).filter(([key]) => !["lender_signature", "offer_hash"].includes(key))));

  const mandate = {
    mandate_id: `m-live-${config.borrowerAddress.slice(0, 8)}`,
    principal_id: config.principalId,
    agent_id: "agent:shellfish-live",
    xrpl_borrower: config.borrowerAddress,
    asset,
    max_principal: "10000.00",
    max_apr_bps: 600,
    max_total_fees: "30.00",
    max_term_days: 90,
    allowed_purposes: ["working_capital"],
    allowed_lenders: [config.brokerAddress],
    expires_at: expires,
    nonce: `nonce-live-${Date.now()}`,
    policy_version: "borrower-live-v1",
    principal_signature: "sig-live-principal-env",
    contract_version: "C0-REP-1" as const,
    model_version: "REP-CURVE-v0.2" as const,
    network: "devnet" as const,
    mode: "LIVE_DEVNET" as const,
    rep_consent: {
      authorized: true,
      model_version: "REP-CURVE-v0.2" as const,
      policy_hash: APPROVED_REP_POLICY_HASH,
      rep_asset: repAsset,
      max_stake_u: config.maxStakeU,
    },
    mandate_hash: "",
  };
  mandate.mandate_hash = contentHash(Object.fromEntries(Object.entries(mandate).filter(([key]) => !["principal_signature", "mandate_hash"].includes(key))));

  const reservationRequest = {
    request_id: `req-live-${Date.now().toString(36)}`,
    idempotency_key: `idem-live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    principal_id: config.principalId,
    contract_version: "C0-REP-1" as const,
    mode: "LIVE_DEVNET" as const,
    mandate_hash: mandate.mandate_hash,
    rep_asset: repAsset,
    agent_id: mandate.agent_id,
    mandate_id: mandate.mandate_id,
    nonce: mandate.nonce,
    offer_id: offer.offer_id,
    facility_id: config.facilityId,
    network: "devnet" as const,
    asset,
    evidence_hash: contentHash({ evidence: liveConfigEvidence(config) }),
    commercial_terms_hash: offer.commercial_terms_hash,
    model_version: "REP-CURVE-v0.2" as const,
    policy_hash: APPROVED_REP_POLICY_HASH,
    principal_minor: config.principalMinor,
    max_stake_u: config.maxStakeU,
    expires_at: expires,
  };

  return { mandate, offer, reservationRequest };
}

function liveConfigEvidence(config: LiveRuntimeConfig) {
  return {
    borrower: config.borrowerAddress,
    endpoint: config.wsUrl,
    broker_id: config.loanBrokerId,
  };
}
