import type { NetworkMode } from "@shellfish/schemas";

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
}

export interface LoanOriginateResult {
  mode: NetworkMode;
  txHash: string | null;
  loanId: string | null;
  validated: boolean;
  simulated: boolean;
}

/** Submit LoanSet (or labeled simulation). Stub — FR-10. */
export async function originateLoan(
  _req: LoanOriginateRequest,
): Promise<LoanOriginateResult> {
  throw new NotImplementedError("originateLoan");
}

/** Submit or observe LoanPay. Stub — FR-13. */
export async function repayLoan(_input: {
  loanId: string;
  amount: string;
  networkMode: NetworkMode;
}): Promise<{ txHash: string | null; simulated: boolean }> {
  throw new NotImplementedError("repayLoan");
}

export const packageOwner = "You" as const;
