import type {
  AuthorizationReceipt,
  BorrowingMandate,
  DenialCode,
  LenderFacilityOffer,
} from "@shellfish/schemas";

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`[authorization] Not implemented: ${feature}`);
    this.name = "NotImplementedError";
  }
}

/** Minimal reserve surface — injected from Gita registry (no SQLite in this package). */
export type ReserveRequestFn = (raw: unknown) => {
  reservationId: string;
  requestId: string;
  originalBondU: string;
  payloadHash: string;
};

export type AuthorizeExactActionInput = {
  mandate: BorrowingMandate;
  offer: LenderFacilityOffer;
  proposalHash: string;
  evidenceFresh: boolean;
  /** Full atomic reservation request body for registry.reserveRequest */
  reservationRequest: unknown;
  envelopeHash?: string | null;
  /** Injected: registry.reserveRequest.bind(registry) */
  reserveRequest: ReserveRequestFn;
  /** Decision timestamp; tests pass fixture clock. */
  now?: Date;
};

function moneyToMinor(display: string): bigint {
  const normalized = display.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Invalid money display: ${display}`);
  }
  const negative = normalized.startsWith("-");
  const [whole, frac = ""] = (negative ? normalized.slice(1) : normalized).split(
    ".",
  );
  const cents = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function isoNow(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function requestIdOf(reservationRequest: unknown): string | null {
  if (
    reservationRequest &&
    typeof reservationRequest === "object" &&
    "request_id" in reservationRequest &&
    typeof (reservationRequest as { request_id: unknown }).request_id === "string"
  ) {
    return (reservationRequest as { request_id: string }).request_id;
  }
  return null;
}

/** Verify a principal-signed mandate (FR-02). */
export function verifyMandate(mandate: BorrowingMandate): boolean {
  if (!mandate.mandate_id || !mandate.principal_id || !mandate.agent_id) {
    return false;
  }
  if (!mandate.principal_signature || mandate.principal_signature.length < 4) {
    return false;
  }
  if (!mandate.nonce || !mandate.mandate_hash) return false;
  if (!mandate.rep_consent?.authorized) return false;
  if (Number.isNaN(Date.parse(mandate.expires_at))) return false;
  return true;
}

function baseChecks(): AuthorizationReceipt["checks"] {
  return {
    identity: "PASS",
    lender_offer: "PASS",
    policy: "PASS",
    exposure: "PASS",
    nonce: "PASS",
  };
}

/**
 * Deterministic ALLOW/DENY on exact proposed terms (FR-07).
 * Must never use an LLM for final permission.
 * Reserves facility+REP once before ALLOW via injected reserveRequest.
 */
export function authorizeExactAction(
  input: AuthorizeExactActionInput,
): AuthorizationReceipt {
  const now = input.now ?? new Date();
  const requestId = requestIdOf(input.reservationRequest) ?? input.offer.offer_id;
  const pass = baseChecks();

  const deny = (
    codes: DenialCode[],
    checks: AuthorizationReceipt["checks"],
  ): AuthorizationReceipt => ({
    contract_version: input.mandate.contract_version,
    model_version: input.mandate.model_version,
    network: input.mandate.network,
    mode: input.mandate.mode,
    request_id: requestId,
    compatible: false,
    offer_id: input.offer.offer_id,
    mandate_id: input.mandate.mandate_id,
    proposal_hash: input.proposalHash,
    envelope_hash: input.envelopeHash ?? null,
    decision: "DENY",
    reason_codes: codes,
    checks,
    reservation_id: null,
    signature_state: "DENIED",
    xrpl_state: "NOT_SUBMITTED",
    tx_hash: null,
    decision_time: isoNow(now),
    quote_bond_u: "0",
    stake_proof_id: null,
    policy_hash: input.mandate.rep_consent.policy_hash,
    commercial_terms_hash: input.offer.commercial_terms_hash,
    prepared_tx_commitment: null,
    native_signing_permitted: false,
  });

  if (!verifyMandate(input.mandate)) {
    return deny(["DENY_SIGNATURE"], { ...pass, identity: "FAIL" });
  }

  if (input.mandate.mode !== input.offer.mode) {
    return deny(["DENY_UNSUPPORTED_NETWORK"], {
      ...pass,
      lender_offer: "FAIL",
    });
  }

  if (input.offer.borrower_id !== input.mandate.principal_id) {
    return deny(["DENY_IDENTITY"], { ...pass, identity: "FAIL" });
  }

  if (!input.mandate.allowed_lenders.includes(input.offer.lender_id)) {
    return deny(["DENY_COUNTERPARTY"], { ...pass, lender_offer: "FAIL" });
  }

  if (JSON.stringify(input.offer.asset) !== JSON.stringify(input.mandate.asset)) {
    return deny(["DENY_ASSET"], { ...pass, lender_offer: "FAIL" });
  }

  if (!input.evidenceFresh) {
    return deny(["DENY_EVIDENCE_STALE"], { ...pass, policy: "FAIL" });
  }

  if (Date.parse(input.offer.expires_at) < now.getTime()) {
    return deny(["DENY_OFFER_EXPIRED"], { ...pass, lender_offer: "FAIL" });
  }

  if (Date.parse(input.mandate.expires_at) < now.getTime()) {
    return deny(["DENY_SCOPE"], { ...pass, identity: "FAIL" });
  }

  let offerMinor: bigint;
  let maxMinor: bigint;
  try {
    offerMinor = moneyToMinor(input.offer.principal);
    maxMinor = moneyToMinor(input.mandate.max_principal);
  } catch {
    return deny(["DENY_AMOUNT"], { ...pass, policy: "FAIL" });
  }

  if (offerMinor > maxMinor) {
    return deny(["DENY_AMOUNT"], { ...pass, policy: "FAIL" });
  }

  if (input.offer.apr_bps > input.mandate.max_apr_bps) {
    return deny(["DENY_RATE"], { ...pass, policy: "FAIL" });
  }

  if (input.offer.term_days > input.mandate.max_term_days) {
    return deny(["DENY_TERM"], { ...pass, policy: "FAIL" });
  }

  if (!input.mandate.allowed_purposes.includes(input.offer.purpose)) {
    return deny(["DENY_PURPOSE"], { ...pass, policy: "FAIL" });
  }

  try {
    if (moneyToMinor(input.offer.fees) > moneyToMinor(input.mandate.max_total_fees)) {
      return deny(["DENY_FEE"], { ...pass, policy: "FAIL" });
    }
  } catch {
    return deny(["DENY_FEE"], { ...pass, policy: "FAIL" });
  }

  try {
    const reserved = input.reserveRequest(input.reservationRequest);
    return {
      contract_version: input.mandate.contract_version,
      model_version: input.mandate.model_version,
      network: input.mandate.network,
      mode: input.mandate.mode,
      request_id: reserved.requestId,
      compatible: true,
      offer_id: input.offer.offer_id,
      mandate_id: input.mandate.mandate_id,
      proposal_hash: input.proposalHash || reserved.payloadHash,
      envelope_hash: input.envelopeHash ?? null,
      decision: "ALLOW",
      reason_codes: [],
      checks: pass,
      reservation_id: reserved.reservationId,
      signature_state: "NOT_YET_SIGNED",
      xrpl_state: "NOT_SUBMITTED",
      tx_hash: null,
      decision_time: isoNow(now),
      quote_bond_u: reserved.originalBondU,
      stake_proof_id:
        input.mandate.mode === "SIMULATED_LOAN"
          ? `sim:stake-proof-${reserved.requestId}`
          : null,
      policy_hash: input.mandate.rep_consent.policy_hash,
      commercial_terms_hash: input.offer.commercial_terms_hash,
      prepared_tx_commitment: null,
      native_signing_permitted: false,
    };
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: string }).code)
        : "DENY_CAPACITY";
    const allowed: DenialCode[] = [
      "DENY_CAPACITY",
      "DENY_REPLAY",
      "DENY_REP_CONSENT",
      "DENY_IDEMPOTENCY_CONFLICT",
      "DENY_SUSPENDED",
      "DENY_REP_CAPACITY",
    ];
    const denial = (allowed as string[]).includes(code)
      ? (code as DenialCode)
      : "DENY_CAPACITY";
    return deny([denial], {
      ...pass,
      exposure:
        denial === "DENY_CAPACITY" || denial === "DENY_REP_CAPACITY"
          ? "FAIL"
          : "PASS",
      nonce:
        denial === "DENY_REPLAY" || denial === "DENY_IDEMPOTENCY_CONFLICT"
          ? "FAIL"
          : "PASS",
    });
  }
}

export const packageOwner = "You" as const;
