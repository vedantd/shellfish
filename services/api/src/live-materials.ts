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
  const principalDisplay = (Number(config.principalMinor) / 100).toFixed(2);
  const schedule = {
    kind: "BULLET" as const,
    payment_total: 1 as const,
    payment_interval_seconds: config.paymentIntervalSec ?? 2592000,
    native_acceptance: "PENDING_VEDANT" as const,
  };
  const commercial = {
    principal: principalDisplay,
    apr_bps: 550,
    term_days: 90,
    fees: "0.00",
    schedule,
    asset,
  };
  const commercial_terms_hash = contentHash(commercial);
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
    commercial_terms_hash,
    offer_hash: contentHash({ commercial_terms_hash, facility_id: config.facilityId }),
  };

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
    mandate_hash: contentHash({
      principal_id: config.principalId,
      asset,
      max_principal: "10000.00",
    }),
  };

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
    commercial_terms_hash,
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
