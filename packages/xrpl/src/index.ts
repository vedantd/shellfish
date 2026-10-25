import type { NetworkMode, RepAssetRef } from "@shellfish/schemas";

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`[xrpl] Not implemented: ${feature}`);
    this.name = "NotImplementedError";
  }
}

/** Convert application APR bps → XRPL InterestRate (tenths of a bps). */
export function aprBpsToXrplInterestRate(aprBps: number): number {
  return aprBps * 10;
}

/** Convert XRPL InterestRate → application APR bps. */
export function xrplInterestRateToAprBps(interestRate: number): number {
  return Math.trunc(interestRate / 10);
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
}

/** Injected registry surface for SIMULATED_LOAN (no SQLite inside this package). */
export type SimOriginationRegistry = {
  getRequest: (requestId: string) => {
    reservationId: string;
    state: string;
    originalBondU: string;
    request: unknown;
    loanId: string | null;
  };
  applyEvent: (event: unknown) => Promise<unknown>;
  hashRequest: (request: unknown) => string;
  clockSeconds: () => number;
  borrowerAccount: string;
  repAsset: RepAssetRef;
};

/**
 * Submit LoanSet (or labeled simulation).
 * SIMULATED_LOAN consumes an existing reservation via applyEvent — never reserves again.
 */
export async function originateLoan(
  req: LoanOriginateRequest,
  sim?: SimOriginationRegistry,
): Promise<LoanOriginateResult> {
  if (req.networkMode === "LIVE_DEVNET") {
    throw new NotImplementedError(
      "originateLoan LIVE_DEVNET — use a later B-0002 slice / playground adapter",
    );
  }

  if (req.networkMode !== "SIMULATED_LOAN") {
    throw new NotImplementedError(`originateLoan unsupported mode ${req.networkMode}`);
  }

  if (!sim) {
    throw new Error("[xrpl] SIMULATED_LOAN originate requires injected registry deps");
  }

  if (!req.requestId || !req.reservationId) {
    throw new Error("[xrpl] originate requires requestId and reservationId from ALLOW");
  }

  const existing = sim.getRequest(req.requestId);
  if (existing.reservationId !== req.reservationId) {
    throw new Error("[xrpl] reservation_id does not match registry request");
  }
  if (existing.state !== "AWAITING_STAKE" && existing.state !== "STAKE_VALIDATED") {
    throw new Error(`[xrpl] cannot originate from state ${existing.state}`);
  }

  const occurredAt = sim.clockSeconds();
  const requestHash = sim.hashRequest(existing.request);

  if (existing.state === "AWAITING_STAKE") {
    await sim.applyEvent({
      eventId: `stake:${req.requestId}`,
      kind: "STAKE_VALIDATED",
      requestId: req.requestId,
      occurredAt,
      stake: {
        amountU: existing.originalBondU,
        repAsset: sim.repAsset,
        sender: sim.borrowerAccount,
        destination: sim.repAsset.issuer,
        requestHash,
        partialPayment: false,
      },
    });
  }

  const loanId = `loan:${req.requestId}`;
  const originEventId = `origin:${req.requestId}`;
  await sim.applyEvent({
    eventId: originEventId,
    kind: "ORIGINATION_VALIDATED",
    requestId: req.requestId,
    occurredAt,
    loan: {
      loanId,
      maturityAt: occurredAt + req.termDays * 86400,
      graceSeconds: 60,
    },
  });

  const after = sim.getRequest(req.requestId);
  return {
    mode: "SIMULATED_LOAN",
    txHash: null,
    loanId: after.loanId ?? loanId,
    validated: false,
    simulated: true,
    requestId: req.requestId,
    reservationId: req.reservationId,
  };
}

/** Submit or observe LoanPay. Simulated path applies REPAYMENT when deps provided. */
export async function repayLoan(input: {
  loanId: string;
  amount: string;
  networkMode: NetworkMode;
  requestId?: string;
  principalReductionMinor?: string;
  fullContractualRepayment?: boolean;
  sim?: SimOriginationRegistry & {
    originHash?: string;
    previousEventId?: string;
  };
}): Promise<{ txHash: string | null; simulated: boolean; loanId: string }> {
  if (input.networkMode === "LIVE_DEVNET") {
    throw new NotImplementedError("repayLoan LIVE_DEVNET");
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
        input.principalReductionMinor ?? String(Math.trunc(Number(input.amount) * 100)),
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
