import { randomUUID } from "node:crypto";
import { canonicalJson, type AssetRef } from "@shellfish/schemas";
import { verifySignedNative, type NativeTransport, type SignedNativeTransaction, type NativeTransaction } from "./transport.js";
import { completeLoanHistory, deriveLoanOutcome } from "./native-verification.js";

type Statement = { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; run(...args: unknown[]): { changes: number } };
export interface LifecycleDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): Statement;
  transaction<T>(body: () => T): (() => T) & { immediate(): T };
}
export class LifecycleError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "LifecycleError"; this.code = code; }
}
export type LifecycleKind = "REPAYMENT" | "DEFAULT";
export type RepaymentMode = "FULL" | "REGULAR" | "OVERPAYMENT" | "LATE";
export type LifecycleState = "CLAIMED" | "PERSISTED" | "SUBMITTED" | "RECONCILING" | "VALIDATED" | "FAILED";
type OperationInput = { operationId: string; loanId: string; requestId: string; kind: LifecycleKind; account: string; fields: Record<string, unknown> };
export type LifecycleGuard = { acquired: true; operationId: string; owner: string; fence: number };
type OperationRow = {
  operation_id: string; loan_id: string; request_id: string; kind: LifecycleKind; account: string;
  input_hash: string; fields_json: string; owner: string | null; fence: number; claimed: number;
  state: LifecycleState; attempt_hash: string | null; signed_blob: string | null; prepared_json: string | null;
  sequence: number | null; first_ledger_sequence: number | null; last_ledger_sequence: number | null;
  applied_event_id: string | null; failure_code: string | null;
};
export type PublicLifecycleOperation = ReturnType<typeof publicOperation>;
function publicOperation(r: OperationRow) {
  return { operationId: r.operation_id, loanId: r.loan_id, requestId: r.request_id, kind: r.kind,
    state: r.state, attemptHash: r.attempt_hash, sequence: r.sequence, firstLedgerSequence: r.first_ledger_sequence,
    lastLedgerSequence: r.last_ledger_sequence, appliedEventId: r.applied_event_id, failureCode: r.failure_code,
    owner: r.owner, fence: r.fence, claimed: r.claimed === 1 };
}
const tables = `CREATE TABLE IF NOT EXISTS credit_lifecycle_operations (
  operation_id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES credit_loans(loan_id),
  request_id TEXT NOT NULL REFERENCES credit_requests(request_id), kind TEXT NOT NULL, account TEXT NOT NULL,
  input_hash TEXT NOT NULL, fields_json TEXT NOT NULL, owner TEXT, fence INTEGER NOT NULL,
  claimed INTEGER NOT NULL CHECK(claimed IN (0,1)), state TEXT NOT NULL,
  attempt_hash TEXT UNIQUE, signed_blob TEXT, prepared_json TEXT, sequence INTEGER,
  first_ledger_sequence INTEGER, last_ledger_sequence INTEGER, applied_event_id TEXT, failure_code TEXT
); CREATE INDEX IF NOT EXISTS lifecycle_request ON credit_lifecycle_operations(request_id);`;
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Durable exact-attempt storage. It never signs, submits or expires a worker by time. */
export function createLifecycleStore(db: LifecycleDatabase, options: { hash: (value: unknown) => string }) {
  db.exec(tables);
  const need = (id: string): OperationRow => {
    const row = db.prepare("SELECT * FROM credit_lifecycle_operations WHERE operation_id=?").get(id) as OperationRow | undefined;
    if (!row) throw new LifecycleError("LIFECYCLE_OPERATION_NOT_FOUND");
    return row;
  };
  const guard = (g: LifecycleGuard): OperationRow => {
    const row = need(g.operationId);
    if (g.acquired !== true || row.claimed !== 1 || row.owner !== g.owner || row.fence !== g.fence)
      throw new LifecycleError("STALE_LIFECYCLE_GUARD");
    return row;
  };
  function claim(input: OperationInput, owner: string): LifecycleGuard | { acquired: false; operationId: string; owner: string | null; fence: number } {
    if (![input.operationId, input.loanId, input.requestId, input.account, owner].every(validId)) throw new LifecycleError("INVALID_LIFECYCLE_IDENTITY");
    const inputHash = options.hash(input);
    return db.transaction(() => {
      const row = db.prepare("SELECT * FROM credit_lifecycle_operations WHERE operation_id=?").get(input.operationId) as OperationRow | undefined;
      if (row) {
        if (row.input_hash !== inputHash) throw new LifecycleError("LIFECYCLE_IDEMPOTENCY_CONFLICT");
        if (row.claimed === 1) return { acquired: false as const, operationId: row.operation_id, owner: row.owner, fence: row.fence };
        const fence = row.fence + 1;
        db.prepare("UPDATE credit_lifecycle_operations SET owner=?,fence=?,claimed=1 WHERE operation_id=?").run(owner, fence, row.operation_id);
        return { acquired: true as const, operationId: row.operation_id, owner, fence };
      }
      const loan = db.prepare("SELECT request_id FROM credit_loans WHERE loan_id=?").get(input.loanId) as { request_id: string } | undefined;
      if (loan?.request_id !== input.requestId) throw new LifecycleError("LIFECYCLE_LOAN_BINDING_MISMATCH");
      db.prepare(`INSERT INTO credit_lifecycle_operations(operation_id,loan_id,request_id,kind,account,input_hash,fields_json,owner,fence,claimed,state)
        VALUES(?,?,?,?,?,?,?,?,1,1,'CLAIMED')`).run(input.operationId, input.loanId, input.requestId, input.kind, input.account, inputHash, canonicalJson(input.fields), owner);
      return { acquired: true as const, operationId: input.operationId, owner, fence: 1 };
    }).immediate();
  }
  function persist(g: LifecycleGuard, input: SignedNativeTransaction & { firstLedgerSequence: number }): void {
    verifySignedNative(input);
    db.transaction(() => {
      const row = guard(g);
      if (row.attempt_hash) {
        if (row.attempt_hash !== input.attemptHash || row.signed_blob !== input.signedBlob || row.prepared_json !== canonicalJson(input.preparedFields))
          throw new LifecycleError("IMMUTABLE_LIFECYCLE_ATTEMPT_CONFLICT");
        return;
      }
      const fields = JSON.parse(row.fields_json) as Record<string, unknown>;
      if (Object.entries(fields).some(([key, value]) => canonicalJson(input.preparedFields[key]) !== canonicalJson(value)))
        throw new LifecycleError("LIFECYCLE_SIGNED_FIELDS_MISMATCH");
      if (!Number.isSafeInteger(input.firstLedgerSequence) || input.firstLedgerSequence < 1 || input.lastLedgerSequence <= input.firstLedgerSequence)
        throw new LifecycleError("INVALID_LIFECYCLE_LEDGER_BOUND");
      db.prepare(`UPDATE credit_lifecycle_operations SET state='PERSISTED',attempt_hash=?,signed_blob=?,prepared_json=?,sequence=?,first_ledger_sequence=?,last_ledger_sequence=? WHERE operation_id=?`)
        .run(input.attemptHash, input.signedBlob, canonicalJson(input.preparedFields), input.sequence, input.firstLedgerSequence, input.lastLedgerSequence, g.operationId);
    }).immediate();
  }
  function mark(g: LifecycleGuard, state: Exclude<LifecycleState, "CLAIMED" | "PERSISTED">, detail?: string): void {
    db.transaction(() => {
      const row = guard(g);
      if (!row.attempt_hash) throw new LifecycleError("LIFECYCLE_ATTEMPT_REQUIRED");
      if ((row.state === "VALIDATED" || row.state === "FAILED") && row.state !== state) throw new LifecycleError("LIFECYCLE_TERMINAL_STATE");
      if (row.state === "RECONCILING" && state === "SUBMITTED") return;
      db.prepare("UPDATE credit_lifecycle_operations SET state=?,applied_event_id=?,failure_code=? WHERE operation_id=?")
        .run(state, state === "VALIDATED" ? detail ?? row.applied_event_id : row.applied_event_id, state === "FAILED" ? detail ?? "VALIDATED_FAILURE" : row.failure_code, g.operationId);
    }).immediate();
  }
  function release(g: LifecycleGuard): void {
    db.transaction(() => { guard(g); db.prepare("UPDATE credit_lifecycle_operations SET claimed=0,owner=NULL WHERE operation_id=? AND fence=?").run(g.operationId, g.fence); }).immediate();
  }
  function recoverOperation(id: string, expectedOwner: string, expectedFence: number): boolean {
    if (!validId(expectedOwner) || !Number.isSafeInteger(expectedFence)) throw new LifecycleError("INVALID_RECOVERY_ACK");
    return db.prepare("UPDATE credit_lifecycle_operations SET claimed=0,owner=NULL,fence=fence+1 WHERE operation_id=? AND owner=? AND fence=? AND claimed=1")
      .run(id, expectedOwner, expectedFence).changes === 1;
  }
  return {
    claim, persist, mark, release, recoverOperation,
    getOperation(id: string): PublicLifecycleOperation { return publicOperation(need(id)); },
    getInternal(id: string): OperationRow { return { ...need(id) }; },
    getEventHash(id: string): string {
      const row = db.prepare("SELECT tx_hash FROM credit_events WHERE event_id=?").get(id) as { tx_hash: string | null } | undefined;
      if (!row?.tx_hash) throw new LifecycleError("LOAN_EVENT_CURSOR_MISSING");
      return row.tx_hash;
    },
  };
}
export type LifecycleStore = ReturnType<typeof createLifecycleStore>;
export type SignerClaim = { acquired: true; operationId: string; lanes: { key: string; fence: number }[] };
export type SignerLanes = {
  claim(input: { operationId: string; mode: "LIVE_DEVNET"; network: string; accounts: string[] }): SignerClaim | { acquired: false; blockedAccount: string };
  assertClaim(claim: SignerClaim): void;
  release(claim: SignerClaim): boolean;
};
export type LifecycleRegistry = {
  getRequest(id: string): { request: { mode: string; network: string; asset: AssetRef }; loanId: string | null };
  getLoan(id: string): Record<string, string | number | null>;
  applyEvent(event: never): Promise<unknown>;
};
export interface LifecycleWorkerOptions {
  registry: LifecycleRegistry; store: LifecycleStore; transport: NativeTransport; signerLanes: SignerLanes;
  moneyScale: bigint; nativeAssetScale?: number; loanAsset: { mpt_issuance_id: string }; owner?: string;
}

/** Repayment/default use caller amounts only as spending caps. Metadata determines accounting. */
export function createLifecycleWorker(options: LifecycleWorkerOptions) {
  const { registry, store, transport, signerLanes } = options;
  const owner = options.owner ?? `lifecycle-${randomUUID()}`;
  async function applyThrough(loanId: string, terminalHash: string): Promise<string> {
    let loan = registry.getLoan(loanId);
    const originHash = String(loan.origin_hash), cursorHash = store.getEventHash(String(loan.event_cursor));
    const history = await completeLoanHistory(transport, loanId, originHash, terminalHash);
    const events = history.events as NativeTransaction[];
    const start = events.findIndex(event => event.hash.toUpperCase() === cursorHash.toUpperCase());
    if (start < 0) throw new LifecycleError("LOAN_HISTORY_CURSOR_MISSING");
    let eventId = String(loan.event_cursor);
    for (const tx of events.slice(start + 1)) {
      loan = registry.getLoan(loanId);
      const outcome = await deriveLoanOutcome(transport, loanId, tx.hash, {
        originHash, eventCursor: String(loan.event_cursor), previousEventHash: store.getEventHash(String(loan.event_cursor)),
        maturityAt: Number(loan.maturity_time), nextDueAt: Number(loan.next_due_time), graceSeconds: Number(loan.grace_seconds),
        moneyScale: options.moneyScale, nativeAssetScale: options.nativeAssetScale ?? 0,
      });
      eventId = `native:${tx.hash.toUpperCase()}`;
      const { tx: _tx, ...event } = outcome;
      await registry.applyEvent({ ...event, eventId, loanId } as never);
    }
    return eventId;
  }
  async function run(input: OperationInput): Promise<PublicLifecycleOperation> {
    const acquired = store.claim(input, owner);
    if (!acquired.acquired) throw new LifecycleError("LIFECYCLE_WORKER_BUSY");
    const guard = acquired;
    let lane: SignerClaim | undefined;
    let conclusive = false;
    try {
      let operation = store.getInternal(input.operationId);
      const record = registry.getRequest(input.requestId);
      if (record.loanId !== input.loanId || record.request.mode !== "LIVE_DEVNET") throw new LifecycleError("LIFECYCLE_LOAN_BINDING_MISMATCH");
      const loan = registry.getLoan(input.loanId);
      const claimed = signerLanes.claim({ operationId: `lifecycle:${input.operationId}`, mode: "LIVE_DEVNET", network: record.request.network, accounts: [input.account] });
      if (!claimed.acquired) throw new LifecycleError("SIGNER_LANE_BUSY");
      lane = claimed;
      if (operation.state === "VALIDATED" || operation.state === "FAILED") {
        conclusive = true;
        return store.getOperation(input.operationId);
      }
      const ledger = await transport.getValidatedLedger();
      if (!operation.attempt_hash) {
        if (loan.state !== "ACTIVE") throw new LifecycleError("LOAN_NOT_ACTIVE");
        if (input.kind === "DEFAULT" && ledger.unixTime <= Number(loan.next_due_time) + Number(loan.grace_seconds))
          throw new LifecycleError("DEFAULT_TOO_SOON");
        const role = input.kind === "REPAYMENT" ? "borrower" : "broker";
        const prepared = await transport.prepareTransaction(role, input.fields);
        signerLanes.assertClaim(lane);
        const signed = transport.signTransaction(role, prepared);
        store.persist(guard, { ...signed, firstLedgerSequence: ledger.index });
        operation = store.getInternal(input.operationId);
      }
      let tx = await transport.getValidatedTx(operation.attempt_hash!);
      if (!tx) {
        signerLanes.assertClaim(lane);
        store.mark(guard, operation.state === "RECONCILING" ? "RECONCILING" : "SUBMITTED");
        try { await transport.submitSaved(operation.signed_blob!); }
        catch { store.mark(guard, "RECONCILING"); }
        tx = await transport.getValidatedTx(operation.attempt_hash!);
      }
      if (!tx) { store.mark(guard, "RECONCILING"); return store.getOperation(input.operationId); }
      if (tx.meta.TransactionResult !== "tesSUCCESS") {
        store.mark(guard, "FAILED", tx.meta.TransactionResult); conclusive = true;
        return store.getOperation(input.operationId);
      }
      const eventId = await applyThrough(input.loanId, tx.hash);
      store.mark(guard, "VALIDATED", eventId); conclusive = true;
      return store.getOperation(input.operationId);
    } catch (error) {
      const operation = store.getInternal(input.operationId);
      if (operation.attempt_hash && operation.state !== "VALIDATED" && operation.state !== "FAILED") store.mark(guard, "RECONCILING");
      throw error;
    } finally {
      const operation = store.getInternal(input.operationId);
      if (lane && (conclusive || !operation.attempt_hash)) signerLanes.release(lane);
      store.release(guard);
    }
  }
  function inputFor(operationId: string, loanId: string, requestId: string, kind: LifecycleKind, maximumAmountNative?: string, paymentMode: RepaymentMode = "FULL"): OperationInput {
    const paymentFlags = { FULL: 131072, REGULAR: 0, OVERPAYMENT: 65536, LATE: 262144 };
    if (!(paymentMode in paymentFlags)) throw new LifecycleError("INVALID_REPAYMENT_MODE");
    const fields: Record<string, unknown> = kind === "REPAYMENT" ? {
      TransactionType: "LoanPay", Account: transport.addresses.borrower, LoanID: loanId,
      Amount: { mpt_issuance_id: options.loanAsset.mpt_issuance_id, value: maximumAmountNative }, Flags: paymentFlags[paymentMode],
    } : { TransactionType: "LoanManage", Account: transport.addresses.broker, LoanID: loanId, Flags: 65536 };
    if (kind === "REPAYMENT" && (typeof maximumAmountNative !== "string" || !/^[1-9][0-9]*$/.test(maximumAmountNative)))
      throw new LifecycleError("INVALID_REPAYMENT_SPENDING_CAP");
    return { operationId, loanId, requestId, kind, account: String(fields.Account), fields };
  }
  return {
    repay(input: { operationId: string; loanId: string; requestId: string; maximumAmountNative: string; paymentMode?: RepaymentMode }) {
      return run(inputFor(input.operationId, input.loanId, input.requestId, "REPAYMENT", input.maximumAmountNative, input.paymentMode));
    },
    defaultLoan(input: { operationId: string; loanId: string; requestId: string }) {
      return run(inputFor(input.operationId, input.loanId, input.requestId, "DEFAULT"));
    },
    reconcile(operationId: string) {
      const old = store.getInternal(operationId);
      return run({ operationId, loanId: old.loan_id, requestId: old.request_id, kind: old.kind, account: old.account, fields: JSON.parse(old.fields_json) as Record<string, unknown> });
    },
  };
}
