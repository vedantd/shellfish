const apiBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://127.0.0.1:3001";

export { apiBase };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.code === "string" ? body.code : undefined;
    const message =
      (typeof body.message === "string" && body.message) ||
      code ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

export type NetworkInfo = {
  mode: string;
  live_ready?: boolean;
  public_signing?: unknown;
  explorer_base?: string;
};

export type Mandate = {
  mandate_id: string;
  principal_id: string;
  agent_id: string;
  xrpl_borrower: string;
  asset: { currency?: string; issuer?: string; mpt_issuance_id?: string };
  max_principal: string;
  max_apr_bps: number;
  max_term_days: number;
  allowed_purposes: string[];
  mandate_hash?: string;
  mode: string;
  network: string;
  [key: string]: unknown;
};

export type EvidencePassport = {
  subject_id: string;
  known_exposure?: {
    amount?: string;
    asset?: unknown;
    coverage?: string;
    as_of?: string;
  };
  history?: {
    observation_start?: string;
    observation_end?: string;
    accepted_history_months?: number;
  };
  evidence_hash?: string;
  mode: string;
  [key: string]: unknown;
};

export type LenderOffer = {
  offer_id: string;
  lender_id: string;
  principal: string;
  apr_bps: number;
  term_days: number;
  fees?: string;
  purpose?: string;
  asset?: unknown;
  commercial_terms_hash?: string;
  offer_hash?: string;
  [key: string]: unknown;
};

export type LenderEvaluateResult =
  | { decision: "APPROVE"; offer: LenderOffer }
  | {
      decision: "DECLINE";
      lender_id: string;
      reason_codes: string[];
      human_explanation?: string;
    };

export type AuthReceipt = {
  decision: string;
  reservation_id: string | null;
  request_id: string;
  reason_codes: string[];
  quote_bond_u?: string;
  mode: string;
  tx_hash: string | null;
  native_signing_permitted?: boolean;
  proposal_hash: string | null;
  stake_proof_id?: string | null;
  offer_id?: string;
  mandate_id?: string;
};

export type OriginateResult = {
  simulated?: boolean;
  validated?: boolean;
  txHash?: string | null;
  loanId?: string | null;
  explorer?: string | null;
  message?: string;
  code?: string;
  mode?: string;
};

export function formatAsset(asset: Mandate["asset"] | undefined): string {
  if (!asset) return "—";
  if (asset.mpt_issuance_id) return `MPT ${asset.mpt_issuance_id.slice(0, 12)}…`;
  if (asset.currency && asset.issuer) return `${asset.currency} · ${asset.issuer}`;
  if (asset.currency) return asset.currency;
  return JSON.stringify(asset);
}
