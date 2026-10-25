import { Client, Wallet } from "xrpl";

const HASH = /^[A-Fa-f0-9]{64}$/;

/**
 * Redeem REP stake: borrower Payment of non-transferable MPT to issuer.
 * Confirms validated tesSUCCESS before returning — submit ack alone is not enough.
 */
export async function redeemRepStake(args: {
  client: Client;
  borrower: Wallet;
  issuerAddress: string;
  issuanceId: string;
  amountU: string;
}): Promise<{ txHash: string; ledgerIndex: number; transactionIndex: number }> {
  if (!/^(0|[1-9][0-9]*)$/.test(args.amountU) || args.amountU === "0") {
    throw new Error("[xrpl] LIVE stake amountU must be a positive integer string");
  }

  const prepared = await args.client.autofill({
    TransactionType: "Payment",
    Account: args.borrower.address,
    Destination: args.issuerAddress,
    Amount: {
      mpt_issuance_id: args.issuanceId,
      value: args.amountU,
    },
    Flags: 0,
  });

  const submitted = await args.client.submitAndWait(prepared, {
    wallet: args.borrower,
  });
  const hash = submitted.result.hash;
  if (!hash || !HASH.test(hash)) {
    throw new Error("[xrpl] LIVE stake submission missing hash");
  }

  const confirmed = await args.client.request({
    command: "tx",
    transaction: hash,
    binary: false,
    api_version: 2,
  });
  const result = confirmed.result as {
    validated?: boolean;
    hash?: string;
    ledger_index?: number;
    meta?: { TransactionResult?: string; TransactionIndex?: number };
  };
  if (!result.validated) {
    throw new Error("[xrpl] LIVE stake not validated on ledger");
  }
  if (result.meta?.TransactionResult !== "tesSUCCESS") {
    throw new Error(
      `[xrpl] LIVE stake failed: ${result.meta?.TransactionResult ?? "unknown"}`,
    );
  }

  return {
    txHash: result.hash ?? hash,
    ledgerIndex: result.ledger_index ?? submitted.result.ledger_index ?? 0,
    transactionIndex:
      typeof result.meta?.TransactionIndex === "number"
        ? result.meta.TransactionIndex
        : 0,
  };
}
