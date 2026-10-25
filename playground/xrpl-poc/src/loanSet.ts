import {
  decode,
  signLoanSetByCounterparty,
  validate,
  type Client,
  type LoanSet,
  type Wallet,
} from "xrpl";

/**
 * InterestRate is annualized rate in 1/10th of a basis point.
 * Example: 5500 → 550 bps → 5.5% APR.
 */
export function interestRateTenthsBpsToAprPercent(interestRate: number): number {
  return interestRate / 1000;
}

export type LoanTerms = {
  principal: string;
  /** Tenths of a basis point (5500 = 5.5%). */
  interestRateTenthsBps: number;
  paymentTotal: number;
  paymentIntervalSec: number;
  gracePeriodSec: number;
  loanOriginationFee: string;
  loanServiceFee: string;
};

export function termsFromEnv(): LoanTerms {
  return {
    principal: process.env.PRINCIPAL?.trim() || "1000",
    interestRateTenthsBps: Number(
      process.env.INTEREST_RATE_TENTHS_BPS?.trim() || "5500",
    ),
    paymentTotal: Number(process.env.PAYMENT_TOTAL?.trim() || "1"),
    paymentIntervalSec: Number(
      process.env.PAYMENT_INTERVAL_SEC?.trim() || "2592000",
    ),
    gracePeriodSec: Number(process.env.GRACE_PERIOD_SEC?.trim() || "604800"),
    loanOriginationFee: process.env.LOAN_ORIGINATION_FEE?.trim() || "100",
    loanServiceFee: process.env.LOAN_SERVICE_FEE?.trim() || "10",
  };
}

export async function buildDualSignedLoanSet(args: {
  client: Client;
  loanBroker: Wallet;
  borrower: Wallet;
  loanBrokerID: string;
  terms: LoanTerms;
}): Promise<{ tx: LoanSet; hash: string; tx_blob: string }> {
  const { client, loanBroker, borrower, loanBrokerID, terms } = args;

  // Suppress autofill warning on LoanSet (same as official tutorial).
  const prevWarn = console.warn;
  console.warn = () => {};

  let loanSetTx: LoanSet;
  try {
    loanSetTx = await client.autofill({
      TransactionType: "LoanSet",
      Account: loanBroker.address,
      Counterparty: borrower.address,
      LoanBrokerID: loanBrokerID,
      PrincipalRequested: terms.principal,
      InterestRate: terms.interestRateTenthsBps,
      PaymentTotal: terms.paymentTotal,
      PaymentInterval: terms.paymentIntervalSec,
      GracePeriod: terms.gracePeriodSec,
      LoanOriginationFee: terms.loanOriginationFee,
      LoanServiceFee: terms.loanServiceFee,
    });
  } finally {
    console.warn = prevWarn;
  }

  console.log(
    `InterestRate ${terms.interestRateTenthsBps} = ${interestRateTenthsBpsToAprPercent(terms.interestRateTenthsBps)}% APR`,
  );

  // Account (broker) signs first; Counterparty (borrower) signs second.
  const brokerSigned = loanBroker.sign(loanSetTx);
  const brokerSignedTx = decode(brokerSigned.tx_blob) as LoanSet;
  const fullySigned = signLoanSetByCounterparty(borrower, brokerSignedTx);
  validate(fullySigned.tx);

  return fullySigned;
}

export function extractLoanId(meta: {
  AffectedNodes?: Array<Record<string, { LedgerEntryType?: string; LedgerIndex?: string }>>;
}): string | undefined {
  const node = meta.AffectedNodes?.find(
    (n) => n.CreatedNode?.LedgerEntryType === "Loan",
  );
  return node?.CreatedNode?.LedgerIndex;
}
