import { Client, Wallet } from "xrpl";
import { createHash } from "node:crypto";
import { createNativeTransport, type NativeTransport } from "./transport.js";
import { aprBpsToXrplInterestRate } from "./index.js";
import {
  buildDualSignedLoanSet,
  submitDualSignedLoanSet,
  submitLoanPay,
  type LiveLoanTerms,
} from "./live-loan.js";
import { redeemRepStake } from "./live-rep.js";

const DEVNET_WS = "wss://s.devnet.rippletest.net:51233";

/** Native evidence fields required by Gita registry LIVE applyEvent. */
export type LiveNativeReceipt = {
  txHash: string;
  ledgerIndex: number;
  transactionIndex: number;
};

/** Injectable LIVE ledger surface — tests mock this; production uses createXrplLiveLedger. */
export type LiveLedger = {
  /** Persisted workers use this transport. Legacy high-level methods are not the native execution gate. */
  transport?: NativeTransport;
  redeemStake: (args: {
    amountU: string;
    requestHash: string;
  }) => Promise<LiveNativeReceipt>;
  originateLoanSet: (args: {
    principal: string;
    aprBps: number;
    termDays: number;
  }) => Promise<
    LiveNativeReceipt & {
      loanId: string;
      /** sha256:… commitment over prepared LoanSet fields */
      preparedCommitment: string;
    }
  >;
  repayLoanPay: (args: {
    loanId: string;
    amountValue: string;
  }) => Promise<LiveNativeReceipt>;
};

export type LiveSessionConfig = {
  wsUrl: string;
  borrowerSeed: string;
  brokerSeed: string;
  repIssuerSeed?: string;
  loanBrokerId: string;
  loanMptIssuanceId: string;
  /** Decimal exponent for atomic MPT units. Must match verified issuance metadata. */
  loanAssetScale?: number;
  repIssuanceId: string;
  repIssuerAddress: string;
  paymentTotal?: number;
  paymentIntervalSec?: number;
  gracePeriodSec?: number;
  loanOriginationFee?: string;
  loanServiceFee?: string;
};

export function readLiveSessionConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LiveSessionConfig | null {
  const borrowerSeed = env.SHELLFISH_BORROWER_SEED?.trim();
  const brokerSeed = env.SHELLFISH_BROKER_SEED?.trim();
  const loanBrokerId = env.SHELLFISH_LOAN_BROKER_ID?.trim();
  const loanMptIssuanceId = env.SHELLFISH_LOAN_MPT_ID?.trim();
  const repIssuanceId = env.SHELLFISH_REP_MPT_ID?.trim();
  const repIssuerAddress = env.SHELLFISH_REP_ISSUER_ACCOUNT?.trim();
  if (
    !borrowerSeed ||
    !brokerSeed ||
    !loanBrokerId ||
    !loanMptIssuanceId ||
    !repIssuanceId ||
    !repIssuerAddress
  ) {
    return null;
  }
  const wsUrl = env.XRPL_NETWORK?.trim() || env.XRPL_WS?.trim() || DEVNET_WS;
  return {
    wsUrl,
    borrowerSeed,
    brokerSeed,
    repIssuerSeed: env.SHELLFISH_REP_ISSUER_SEED?.trim(),
    loanBrokerId,
    loanMptIssuanceId,
    loanAssetScale: Number(env.SHELLFISH_LOAN_ASSET_SCALE?.trim() || "6"),
    repIssuanceId,
    repIssuerAddress,
    // Product C0 terms: 90-day bullet, zero fees (not playground 30-day / 100+10).
    paymentTotal: Number(env.SHELLFISH_PAYMENT_TOTAL?.trim() || "1"),
    paymentIntervalSec: Number(
      env.SHELLFISH_PAYMENT_INTERVAL_SEC?.trim() || String(90 * 86400),
    ),
    gracePeriodSec: Number(env.SHELLFISH_GRACE_PERIOD_SEC?.trim() || "604800"),
    loanOriginationFee: env.SHELLFISH_LOAN_ORIGINATION_FEE?.trim() || "0",
    loanServiceFee: env.SHELLFISH_LOAN_SERVICE_FEE?.trim() || "0",
  };
}

/** Public identifiers for network-signing-contract / UI — never includes seeds. */
export function publicLiveSigningFields(config: LiveSessionConfig): {
  endpoint: string;
  native_loan_asset: { mpt_issuance_id: string };
  loan_asset_scale: number;
  borrower_account: string;
  broker_account: string;
  broker_id: string;
  native_rep_asset: {
    mpt_issuance_id: string;
    issuer: string;
    asset_scale: 6;
  };
  required_signer_route: string;
  native_schedule: {
    payment_total: number;
    payment_interval_sec: number;
    grace_period_sec: number;
  };
  sdk_pin: string;
} {
  const borrower = Wallet.fromSeed(config.borrowerSeed);
  const broker = Wallet.fromSeed(config.brokerSeed);
  return {
    endpoint: config.wsUrl,
    native_loan_asset: { mpt_issuance_id: config.loanMptIssuanceId },
    loan_asset_scale: config.loanAssetScale ?? 6,
    borrower_account: borrower.classicAddress,
    broker_account: broker.classicAddress,
    broker_id: config.loanBrokerId,
    native_rep_asset: {
      mpt_issuance_id: config.repIssuanceId,
      issuer: config.repIssuerAddress,
      asset_scale: 6 as const,
    },
    required_signer_route: "shellfish.authorizeExactAction→stake→dualSignLoanSet",
    native_schedule: {
      payment_total: config.paymentTotal ?? 1,
      payment_interval_sec: config.paymentIntervalSec ?? 90 * 86400,
      grace_period_sec: config.gracePeriodSec ?? 604800,
    },
    sdk_pin: "5.3.0",
  };
}

function commitmentOf(value: unknown): string {
  const json = JSON.stringify(value);
  return `sha256:${createHash("sha256").update(json, "utf8").digest("hex")}`;
}

export async function createXrplLiveLedger(
  config: LiveSessionConfig,
): Promise<{ ledger: LiveLedger; client: Client; close: () => Promise<void> }> {
  const client = new Client(config.wsUrl);
  await client.connect();
  const borrower = Wallet.fromSeed(config.borrowerSeed);
  const broker = Wallet.fromSeed(config.brokerSeed);

  const ledger: LiveLedger = {
    transport: createNativeTransport(client, config),
    async redeemStake({ amountU }) {
      return redeemRepStake({
        client,
        borrower,
        issuerAddress: config.repIssuerAddress,
        issuanceId: config.repIssuanceId,
        amountU,
      });
    },
    async originateLoanSet({ principal, aprBps, termDays }) {
      const interval =
        config.paymentIntervalSec ??
        Math.max(1, Math.trunc(termDays) * 86400);
      const terms: LiveLoanTerms = {
        principal,
        interestRateTenthsBps: aprBpsToXrplInterestRate(aprBps),
        paymentTotal: config.paymentTotal ?? 1,
        paymentIntervalSec: interval,
        gracePeriodSec: config.gracePeriodSec ?? 604800,
        loanOriginationFee: config.loanOriginationFee ?? "0",
        loanServiceFee: config.loanServiceFee ?? "0",
      };
      const fullySigned = await buildDualSignedLoanSet({
        client,
        loanBroker: broker,
        borrower,
        loanBrokerID: config.loanBrokerId,
        terms,
      });
      const preparedCommitment = commitmentOf(fullySigned.prepared);
      const submitted = await submitDualSignedLoanSet({
        client,
        fullySignedTx: fullySigned.tx,
      });
      return { ...submitted, preparedCommitment };
    },
    async repayLoanPay({ loanId, amountValue }) {
      return submitLoanPay({
        client,
        borrower,
        loanId,
        mptIssuanceId: config.loanMptIssuanceId,
        amountValue,
      });
    },
  };

  return {
    ledger,
    client,
    close: async () => {
      await client.disconnect();
    },
  };
}
