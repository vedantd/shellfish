/** Convert application APR bps → XRPL InterestRate (tenths of a bps). */
export function aprBpsToXrplInterestRate(aprBps: number): number {
  return aprBps * 10;
}

/** Convert XRPL InterestRate → application APR bps. */
export function xrplInterestRateToAprBps(interestRate: number): number {
  return Math.trunc(interestRate / 10);
}
