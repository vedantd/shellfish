import { Client, Wallet, decode, encode, hashes, signLoanSetByCounterparty, validate, type LoanSet, type Transaction, type SubmittableTransaction } from "xrpl";
import { canonicalJson } from "@shellfish/schemas";
import type { LiveSessionConfig } from "./live-session.js";

export type NativeRole = "borrower" | "broker" | "repIssuer";
export interface SignedNativeTransaction {
  signedBlob: string;
  attemptHash: string;
  preparedFields: Record<string, unknown>;
  sequence: number;
  lastLedgerSequence: number;
}
export interface NativeTransaction extends Record<string, unknown> {
  hash: string;
  validated: true;
  ledger_index: number;
  tx_json: Record<string, unknown>;
  meta: { TransactionResult: string; TransactionIndex: number; AffectedNodes?: unknown[] };
  close_time_iso?: string;
  date?: number;
}
export interface NativeTransport {
  addresses: { borrower: string; broker: string; repIssuer: string };
  config: LiveSessionConfig;
  prepareTransaction(role: NativeRole, fields: Record<string, unknown>): Promise<Record<string, unknown>>;
  signTransaction(role: NativeRole, prepared: Record<string, unknown>): SignedNativeTransaction;
  signLoanTransaction(prepared: Record<string, unknown>): SignedNativeTransaction;
  submitSaved(signedBlob: string): Promise<void>;
  getValidatedTx(hash: string): Promise<NativeTransaction | null>;
  getValidatedLedger(): Promise<{ index: number; unixTime: number; networkId: number }>;
  getAccountSequence(account: string): Promise<number>;
  request(input: Record<string, unknown>): Promise<{ result: Record<string, unknown> }>;
}

const HASH = /^[A-Fa-f0-9]{64}$/;
const epoch = 946684800;
export function signatureFreeFields(raw: Record<string, unknown>): Record<string, unknown> {
  const { TxnSignature: _signature, CounterpartySignature: _counterparty, Signers: _signers, ...fields } = raw;
  return fields;
}
export function normalizePaymentAliases(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.TransactionType !== "Payment") return raw;
  if (raw.Amount !== undefined && raw.DeliverMax !== undefined && canonicalJson(raw.Amount) !== canonicalJson(raw.DeliverMax)) throw new Error("PAYMENT_AMOUNT_ALIAS_CONFLICT");
  const { Amount: amount, ...rest } = raw;
  return amount === undefined ? rest : { ...rest, DeliverMax: raw.DeliverMax ?? amount };
}

/** Verify signed bytes, hash and the entire finalized non-signature projection. */
export function verifySignedNative(signed: SignedNativeTransaction): void {
  if (!HASH.test(signed.attemptHash) || !/^(?:[A-Fa-f0-9]{2})+$/.test(signed.signedBlob)) throw new Error("INVALID_SIGNED_NATIVE_ATTEMPT");
  const decoded = decode(signed.signedBlob) as unknown as Record<string, unknown>;
  if (hashes.hashSignedTx(signed.signedBlob).toUpperCase() !== signed.attemptHash.toUpperCase() ||
      canonicalJson(normalizePaymentAliases(signatureFreeFields(decoded))) !== canonicalJson(normalizePaymentAliases(signed.preparedFields)) ||
      decoded.Sequence !== signed.sequence || decoded.LastLedgerSequence !== signed.lastLedgerSequence ||
      !Number.isSafeInteger(signed.sequence) || signed.sequence < 0 ||
      !Number.isSafeInteger(signed.lastLedgerSequence) || signed.lastLedgerSequence < 1 ||
      typeof decoded.TxnSignature !== "string" || !decoded.TxnSignature) throw new Error("SIGNED_NATIVE_PROJECTION_MISMATCH");
}

export function transactionUnix(tx: NativeTransaction): number {
  if (typeof tx.close_time_iso === "string") {
    const value = Date.parse(tx.close_time_iso) / 1000;
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  const date = tx.date ?? tx.tx_json.date;
  if (!Number.isSafeInteger(date) || Number(date) < 0) throw new Error("NATIVE_LEDGER_TIME_REQUIRED");
  return epoch + Number(date);
}

/** SDK transport has no durable state. Workers persist every returned blob before submitSaved. */
export function createNativeTransport(client: Client, config: LiveSessionConfig): NativeTransport {
  const wallets: Partial<Record<NativeRole, Wallet>> = {
    borrower: Wallet.fromSeed(config.borrowerSeed), broker: Wallet.fromSeed(config.brokerSeed),
    ...(config.repIssuerSeed ? { repIssuer: Wallet.fromSeed(config.repIssuerSeed) } : {}),
  };
  if (wallets.repIssuer && wallets.repIssuer.classicAddress !== config.repIssuerAddress) throw new Error("REP_ISSUER_KEY_MISMATCH");
  const addresses = { borrower: wallets.borrower!.classicAddress, broker: wallets.broker!.classicAddress, repIssuer: config.repIssuerAddress };
  function wallet(role: NativeRole): Wallet {
    const signer = wallets[role];
    if (!signer) throw new Error("REP_ISSUER_SIGNER_NOT_CONFIGURED");
    return signer;
  }
  function signedResult(prepared: Record<string, unknown>, value: { tx_blob: string; hash: string }): SignedNativeTransaction {
    const result = { signedBlob: value.tx_blob, attemptHash: value.hash.toUpperCase(), preparedFields: structuredClone(prepared), sequence: Number(prepared.Sequence), lastLedgerSequence: Number(prepared.LastLedgerSequence) };
    verifySignedNative(result);
    return result;
  }
  const request = async (input: Record<string, unknown>): Promise<{ result: Record<string, unknown> }> =>
    await client.request(input as never) as unknown as { result: Record<string, unknown> };
  return {
    addresses, config, request,
    async prepareTransaction(role, fields) {
      const signer = wallet(role);
      if (fields.Account !== signer.classicAddress || ["TxnSignature", "CounterpartySignature", "Signers"].some(key => key in fields)) throw new Error("UNAPPROVED_SIGNER_FIELDS");
      const prepared = await client.autofill({ ...fields, SigningPubKey: signer.publicKey } as unknown as SubmittableTransaction);
      // Binary roundtrip fixes aliases (including Amount/DeliverMax) before commitment and signing.
      return signatureFreeFields(decode(encode(prepared)) as unknown as Record<string, unknown>);
    },
    signTransaction(role, prepared) {
      const signer = wallet(role);
      if (prepared.Account !== signer.classicAddress || prepared.SigningPubKey !== signer.publicKey ||
          ["TxnSignature", "CounterpartySignature", "Signers"].some(key => key in prepared)) throw new Error("UNAPPROVED_SIGNER_FIELDS");
      const normalized = normalizePaymentAliases(prepared);
      // xrpl.js 5.3 Wallet.sign still reads Payment.Amount during normalization.
      const input = normalized.TransactionType === "Payment"
        ? (() => { const { DeliverMax, ...rest } = normalized; return { ...rest, Amount: DeliverMax }; })()
        : normalized;
      return signedResult(prepared, signer.sign(input as unknown as Transaction));
    },
    signLoanTransaction(prepared) {
      const broker = wallet("broker"), borrower = wallet("borrower");
      if (prepared.TransactionType !== "LoanSet" || prepared.Account !== broker.classicAddress ||
          prepared.Counterparty !== borrower.classicAddress || prepared.LoanBrokerID !== config.loanBrokerId ||
          prepared.SigningPubKey !== broker.publicKey || ["TxnSignature", "CounterpartySignature", "Signers"].some(key => key in prepared)) throw new Error("UNAPPROVED_LOAN_SIGNER_FIELDS");
      const brokerSigned = broker.sign(prepared as unknown as LoanSet);
      const complete = signLoanSetByCounterparty(borrower, decode(brokerSigned.tx_blob) as LoanSet);
      validate(complete.tx);
      return signedResult(prepared, complete);
    },
    async submitSaved(blob) {
      // A stored blob is the only submission surface. Never autofill or sign here.
      if (!/^(?:[A-Fa-f0-9]{2})+$/.test(blob)) throw new Error("INVALID_SAVED_BLOB");
      await client.submitAndWait(blob);
    },
    async getValidatedTx(hash) {
      if (!HASH.test(hash)) throw new Error("INVALID_NATIVE_HASH");
      let response;
      try { response = await request({ command: "tx", transaction: hash, binary: false, api_version: 2 }); }
      catch (error) {
        const code = (error as { data?: { error?: string } }).data?.error;
        if (code === "txnNotFound" || code === "transactionNotFound") return null;
        throw error;
      }
      const result = response.result;
      if (result.validated !== true) return null;
      const json = (result.tx_json ?? result) as Record<string, unknown>;
      const meta = result.meta as NativeTransaction["meta"];
      if (String(result.hash ?? json.hash).toUpperCase() !== hash.toUpperCase() ||
          !Number.isSafeInteger(result.ledger_index) || Number(result.ledger_index) < 1 ||
          !meta || typeof meta.TransactionResult !== "string" || !Number.isSafeInteger(meta.TransactionIndex) || meta.TransactionIndex < 0) throw new Error("INVALID_VALIDATED_TRANSACTION");
      return { ...result, hash: hash.toUpperCase(), validated: true, ledger_index: Number(result.ledger_index), tx_json: json, meta } as NativeTransaction;
    },
    async getValidatedLedger() {
      const info = await request({ command: "server_info" });
      const networkId = Number((info.result.info as Record<string, unknown> | undefined)?.network_id);
      if (networkId !== 2) throw new Error("DEVNET_NETWORK_REQUIRED");
      const response = await request({ command: "ledger", ledger_index: "validated", transactions: false });
      const ledger = response.result.ledger as Record<string, unknown>;
      const index = Number(response.result.ledger_index ?? ledger?.ledger_index), unixTime = epoch + Number(ledger?.close_time);
      if (response.result.validated !== true || !Number.isSafeInteger(index) || index < 1 || !Number.isSafeInteger(unixTime)) throw new Error("VALIDATED_LEDGER_REQUIRED");
      return { index, unixTime, networkId };
    },
    async getAccountSequence(account) {
      const response = await request({ command: "account_info", account, ledger_index: "validated" });
      const sequence = Number((response.result.account_data as Record<string, unknown>)?.Sequence);
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("ACCOUNT_SEQUENCE_REQUIRED");
      return sequence;
    },
  };
}
