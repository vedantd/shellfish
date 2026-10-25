import type { NetworkMode, RepAssetRef } from "@shellfish/schemas";
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
  if (existing.state !== "AWAITING_STAKE" && existing.state !== "STAKE_VALIDATED") {
    throw new Error(`[xrpl] cannot originate from state ${existing.state}`);
  }
  return existing;
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
      maturityAt: occurredAt + req.termDays * 86400,
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
  if (/^\d+$/.test(display)) return display;
  const n = Number(display);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[xrpl] invalid LIVE principal: ${display}`);
  }
  return String(Math.trunc(n));
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
    principal: principalUnits(req.principal),
    aprBps: req.aprBps,
    termDays: req.termDays,
  });

  const now = registry.clockSeconds();
  const maturityAt = now + req.termDays * 86400;
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
