import { randomUUID } from "node:crypto";
import { canonicalJson, type RepAssetRef } from "@shellfish/schemas";
import { ledgerUnix, nativeEvidence } from "./native-verification.js";
import { normalizePaymentAliases, verifySignedNative, type NativeTransport } from "./transport.js";
import { LifecycleError, type SignerClaim, type SignerLanes } from "./lifecycle.js";

export type ReturnWorkerGuard = { acquired: true; creditId: string; issuerKey: string; owner: string; fence: number };
export type ReturnWorkerInstruction = {
  creditId: string; network: string; mode: string; issuer: string; destination: string;
  repAsset: RepAssetRef; amountU: string; instructionHash: string;
};
type ReturnWorkerAttempt = {
  creditId: string; attemptNumber: number; attemptHash: string; signedBlob: string;
  firstLedgerSequence: number; preparedFields: Record<string, unknown>; sequence: number;
  lastLedgerSequence: number; commitment: string;
  state: "PERSISTED" | "SUBMITTED" | "RECONCILING" | "NOT_APPLIED" | "VALIDATED";
};
/** Structural port keeps the SDK adapter independent of a particular SQLite package. */
export interface ReturnWorkerStore {
  claimReturn(creditId: string, owner: string): ReturnWorkerGuard | { acquired: false };
  releaseReturnWorker(guard: ReturnWorkerGuard): boolean;
  getReturnInstruction(creditId: string): ReturnWorkerInstruction;
  getReturnAttempt(creditId: string): ReturnWorkerAttempt | null;
  prepareReturnPayment(guard: ReturnWorkerGuard, input: {
    sequence: number; lastLedgerSequence: number; feeDrops: string; signingPubKey?: string; networkId?: number;
  }): Record<string, unknown>;
  persistReturnAttempt(guard: ReturnWorkerGuard, input: {
    attemptHash: string; signedBlob: string; firstLedgerSequence: number; preparedFields: Record<string, unknown>;
  }): ReturnWorkerAttempt;
  markReturnUncertain(guard: ReturnWorkerGuard, hash: string, state: "SUBMITTED" | "RECONCILING"): ReturnWorkerAttempt;
  resolveNotApplied(guard: ReturnWorkerGuard, hash: string, evidence: {
    kind: "VALIDATED_FAILURE"; txHash: string; ledgerIndex: number; transactionIndex: number; result: string;
  }): Promise<ReturnWorkerAttempt>;
}
export type PublicRepReturn = {
  creditId: string; state: "OWED" | "PAID"; phase: ReturnWorkerAttempt["state"] | "QUEUED";
  attemptHash: string | null; attemptNumber: number;
};
export interface ReturnWorkerOptions {
  returns: ReturnWorkerStore; registry: { applyEvent(event: never): Promise<unknown> };
  transport: NativeTransport; signerLanes: SignerLanes; owner?: string;
}
function publicReturn(creditId: string, attempt: ReturnWorkerAttempt | null): PublicRepReturn {
  return { creditId, state: attempt?.state === "VALIDATED" ? "PAID" : "OWED", phase: attempt?.state ?? "QUEUED",
    attemptHash: attempt?.attemptHash ?? null, attemptNumber: attempt?.attemptNumber ?? 0 };
}

/** A repayment creates an obligation. Only a validated issuer Payment settles that obligation. */
export function createRepReturnWorker(options: ReturnWorkerOptions) {
  const { returns, registry, transport, signerLanes } = options;
  const ownerPrefix = options.owner ?? "rep-return";
  async function processRepReturn(creditId: string): Promise<PublicRepReturn> {
    const instruction = returns.getReturnInstruction(creditId);
    if (instruction.mode !== "LIVE_DEVNET" || instruction.network !== "devnet" || instruction.issuer !== transport.addresses.repIssuer)
      throw new LifecycleError("RETURN_NATIVE_BINDING_MISMATCH");
    let attempt = returns.getReturnAttempt(creditId);
    // A previous process can die after atomic settlement but before signer-lane cleanup.
    if (attempt?.state === "VALIDATED") {
      const lane = signerLanes.claim({ operationId: `return:${creditId}`, mode: "LIVE_DEVNET", network: instruction.network, accounts: [instruction.issuer] });
      if (lane.acquired) signerLanes.release(lane);
      return publicReturn(creditId, attempt);
    }
    const acquired = returns.claimReturn(creditId, `${ownerPrefix}:${randomUUID()}`);
    if (!acquired.acquired) throw new LifecycleError("RETURN_WORKER_BUSY");
    const guard = acquired;
    let lane: SignerClaim | undefined, conclusive = false;
    try {
      const claimed = signerLanes.claim({ operationId: `return:${creditId}`, mode: "LIVE_DEVNET", network: instruction.network, accounts: [instruction.issuer] });
      if (!claimed.acquired) throw new LifecycleError("SIGNER_LANE_BUSY");
      lane = claimed;
      const ledger = await transport.getValidatedLedger();
      attempt = returns.getReturnAttempt(creditId);
      if (!attempt || attempt.state === "NOT_APPLIED") {
        const prepared = await transport.prepareTransaction("repIssuer", {
          TransactionType: "Payment", Account: instruction.issuer, Destination: instruction.destination,
          Amount: { mpt_issuance_id: instruction.repAsset.mpt_issuance_id, value: instruction.amountU }, Flags: 0,
        });
        const exact = returns.prepareReturnPayment(guard, {
          sequence: prepared.Sequence as number, lastLedgerSequence: prepared.LastLedgerSequence as number,
          feeDrops: prepared.Fee as string,
          ...(prepared.SigningPubKey === undefined ? {} : { signingPubKey: prepared.SigningPubKey as string }),
          networkId: ledger.networkId,
        });
        signerLanes.assertClaim(lane);
        const signed = transport.signTransaction("repIssuer", exact);
        verifySignedNative(signed);
        attempt = returns.persistReturnAttempt(guard, { attemptHash: signed.attemptHash, signedBlob: signed.signedBlob,
          firstLedgerSequence: ledger.index, preparedFields: signed.preparedFields });
      }
      let tx = await transport.getValidatedTx(attempt.attemptHash);
      if (!tx) {
        signerLanes.assertClaim(lane);
        returns.markReturnUncertain(guard, attempt.attemptHash, attempt.state === "RECONCILING" ? "RECONCILING" : "SUBMITTED");
        try { await transport.submitSaved(attempt.signedBlob); }
        catch { returns.markReturnUncertain(guard, attempt.attemptHash, "RECONCILING"); }
        tx = await transport.getValidatedTx(attempt.attemptHash);
      }
      if (!tx) {
        attempt = returns.markReturnUncertain(guard, attempt.attemptHash, "RECONCILING");
        return publicReturn(creditId, attempt);
      }
      if (tx.meta.TransactionResult !== "tesSUCCESS") {
        attempt = await returns.resolveNotApplied(guard, attempt.attemptHash, {
          kind: "VALIDATED_FAILURE", txHash: tx.hash, ledgerIndex: tx.ledger_index,
          transactionIndex: tx.meta.TransactionIndex, result: tx.meta.TransactionResult,
        });
        conclusive = true;
        return publicReturn(creditId, attempt);
      }
      const payment = normalizePaymentAliases(tx.tx_json);
      const expected = { mpt_issuance_id: instruction.repAsset.mpt_issuance_id, value: instruction.amountU };
      const amount = payment.DeliverMax ?? payment.Amount;
      if (payment.TransactionType !== "Payment" || payment.Account !== instruction.issuer || payment.Destination !== instruction.destination ||
        canonicalJson(amount) !== canonicalJson(expected) || (Number(payment.Flags ?? 0) & 131072) !== 0 ||
        ["Paths", "SendMax", "DeliverMin"].some(key => key in payment)) throw new LifecycleError("RETURN_VALIDATED_PAYMENT_MISMATCH");
      await registry.applyEvent({ eventId: `native:${tx.hash.toUpperCase()}`, kind: "RETURN_VALIDATED", creditId,
        occurredAt: ledgerUnix(tx), native: nativeEvidence(tx), returned: {
          attemptHash: attempt.attemptHash, amountU: instruction.amountU, repAsset: instruction.repAsset,
          sender: instruction.issuer, destination: instruction.destination, partialPayment: false,
        } } as never);
      conclusive = true;
      return publicReturn(creditId, returns.getReturnAttempt(creditId));
    } catch (error) {
      const saved = returns.getReturnAttempt(creditId);
      if (saved && !["VALIDATED", "NOT_APPLIED"].includes(saved.state))
        returns.markReturnUncertain(guard, saved.attemptHash, "RECONCILING");
      throw error;
    } finally {
      const saved = returns.getReturnAttempt(creditId);
      if (lane && (conclusive || !saved || saved.state === "NOT_APPLIED")) signerLanes.release(lane);
      returns.releaseReturnWorker(guard);
    }
  }
  return { processRepReturn };
}
