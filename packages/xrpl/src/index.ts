import type { NetworkMode, RepAssetRef, LenderFacilityOffer } from "@shellfish/schemas";
import { ReservationFixture, LenderFacilityOffer as OfferSchema, canonicalJson, withoutFields } from "@shellfish/schemas";
import type { LiveLedger } from "./live-session.js";
import {
  aprBpsToXrplInterestRate,
  xrplInterestRateToAprBps,
} from "./rates.js";

export { aprBpsToXrplInterestRate, xrplInterestRateToAprBps };
export type { LiveLedger, LiveSessionConfig } from "./live-session.js";
export {
  createXrplLiveLedger,
  publicLiveSigningFields,
  readLiveSessionConfigFromEnv,
} from "./live-session.js";
export {
  buildDualSignedLoanSet,
  extractLoanId,
  submitDualSignedLoanSet,
  submitLoanPay,
} from "./live-loan.js";
export { redeemRepStake } from "./live-rep.js";
export { createStructuralNativeVerifiers } from "./verifiers.js";

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`[xrpl] Not implemented: ${feature}`);
    this.name = "NotImplementedError";
  }
}

export interface LoanOriginateRequest {
  proposalHash: string;
  principal: string;
  aprBps: number;
  termDays: number;
  asset: string;
  networkMode: NetworkMode;
  /** Existing reservation from authorizeExactAction — required. */
  requestId: string;
  reservationId: string;
}

export interface LoanOriginateResult {
  mode: NetworkMode;
  txHash: string | null;
  loanId: string | null;
  validated: boolean;
  simulated: boolean;
  requestId: string;
  reservationId: string;
  stakeProofId?: string | null;
  preparedTxCommitment?: string | null;
}

/** Injected registry surface (no SQLite inside this package). */
export type OriginationRegistry = {
  getRequest: (requestId: string) => {
    reservationId: string;
    state: string;
    originalBondU: string;
    request: unknown;
    loanId: string | null;
    stakeHash?: string | null;
  };
  applyEvent: (event: unknown) => Promise<unknown>;
  hashRequest: (request: unknown) => string;
  /** Server-owned approved offer lookup. Never read this authority from a request body. */
  getApprovedOffer: (commercialTermsHash: string) => LenderFacilityOffer | undefined;
  clockSeconds: () => number;
  borrowerAccount: string;
  repAsset: RepAssetRef;
  /** Required for LIVE_DEVNET — mock in tests or createXrplLiveLedger in production. */
  live?: LiveLedger;
};

/** @deprecated Use OriginationRegistry */
export type SimOriginationRegistry = OriginationRegistry;

function assertReservation(
  req: LoanOriginateRequest,
  registry: OriginationRegistry,
): ReturnType<OriginationRegistry["getRequest"]> {
  if (!req.requestId || !req.reservationId) {
    throw new Error("[xrpl] originate requires requestId and reservationId from ALLOW");
  }
  const existing = registry.getRequest(req.requestId);
  if (existing.reservationId !== req.reservationId) {
    throw new Error("[xrpl] reservation_id does not match registry request");
  }
  if (!["AWAITING_STAKE", "STAKE_VALIDATED", "ACTIVE", "RETURN_PENDING", "REPAID", "DEFAULTED"].includes(existing.state)) {
    throw new Error(`[xrpl] cannot originate from state ${existing.state}`);
  }
  return existing;
}


/** Validate the exact persisted approval before any stake, signature or ledger call. */
function assertBoundTerms(
  req: LoanOriginateRequest,
  registry: OriginationRegistry,
  existing: ReturnType<OriginationRegistry["getRequest"]>,
): LenderFacilityOffer {
  const request = ReservationFixture.shape.request.parse(existing.request);
  const rawOffer = registry.getApprovedOffer(request.commercial_terms_hash);
  if (!rawOffer) throw new Error("[xrpl] approved commercial terms unavailable");
  const offer = OfferSchema.parse(rawOffer);
  const termsKeys = ["lender_id", "borrower_id", "facility_id", "offer_id", "asset", "principal", "apr_bps", "rate_kind", "term_days", "fees", "purpose", "expires_at", "schedule", "network"];
  const terms = Object.fromEntries(Object.entries(offer).filter(([key]) => termsKeys.includes(key)));
  if (registry.hashRequest(withoutFields(offer, ["lender_signature", "offer_hash"])) !== offer.offer_hash ||
      registry.hashRequest(terms) !== offer.commercial_terms_hash ||
      offer.commercial_terms_hash !== request.commercial_terms_hash ||
      req.proposalHash !== registry.hashRequest(request)) {
    throw new Error("[xrpl] approved commitment mismatch");
  }
  let requestedAsset: unknown;
  try { requestedAsset = JSON.parse(req.asset); }
  catch { throw new Error("[xrpl] invalid proposed asset"); }
  const contextKeys = ["contract_version", "model_version", "network", "mode"] as const;
  if (contextKeys.some(key => request[key] !== offer[key]) || request.mode !== req.networkMode ||
      request.offer_id !== offer.offer_id || request.facility_id !== offer.facility_id ||
      request.principal_id !== offer.borrower_id ||
      canonicalJson(request.asset) !== canonicalJson(offer.asset) ||
      canonicalJson(requestedAsset) !== canonicalJson(offer.asset) ||
      BigInt(request.principal_minor) !== BigInt(offer.principal.replace(".", "")) ||
      req.principal !== offer.principal || req.aprBps !== offer.apr_bps || req.termDays !== offer.term_days ||
      offer.schedule.payment_total * offer.schedule.payment_interval_seconds !== offer.term_days * 86400) {
    throw new Error("[xrpl] proposed terms do not match the reserved approval");
  }
  return offer;
}

function completedSimulation(
  req: LoanOriginateRequest,
  existing: ReturnType<OriginationRegistry["getRequest"]>,
): LoanOriginateResult | null {
  if (!existing.loanId) return null;
  return {
    mode: "SIMULATED_LOAN", txHash: null, loanId: existing.loanId,
    validated: false, simulated: true, requestId: req.requestId,
    reservationId: req.reservationId,
    stakeProofId: `sim:stake-proof-${req.requestId}`, preparedTxCommitment: null,
  };
}

/**
 * Submit LoanSet (or labeled simulation).
 * Consumes an existing reservation via applyEvent — never reserves again.
 */
export async function originateLoan(
  req: LoanOriginateRequest,
  registry?: OriginationRegistry,
): Promise<LoanOriginateResult> {
  if (!registry) {
    throw new Error("[xrpl] originate requires injected registry deps");
  }

  if (req.networkMode === "LIVE_DEVNET") {
    return originateLive(req, registry);
  }

  if (req.networkMode !== "SIMULATED_LOAN") {
    throw new NotImplementedError(`originateLoan unsupported mode ${req.networkMode}`);
  }

  const existing = assertReservation(req, registry);
  const offer = assertBoundTerms(req, registry, existing);
  const completed = completedSimulation(req, existing);
  if (completed) return completed;
  const occurredAt = registry.clockSeconds();
  const requestHash = registry.hashRequest(existing.request);

  if (existing.state === "AWAITING_STAKE") {
    await registry.applyEvent({
      eventId: `stake:${req.requestId}`,
      kind: "STAKE_VALIDATED",
      requestId: req.requestId,
      occurredAt,
      stake: {
        amountU: existing.originalBondU,
        repAsset: registry.repAsset,
        sender: registry.borrowerAccount,
        destination: registry.repAsset.issuer,
        requestHash,
        partialPayment: false,
      },
    });
  }

  const loanId = `loan:${req.requestId}`;
  const originEventId = `origin:${req.requestId}`;
  await registry.applyEvent({
    eventId: originEventId,
    kind: "ORIGINATION_VALIDATED",
    requestId: req.requestId,
    occurredAt,
    loan: {
      loanId,
      maturityAt: occurredAt + offer.schedule.payment_total * offer.schedule.payment_interval_seconds,
      graceSeconds: 60,
    },
  });

  const after = registry.getRequest(req.requestId);
  return {
    mode: "SIMULATED_LOAN",
    txHash: null,
    loanId: after.loanId ?? loanId,
    validated: false,
    simulated: true,
    requestId: req.requestId,
    reservationId: req.reservationId,
    stakeProofId: `sim:stake-proof-${req.requestId}`,
    preparedTxCommitment: null,
  };
}

function principalUnits(display: string): string {
  if (!/^(0|[1-9][0-9]*)(\.00)?$/.test(display)) {
    throw new Error("[xrpl] unsupported native principal precision; no truncation permitted");
  }
  const whole = display.split(".")[0];
  if (BigInt(whole) <= 0n) throw new Error("[xrpl] native principal must be positive");
  return whole;
}

function nativeEvidence(
  receipt: {
    txHash: string;
    ledgerIndex: number;
    transactionIndex: number;
  },
  transactionType: string,
) {
  return {
    txHash: receipt.txHash,
    ledgerIndex: receipt.ledgerIndex,
    transactionIndex: receipt.transactionIndex,
    validated: true as const,
    result: "tesSUCCESS" as const,
    transactionType,
  };
}

async function originateLive(
  req: LoanOriginateRequest,
  registry: OriginationRegistry,
): Promise<LoanOriginateResult> {
  if (!registry.live) {
    throw new Error(
      "[xrpl] LIVE_DEVNET originate requires injected live ledger (env wallets / mock)",
    );
  }

  const existing = assertReservation(req, registry);
  const offer = assertBoundTerms(req, registry, existing);
  if (existing.loanId) throw new Error("[xrpl] existing LIVE loan requires persisted outcome reconciliation");
  // Precision rejection must precede the irreversible stake redemption.
  const nativePrincipal = principalUnits(offer.principal);
  const requestHash = registry.hashRequest(existing.request);
  let stakeProofId: string | null = null;

  if (existing.state === "AWAITING_STAKE") {
    const stake = await registry.live.redeemStake({
      amountU: existing.originalBondU,
      requestHash,
    });
    stakeProofId = stake.txHash;
    await registry.applyEvent({
      eventId: `stake:${req.requestId}`,
      kind: "STAKE_VALIDATED",
      requestId: req.requestId,
      occurredAt: registry.clockSeconds(),
      native: nativeEvidence(stake, "Payment"),
      stake: {
        amountU: existing.originalBondU,
        repAsset: registry.repAsset,
        sender: registry.borrowerAccount,
        destination: registry.repAsset.issuer,
        requestHash,
        partialPayment: false,
      },
    });
  } else {
    const afterStake = registry.getRequest(req.requestId);
    stakeProofId = afterStake.stakeHash ?? null;
    if (!stakeProofId) {
      throw new Error("[xrpl] LIVE STAKE_VALIDATED missing stake hash");
    }
  }

  const afterStakeState = registry.getRequest(req.requestId);
  if (afterStakeState.state !== "STAKE_VALIDATED") {
    throw new Error(
      `[xrpl] LIVE refuse LoanSet: expected STAKE_VALIDATED, got ${afterStakeState.state}`,
    );
  }

  const originated = await registry.live.originateLoanSet({
    principal: nativePrincipal,
    aprBps: offer.apr_bps,
    termDays: offer.term_days,
  });

  const now = registry.clockSeconds();
  const maturityAt = now + offer.schedule.payment_total * offer.schedule.payment_interval_seconds;
  await registry.applyEvent({
    eventId: `origin:${req.requestId}`,
    kind: "ORIGINATION_VALIDATED",
    requestId: req.requestId,
    occurredAt: now,
    native: nativeEvidence(originated, "LoanSet"),
    loan: {
      loanId: originated.loanId,
      maturityAt,
      nextPaymentDueAt: maturityAt,
      graceSeconds: 604800,
    },
  });

  return {
    mode: "LIVE_DEVNET",
    txHash: originated.txHash,
    loanId: originated.loanId,
    validated: true,
    simulated: false,
    requestId: req.requestId,
    reservationId: req.reservationId,
    stakeProofId,
    preparedTxCommitment: originated.preparedCommitment,
  };
}

/** Submit or observe LoanPay. */
export async function repayLoan(input: {
  loanId: string;
  amount: string;
  networkMode: NetworkMode;
  requestId?: string;
  principalReductionMinor?: string;
  fullContractualRepayment?: boolean;
  sim?: OriginationRegistry & {
    originHash?: string;
    previousEventId?: string;
  };
}): Promise<{ txHash: string | null; simulated: boolean; loanId: string }> {
  if (input.networkMode === "LIVE_DEVNET") {
    if (!input.sim?.live) {
      throw new Error("[xrpl] LIVE_DEVNET repay requires injected live ledger");
    }
    const amountValue = principalUnits(input.amount);
    const paid = await input.sim.live.repayLoanPay({
      loanId: input.loanId,
      amountValue,
    });
    if (input.requestId) {
      const occurredAt = input.sim.clockSeconds();
      const originEventId = `origin:${input.requestId}`;
      await input.sim.applyEvent({
        eventId: `repay:${input.loanId}:${occurredAt}`,
        kind: "REPAYMENT",
        loanId: input.loanId,
        occurredAt,
        native: nativeEvidence(paid, "LoanPay"),
        repayment: {
          principalReductionMinor:
            input.principalReductionMinor ??
            String(Math.trunc(Number(input.amount) * 100)),
          fullContractualRepayment: input.fullContractualRepayment ?? true,
          onTime: true,
        },
        history: {
          complete: true,
          originHash: input.sim.originHash ?? paid.txHash.toUpperCase(),
          previousEventId: input.sim.previousEventId ?? originEventId,
        },
      });
    }
    return { txHash: paid.txHash, simulated: false, loanId: input.loanId };
  }

  if (!input.sim || !input.requestId) {
    throw new Error("[xrpl] SIMULATED_LOAN repay requires sim deps and requestId");
  }

  const occurredAt = input.sim.clockSeconds();
  const eventId = `repay:${input.loanId}:${occurredAt}`;
  const originEventId = `origin:${input.requestId}`;
  await input.sim.applyEvent({
    eventId,
    kind: "REPAYMENT",
    loanId: input.loanId,
    occurredAt,
    repayment: {
      principalReductionMinor:
        input.principalReductionMinor ??
        String(Math.trunc(Number(input.amount) * 100)),
      fullContractualRepayment: input.fullContractualRepayment ?? true,
      onTime: true,
    },
    history: {
      complete: true,
      originHash: input.sim.originHash ?? `sim:${originEventId}`,
      previousEventId: input.sim.previousEventId ?? originEventId,
    },
  });

  return { txHash: null, simulated: true, loanId: input.loanId };
}

export const packageOwner = "You" as const;
