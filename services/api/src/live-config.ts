import {
  publicLiveSigningFields,
  readLiveSessionConfigFromEnv,
  type LiveSessionConfig,
} from "@shellfish/xrpl";
import { APPROVED_REP_POLICY_HASH } from "@shellfish/registry";

export type LiveRuntimeConfig = LiveSessionConfig & {
  borrowerAddress: string;
  brokerAddress: string;
  principalId: string;
  facilityId: string;
  principalMinor: string;
  maxStakeU: string;
  publicSigning: ReturnType<typeof publicLiveSigningFields>;
};

/** Parse LIVE env. Returns null when required seeds/IDs are missing (no invented defaults). */
export function loadLiveRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): LiveRuntimeConfig | null {
  const session = readLiveSessionConfigFromEnv(env);
  if (!session) return null;

  const publicSigning = publicLiveSigningFields(session);
  const principalMinor = env.SHELLFISH_PRINCIPAL_MINOR?.trim() || "200000";
  // Fresh LIVE portfolio (E=0, P=200000) quotes 560000000; keep headroom for max_stake.
  const maxStakeU = env.SHELLFISH_MAX_STAKE_U?.trim() || "760000000";

  return {
    ...session,
    borrowerAddress: publicSigning.borrower_account,
    brokerAddress: publicSigning.broker_account,
    principalId: `devnet:${publicSigning.borrower_account}`,
    facilityId: `devnet:${session.loanBrokerId}`,
    principalMinor,
    maxStakeU,
    publicSigning,
  };
}

export function livePortfolioSeed(config: LiveRuntimeConfig, clockIso: string) {
  const loanAsset = { mpt_issuance_id: config.loanMptIssuanceId };
  return {
    contract_version: "C0-REP-1" as const,
    model_version: "REP-CURVE-v0.2" as const,
    network: "devnet" as const,
    mode: "LIVE_DEVNET" as const,
    scenario_id: `live:${config.loanBrokerId.slice(0, 12)}`,
    clock: clockIso,
    money_scale: 100,
    rep_scale: 1000000,
    principal_id: config.principalId,
    loan_asset: loanAsset,
    rep_asset: {
      mpt_issuance_id: config.repIssuanceId,
      issuer: config.repIssuerAddress,
      asset_scale: 6,
    },
    policy_hash: APPROVED_REP_POLICY_HASH,
    evidence_version: `live-env:${config.borrowerAddress}`,
    facility: {
      facility_id: config.facilityId,
      lender_id: config.brokerAddress,
      asset: loanAsset,
      limit_minor: "10000000",
      version: 1,
    },
    opening: {
      active_principal_minor: "0",
      reserved_principal_minor: "0",
      defaulted_principal_minor: "0",
      facility_committed_minor: "0",
      facility_reserved_minor: "0",
      reputation: {
        seed_u: "1000000000",
        available_u: "1000000000",
        reserved_u: "0",
        bonded_u: "0",
        pending_return_u: "0",
        growth_u: "0",
        forfeited_u: "0",
        suspended: false,
        version: 1,
      },
    },
    opening_loans: [] as [],
  };
}
