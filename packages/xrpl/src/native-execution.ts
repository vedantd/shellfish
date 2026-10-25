import { randomUUID } from "node:crypto";
import { decode } from "xrpl";
import { canonicalJson, type LenderFacilityOffer } from "@shellfish/schemas";
import { transactionUnix, verifySignedNative, signatureFreeFields, type NativeTransaction, type SignedNativeTransaction } from "./transport.js";
import type { LoanOriginateRequest, LoanOriginateResult, OriginationRegistry } from "./index.js";

type Phase = "STAKE" | "LOAN";
export interface ExecutionGuard { acquired: true; requestId: string; owner: string; fence: number }
export interface NativeStoredAttempt {
  requestId: string; phase: Phase; attemptHash: string; signedBlob: string;
  sequence: number; lastLedgerSequence: number; commitment: string;
  state: "PERSISTED" | "SUBMITTED" | "RECONCILING" | "VALIDATED" | "FAILED";
}
export interface NativeExecutionStore {
  claimExecution(id: string, owner: string): ExecutionGuard | { acquired: false; requestId: string; owner: string; fence: number };
  releaseExecution(guard: ExecutionGuard): boolean;
  getAttempt(id: string, phase: Phase): NativeStoredAttempt | null;
  persistAttempt(guard: ExecutionGuard, input: Omit<NativeStoredAttempt, "requestId" | "state">): NativeStoredAttempt;
  freezePreparedAction(guard: ExecutionGuard, input: { commercialTermsHash: string; preparedFields: Record<string, unknown> }): string;
  markAttemptState(guard: ExecutionGuard, phase: Phase, state: NativeStoredAttempt["state"]): NativeStoredAttempt;
}

export class NativeExecutionPending extends Error {
  readonly code = "RECONCILING";
  constructor(public readonly requestId: string, public readonly reservationId: string, public readonly phase: Phase, public readonly txHash: string) {
    super("Native transaction outcome is unresolved. The saved attempt and both holds remain retained.");
    this.name = "NativeExecutionPending";
  }
}
export class NativeExecutionBusy extends Error {
  readonly code = "EXECUTION_BUSY";
  constructor(public readonly requestId: string) { super("Another executor owns this request or signer account."); this.name = "NativeExecutionBusy"; }
}
const epoch = 946684800;
const memo = (hash: string) => [{ Memo: { MemoType: Buffer.from("shellfish-request").toString("hex").toUpperCase(), MemoData: Buffer.from(hash).toString("hex").toUpperCase() } }];
function amountOf(fields: Record<string, unknown>): unknown { return fields.DeliverMax ?? fields.Amount; }
function assertFinalFields(fields: Record<string, unknown>, expected: Record<string, unknown>, phase: Phase): void {
  const allowed = new Set([...Object.keys(expected), "Fee", "Sequence", "LastLedgerSequence", "SigningPubKey", "NetworkID", "Flags", ...(phase === "STAKE" ? ["Amount", "DeliverMax"] : [])]);
  if (Object.keys(fields).some(key => !allowed.has(key)) || !/^\d+$/.test(String(fields.Fee)) ||
      !Number.isSafeInteger(fields.Sequence) || Number(fields.Sequence) < 0 || !Number.isSafeInteger(fields.LastLedgerSequence) || Number(fields.LastLedgerSequence) < 1 ||
      typeof fields.SigningPubKey !== "string" || !fields.SigningPubKey || fields.NetworkID !== undefined || (fields.Flags ?? 0) !== 0)
    throw new Error("UNAPPROVED_FINALIZED_FIELDS");
  for (const [key, value] of Object.entries(expected)) {
    const actual = key === "Amount" ? amountOf(fields) : fields[key];
    if (canonicalJson(actual) !== canonicalJson(value)) throw new Error("PREPARED_TRANSACTION_MISMATCH");
  }
}
function storedSigned(attempt: NativeStoredAttempt): SignedNativeTransaction {
  const decoded = decode(attempt.signedBlob) as unknown as Record<string, unknown>;
  return { attemptHash: attempt.attemptHash, signedBlob: attempt.signedBlob, preparedFields: signatureFreeFields(decoded), sequence: attempt.sequence, lastLedgerSequence: attempt.lastLedgerSequence };
}
function metadataLoan(tx: NativeTransaction): { loanId: string; maturityAt: number; nextPaymentDueAt: number; graceSeconds: number } {
  const nodes = tx.meta.AffectedNodes ?? [];
  const created = nodes.flatMap(raw => {
    const value = (raw as { CreatedNode?: { LedgerEntryType?: string; LedgerIndex?: string; NewFields?: Record<string, unknown> } }).CreatedNode;
    return value?.LedgerEntryType === "Loan" ? [value] : [];
  });
  if (created.length !== 1) throw new Error("NATIVE_LOAN_METADATA_REQUIRED");
  const node = created[0], f = node.NewFields!;
  const start = Number(f.StartDate), interval = Number(f.PaymentInterval), count = Number(tx.tx_json.PaymentTotal), nextDue = Number(f.NextPaymentDueDate), grace = Number(f.GracePeriod);
  if (!/^[A-Fa-f0-9]{64}$/.test(node.LedgerIndex ?? "") || ![start, interval, count, nextDue, grace].every(Number.isSafeInteger) || interval < 1 || count < 1 || grace < 0)
    throw new Error("NATIVE_LOAN_SCHEDULE_REQUIRED");
  return { loanId: node.LedgerIndex!.toUpperCase(), maturityAt: epoch + start + interval * count, nextPaymentDueAt: epoch + nextDue, graceSeconds: grace };
}
function evidence(tx: NativeTransaction, kind: string, success = true) {
  return { txHash: tx.hash, ledgerIndex: tx.ledger_index, transactionIndex: tx.meta.TransactionIndex, validated: true, result: success ? "tesSUCCESS" : "CONCLUSIVE_FAILURE", transactionType: kind };
}

/** One request fence, immutable blobs and exact retries. No SQL transaction covers a network call. */
export async function originateDurableNative(req: LoanOriginateRequest, registry: OriginationRegistry, offer: LenderFacilityOffer, nativePrincipal: string): Promise<LoanOriginateResult> {
  const execution = registry.execution;
  const transport = registry.live?.transport;
  const signerLanes = registry.signerLanes;
  if (!execution || !transport || !signerLanes) throw new Error("DURABLE_NATIVE_EXECUTION_REQUIRED");
  const existing = registry.getRequest(req.requestId);
  const scale = transport.config.loanAssetScale ?? 6;
  const principalMinor = (existing.request as { principal_minor: string }).principal_minor;
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 18 || !/^[1-9][0-9]*$/.test(principalMinor)) throw new Error("NATIVE_PRINCIPAL_SCALE_MISMATCH");
  const scaled = BigInt(principalMinor) * 10n ** BigInt(scale);
  if (scaled % 100n !== 0n || scaled / 100n !== BigInt(nativePrincipal)) throw new Error("NATIVE_PRINCIPAL_SCALE_MISMATCH");
  const savedLoan = execution.getAttempt(req.requestId, "LOAN");
  if (existing.loanId) {
    if (!savedLoan || savedLoan.state !== "VALIDATED" || !existing.stakeHash) throw new Error("PERSISTED_NATIVE_OUTCOME_REQUIRED");
    return { mode: "LIVE_DEVNET", txHash: savedLoan.attemptHash, loanId: existing.loanId, validated: true, simulated: false,
      requestId: req.requestId, reservationId: req.reservationId, stakeProofId: existing.stakeHash, preparedTxCommitment: savedLoan.commitment };
  }
  const guard = execution.claimExecution(req.requestId, randomUUID());
  if (!guard.acquired) throw new NativeExecutionBusy(req.requestId);
  let lane: { acquired: true; operationId: string; lanes: Array<{ key: string; fence: number }> } | undefined;
  let conclusive = false;
  try {
    const claimed = signerLanes.claim({ operationId: `originate:${req.requestId}`, mode: "LIVE_DEVNET", network: "devnet", accounts: [transport.addresses.borrower, transport.addresses.broker] });
    if (!claimed.acquired) throw new NativeExecutionBusy(req.requestId);
    lane = claimed;
    const request = existing.request as { commercial_terms_hash: string };
    const requestHash = registry.hashRequest(existing.request);
    const stakeExpected = {
      TransactionType: "Payment", Account: transport.addresses.borrower, Destination: transport.addresses.repIssuer,
      Amount: { mpt_issuance_id: registry.repAsset.mpt_issuance_id, value: existing.originalBondU }, Flags: 0, Memos: memo(requestHash),
    };
    async function settle(phase: Phase, expected: Record<string, unknown>): Promise<NativeTransaction> {
      let saved = execution!.getAttempt(req.requestId, phase);
      if (!saved) {
        signerLanes!.assertClaim(lane!);
        const prepared = await transport!.prepareTransaction(phase === "STAKE" ? "borrower" : "broker", expected);
        assertFinalFields(prepared, expected, phase);
        const commitment = phase === "STAKE" ? requestHash : execution!.freezePreparedAction(guard as ExecutionGuard, { commercialTermsHash: request.commercial_terms_hash, preparedFields: prepared });
        const signed = phase === "STAKE" ? transport!.signTransaction("borrower", prepared) : transport!.signLoanTransaction(prepared);
        verifySignedNative(signed);
        assertFinalFields(signed.preparedFields, expected, phase);
        saved = execution!.persistAttempt(guard as ExecutionGuard, { phase, attemptHash: signed.attemptHash, signedBlob: signed.signedBlob, sequence: signed.sequence, lastLedgerSequence: signed.lastLedgerSequence, commitment });
      } else {
        const signed = storedSigned(saved);
        verifySignedNative(signed);
        assertFinalFields(signed.preparedFields, expected, phase);
        if (phase === "LOAN") {
          const commitment = execution!.freezePreparedAction(guard as ExecutionGuard, { commercialTermsHash: request.commercial_terms_hash, preparedFields: signed.preparedFields });
          if (commitment !== saved.commitment) throw new Error("SAVED_PREPARED_COMMITMENT_MISMATCH");
        } else if (saved.commitment !== requestHash) throw new Error("SAVED_STAKE_COMMITMENT_MISMATCH");
      }
      let tx: NativeTransaction | null = null;
      try {
        tx = await transport!.getValidatedTx(saved.attemptHash);
        if (!tx) {
          const ledger = await transport!.getValidatedLedger();
          if (ledger.index <= saved.lastLedgerSequence) {
            if (saved.state === "PERSISTED" || saved.state === "SUBMITTED") execution!.markAttemptState(guard as ExecutionGuard, phase, "SUBMITTED");
            signerLanes!.assertClaim(lane!);
            await transport!.submitSaved(saved.signedBlob);
            tx = await transport!.getValidatedTx(saved.attemptHash);
          }
        }
      } catch {
        // A failed submit may still have validated. Always re-query the exact stored hash.
        try { tx = await transport!.getValidatedTx(saved.attemptHash); } catch { tx = null; }
      }
      if (!tx) {
        if (saved.state !== "VALIDATED" && saved.state !== "FAILED") execution!.markAttemptState(guard as ExecutionGuard, phase, "RECONCILING");
        await registry.applyEvent({ eventId: `unknown:${req.requestId}:${phase}:${saved.attemptHash}`, kind: "UNKNOWN", requestId: req.requestId, occurredAt: registry.clockSeconds() });
        throw new NativeExecutionPending(req.requestId, req.reservationId, phase, saved.attemptHash);
      }
      if (tx.meta.TransactionResult !== "tesSUCCESS") {
        await registry.applyEvent({ eventId: `failed:${req.requestId}:${phase}`, kind: phase === "STAKE" ? "CANCEL_BEFORE_BURN" : "FAIL_AFTER_BURN", requestId: req.requestId,
          occurredAt: transactionUnix(tx), native: evidence(tx, phase === "STAKE" ? "Payment" : "LoanSet", false), conclusive: true });
        execution!.markAttemptState(guard as ExecutionGuard, phase, "FAILED");
        conclusive = true;
        throw new Error("NATIVE_TRANSACTION_CONCLUSIVELY_FAILED");
      }
      return tx;
    }
    let current = registry.getRequest(req.requestId);
    if (!current.stakeHash) {
      const stake = await settle("STAKE", stakeExpected);
      await registry.applyEvent({ eventId: `stake:${req.requestId}`, kind: "STAKE_VALIDATED", requestId: req.requestId, occurredAt: transactionUnix(stake), native: evidence(stake, "Payment"),
        stake: { amountU: existing.originalBondU, repAsset: registry.repAsset, sender: transport.addresses.borrower, destination: transport.addresses.repIssuer, requestHash, partialPayment: false } });
      execution.markAttemptState(guard, "STAKE", "VALIDATED");
    }
    current = registry.getRequest(req.requestId);
    if (!current.stakeHash) throw new Error("VERIFIED_STAKE_REQUIRED");
    const cfg = transport.config;
    const loanExpected = { TransactionType: "LoanSet", Account: transport.addresses.broker, Counterparty: transport.addresses.borrower,
      LoanBrokerID: cfg.loanBrokerId, PrincipalRequested: nativePrincipal, InterestRate: offer.apr_bps * 10,
      PaymentTotal: offer.schedule.payment_total, PaymentInterval: offer.schedule.payment_interval_seconds,
      GracePeriod: cfg.gracePeriodSec ?? 604800, LoanOriginationFee: cfg.loanOriginationFee ?? "0", LoanServiceFee: cfg.loanServiceFee ?? "0", Flags: 0, Memos: memo(requestHash) };
    const originated = await settle("LOAN", loanExpected);
    const loan = metadataLoan(originated);
    await registry.applyEvent({ eventId: `origin:${req.requestId}`, kind: "ORIGINATION_VALIDATED", requestId: req.requestId,
      occurredAt: transactionUnix(originated), native: evidence(originated, "LoanSet"), loan });
    execution.markAttemptState(guard, "LOAN", "VALIDATED");
    conclusive = true;
    const saved = execution.getAttempt(req.requestId, "LOAN")!;
    return { mode: "LIVE_DEVNET", txHash: originated.hash, loanId: loan.loanId, validated: true, simulated: false,
      requestId: req.requestId, reservationId: req.reservationId, stakeProofId: current.stakeHash, preparedTxCommitment: saved.commitment };
  } finally {
    // Unknown signed blobs remain immutable in SQLite. Releasing worker ownership does not release holds.
    execution.releaseExecution(guard);
    if (lane && (conclusive || (!execution.getAttempt(req.requestId, "STAKE") && !execution.getAttempt(req.requestId, "LOAN")))) signerLanes.release(lane);
  }
}
