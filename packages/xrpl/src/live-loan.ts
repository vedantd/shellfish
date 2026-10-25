import {
  Client,
  decode,
  signLoanSetByCounterparty,
  validate,
  Wallet,
  type LoanSet,
} from "xrpl";

/** InterestRate is annualized rate in 1/10th of a basis point (5500 → 5.5% APR). */
export type LiveLoanTerms = {
  principal: string;
  interestRateTenthsBps: number;
  paymentTotal: number;
  paymentIntervalSec: number;
  gracePeriodSec: number;
  loanOriginationFee: string;
  loanServiceFee: string;
};

export async function buildDualSignedLoanSet(args: {
  client: Client;
  loanBroker: Wallet;
  borrower: Wallet;
  loanBrokerID: string;
  terms: LiveLoanTerms;
}): Promise<{ tx: LoanSet; hash: string; tx_blob: string; prepared: LoanSet }> {
  const { client, loanBroker, borrower, loanBrokerID, terms } = args;

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

  const prepared = JSON.parse(JSON.stringify(loanSetTx)) as LoanSet;
  const brokerSigned = loanBroker.sign(loanSetTx);
  const brokerSignedTx = decode(brokerSigned.tx_blob) as LoanSet;
  const fullySigned = signLoanSetByCounterparty(borrower, brokerSignedTx);
  validate(fullySigned.tx);

  return { ...fullySigned, prepared };
}

export function extractLoanId(meta: unknown): string | undefined {
  if (!meta || typeof meta === "string") return undefined;
  const affected = (meta as { AffectedNodes?: unknown[] }).AffectedNodes;
  if (!Array.isArray(affected)) return undefined;
  for (const wrapper of affected) {
    if (!wrapper || typeof wrapper !== "object") continue;
    const created = (wrapper as { CreatedNode?: { LedgerEntryType?: string; LedgerIndex?: string } })
      .CreatedNode;
    if (created?.LedgerEntryType === "Loan") return created.LedgerIndex;
  }
  return undefined;
}

export async function submitDualSignedLoanSet(args: {
  client: Client;
  fullySignedTx: LoanSet;
}): Promise<{
  txHash: string;
  loanId: string;
  ledgerIndex: number;
  transactionIndex: number;
}> {
  const submitResponse = await args.client.submitAndWait(args.fullySignedTx);
  const meta = submitResponse.result.meta;
  if (!meta || typeof meta === "string") {
    throw new Error("[xrpl] LIVE LoanSet missing transaction meta");
  }
  if (meta.TransactionResult !== "tesSUCCESS") {
    throw new Error(`[xrpl] LIVE LoanSet failed: ${meta.TransactionResult}`);
  }
  const loanId = extractLoanId(meta);
  if (!loanId) {
    throw new Error("[xrpl] LIVE LoanSet succeeded but Loan ID missing from meta");
  }
  const txHash = submitResponse.result.hash;
  if (!txHash) {
    throw new Error("[xrpl] LIVE LoanSet missing hash");
  }
  const transactionIndex =
    typeof meta.TransactionIndex === "number" ? meta.TransactionIndex : 0;
  return {
    txHash,
    loanId,
    ledgerIndex: submitResponse.result.ledger_index ?? 0,
    transactionIndex,
  };
}

export async function submitLoanPay(args: {
  client: Client;
  borrower: Wallet;
  loanId: string;
  mptIssuanceId: string;
  amountValue: string;
}): Promise<{
  txHash: string;
  ledgerIndex: number;
  transactionIndex: number;
}> {
  const tx = await args.client.autofill({
    TransactionType: "LoanPay",
    Account: args.borrower.address,
    LoanID: args.loanId,
    Amount: {
      mpt_issuance_id: args.mptIssuanceId,
      value: args.amountValue,
    },
  });
  const submitResponse = await args.client.submitAndWait(tx, {
    wallet: args.borrower,
  });
  const meta = submitResponse.result.meta;
  if (!meta || typeof meta === "string") {
    throw new Error("[xrpl] LIVE LoanPay missing meta");
  }
  if (meta.TransactionResult !== "tesSUCCESS") {
    throw new Error(`[xrpl] LIVE LoanPay failed: ${meta.TransactionResult}`);
  }
  const txHash = submitResponse.result.hash;
  if (!txHash) {
    throw new Error("[xrpl] LIVE LoanPay missing hash");
  }
  const transactionIndex =
    typeof meta.TransactionIndex === "number" ? meta.TransactionIndex : 0;
  return {
    txHash,
    ledgerIndex: submitResponse.result.ledger_index ?? 0,
    transactionIndex,
  };
}
