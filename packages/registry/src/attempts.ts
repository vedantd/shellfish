import type Database from "better-sqlite3";
import { assertSupportedSqliteRuntime, RegistryError } from "./registry.js";
import { canonicalJson } from "@shellfish/schemas";
import { contentHash } from "./commitments.js";
export type AttemptPhase = "STAKE" | "LOAN";
export type AttemptState = "PERSISTED" | "SUBMITTED" | "RECONCILING" | "VALIDATED" | "FAILED";
export interface ExecutionGuard {
    acquired: true;
    requestId: string;
    /** A unique executor-instance ID. A human or account name is not a lock owner. */
    owner: string;
    fence: number;
}
export type ExecutionClaim = ExecutionGuard | {
    acquired: false;
    requestId: string;
    owner: string;
    fence: number;
};
export interface SignedAttemptInput {
    phase: AttemptPhase;
    attemptHash: string;
    /** Internal persistence only. Never include this in logs or public receipts. */
    signedBlob: string;
    sequence: number;
    lastLedgerSequence: number;
    commitment: string;
}
export interface StoredAttempt extends SignedAttemptInput {
    requestId: string;
    state: AttemptState;
}
export interface ExecutionStoreOptions {
    now?: () => Date;
}
interface ClaimRow {
    request_id: string;
    owner: string;
    fence: number;
    active: number;
}
interface RequestRow {
    request_id: string;
    state: string;
    stake_hash: string | null;
    payload_hash: string;
    request_json: string;
    suspended: number;
    mode: string;
    prepared_commitment: string | null;
    prepared_json: string | null;
}
interface AttemptRow {
    request_id: string;
    phase: AttemptPhase;
    attempt_hash: string;
    signed_blob: string;
    sequence: number;
    last_ledger_sequence: number;
    state: AttemptState;
    commitment: string;
}
const transitions: Record<AttemptState, ReadonlySet<AttemptState>> = {
    PERSISTED: new Set(["PERSISTED", "SUBMITTED", "RECONCILING", "VALIDATED", "FAILED"]),
    SUBMITTED: new Set(["SUBMITTED", "RECONCILING", "VALIDATED", "FAILED"]),
    RECONCILING: new Set(["RECONCILING", "VALIDATED", "FAILED"]),
    VALIDATED: new Set(["VALIDATED"]),
    FAILED: new Set(["FAILED"]),
};
function nonempty(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}
function uint32(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
}
function phase(value: unknown): value is AttemptPhase { return value === "STAKE" || value === "LOAN"; }
function stored(row: AttemptRow): StoredAttempt {
    return { requestId: row.request_id, phase: row.phase, attemptHash: row.attempt_hash,
        signedBlob: row.signed_blob, sequence: row.sequence, lastLedgerSequence: row.last_ledger_sequence,
        state: row.state, commitment: row.commitment };
}
/**
 * Durable single-executor and immutable-attempt storage. Initialize the registry schema first.
 *
 * This store neither signs nor submits transactions. The trusted XRPL adapter must decode
 * the signed blob, verify its transaction hash and sequences, and bind all approved fields
 * to `commitment` before persistence. Recoveries submit only the blob returned by this store.
 * A terminal attempt status is not a verified accounting event and releases no capacity.
 */
export function createExecutionStore(db: Database.Database, options: ExecutionStoreOptions = {}) {
    assertSupportedSqliteRuntime();
    const now = options.now ?? (() => new Date());
    function request(requestId: string): RequestRow {
        const row = db.prepare(`SELECT r.request_id,r.state,r.stake_hash,r.payload_hash,r.request_json,r.prepared_commitment,r.prepared_json,
      p.suspended,p.mode FROM credit_requests r JOIN credit_portfolios p USING(portfolio_key)
      WHERE r.request_id=?`).get(requestId) as RequestRow | undefined;
        if (!row)
            throw new RegistryError("NOT_FOUND");
        return row;
    }
    function claimRow(requestId: string): ClaimRow | undefined {
        return db.prepare("SELECT * FROM credit_execution_claims WHERE request_id=?").get(requestId) as ClaimRow | undefined;
    }
    function checkGuard(guard: ExecutionGuard): void {
        if (guard.acquired !== true || !nonempty(guard.requestId) || !nonempty(guard.owner) ||
            !Number.isSafeInteger(guard.fence) || guard.fence < 1)
            throw new RegistryError("INVALID_EXECUTION_GUARD");
        const claim = claimRow(guard.requestId);
        if (!claim || claim.active !== 1 || claim.owner !== guard.owner || claim.fence !== guard.fence)
            throw new RegistryError("STALE_EXECUTION_GUARD");
    }
    function attemptRow(requestId: string, attemptPhase: AttemptPhase): AttemptRow | undefined {
        return db.prepare("SELECT * FROM credit_attempts WHERE request_id=? AND phase=?")
            .get(requestId, attemptPhase) as AttemptRow | undefined;
    }
    function claimExecution(requestId: string, owner: string): ExecutionClaim {
        if (!nonempty(requestId) || !nonempty(owner))
            throw new RegistryError("INVALID_EXECUTION_OWNER");
        return db.transaction((): ExecutionClaim => {
            request(requestId);
            const old = claimRow(requestId);
            if (old?.active === 1)
                return { acquired: old.owner === owner, requestId, owner: old.owner, fence: old.fence } as ExecutionClaim;
            const fence = old ? old.fence + 1 : 1;
            if (!Number.isSafeInteger(fence))
                throw new RegistryError("EXECUTION_FENCE_EXHAUSTED");
            db.prepare(`INSERT INTO credit_execution_claims(request_id,owner,fence,active) VALUES(?,?,?,1)
        ON CONFLICT(request_id) DO UPDATE SET owner=excluded.owner,fence=excluded.fence,active=1`)
                .run(requestId, owner, fence);
            return { acquired: true, requestId, owner, fence };
        }).immediate();
    }
    function releaseExecution(guard: ExecutionGuard): boolean {
        return db.transaction(() => {
            checkGuard(guard);
            return db.prepare("UPDATE credit_execution_claims SET active=0 WHERE request_id=? AND owner=? AND fence=? AND active=1")
                .run(guard.requestId, guard.owner, guard.fence).changes === 1;
        }).immediate();
    }
    function getAttempt(requestId: string, attemptPhase: AttemptPhase): StoredAttempt | null {
        if (!nonempty(requestId) || !phase(attemptPhase))
            throw new RegistryError("INVALID_ATTEMPT_IDENTITY");
        const row = attemptRow(requestId, attemptPhase);
        return row ? stored(row) : null;
    }
    function persistAttempt(guard: ExecutionGuard, input: SignedAttemptInput): StoredAttempt {
        if (!phase(input.phase) || !nonempty(input.attemptHash) || !nonempty(input.signedBlob) ||
            !uint32(input.sequence) || !uint32(input.lastLedgerSequence) || input.lastLedgerSequence === 0 ||
            !/^sha256:[a-f0-9]{64}$/.test(input.commitment))
            throw new RegistryError("INVALID_SIGNED_ATTEMPT");
        return db.transaction(() => {
            checkGuard(guard);
            const r = request(guard.requestId);
            const native = r.mode === "LIVE_DEVNET";
            if (native && (!/^[a-fA-F0-9]{64}$/.test(input.attemptHash) || !/^(?:[a-fA-F0-9]{2})+$/.test(input.signedBlob)))
                throw new RegistryError("INVALID_NATIVE_ATTEMPT");
            if (!native && (!input.attemptHash.startsWith("sim:") || !input.signedBlob.startsWith("sim:")))
                throw new RegistryError("SIMULATION_CANNOT_CLAIM_NATIVE_ATTEMPT");
            const candidate = { ...input, attemptHash: native ? input.attemptHash.toUpperCase() : input.attemptHash };
            const old = attemptRow(guard.requestId, input.phase);
            if (old) {
                if (old.attempt_hash !== candidate.attemptHash || old.signed_blob !== candidate.signedBlob ||
                    old.sequence !== candidate.sequence || old.last_ledger_sequence !== candidate.lastLedgerSequence ||
                    old.commitment !== candidate.commitment)
                    throw new RegistryError("IMMUTABLE_ATTEMPT_CONFLICT");
                // Resume the one existing attempt after expiry or lifecycle progress. Never create another.
                return stored(old);
            }
            const json = JSON.parse(r.request_json) as {
                expires_at?: unknown;
            };
            const instant = now().getTime();
            if (!Number.isFinite(instant) || typeof json.expires_at !== "string" ||
                !Number.isFinite(Date.parse(json.expires_at)) || Date.parse(json.expires_at) <= instant)
                throw new RegistryError("DENY_OFFER_EXPIRED");
            if (r.suspended === 1)
                throw new RegistryError("DENY_SUSPENDED");
            if (input.phase === "STAKE") {
                if (!["AWAITING_STAKE", "RECONCILING"].includes(r.state) || r.stake_hash)
                    throw new RegistryError("STAKE_ALREADY_BOUND");
                if (input.commitment !== r.payload_hash)
                    throw new RegistryError("DENY_TRANSACTION_MISMATCH");
            }
            else if (!["STAKE_VALIDATED", "RECONCILING"].includes(r.state) || !r.stake_hash) {
                throw new RegistryError("STAKE_REQUIRED");
            }
            else if (!r.prepared_commitment || candidate.commitment !== r.prepared_commitment) {
                throw new RegistryError("PREPARED_ACTION_REQUIRED");
            }
            if (db.prepare("SELECT 1 FROM credit_attempts WHERE attempt_hash=?").get(candidate.attemptHash))
                throw new RegistryError("ATTEMPT_HASH_ALREADY_BOUND");
            db.prepare(`INSERT INTO credit_attempts(request_id,phase,attempt_hash,signed_blob,sequence,last_ledger_sequence,state,commitment)
        VALUES(?,?,?,?,?,?,'PERSISTED',?)`).run(guard.requestId, candidate.phase, candidate.attemptHash, candidate.signedBlob, candidate.sequence, candidate.lastLedgerSequence, candidate.commitment);
            return stored(attemptRow(guard.requestId, input.phase)!);
        }).immediate();
    }
    /** Adapter supplies all finalized non-signature fields after autofill and verifies their commercial mapping. */
    function freezePreparedAction(guard: ExecutionGuard, input: {
        commercialTermsHash: string;
        preparedFields: Record<string, unknown>;
    }): string {
        if (input.preparedFields.TransactionType !== "LoanSet" || ["TxnSignature", "CounterpartySignature", "Signers"].some(k => k in input.preparedFields))
            throw new RegistryError("INVALID_PREPARED_FIELDS");
        const fields = canonicalJson(input.preparedFields);
        return db.transaction(() => {
            checkGuard(guard);
            const r = request(guard.requestId);
            const approved = JSON.parse(r.request_json) as {
                commercial_terms_hash: string;
                expires_at: string;
            };
            const commitment = contentHash({ contract_version: "C0-REP-1", request_hash: r.payload_hash, commercial_terms_hash: input.commercialTermsHash, prepared_fields: JSON.parse(fields) });
            if (approved.commercial_terms_hash !== input.commercialTermsHash)
                throw new RegistryError("DENY_TRANSACTION_MISMATCH");
            if (r.prepared_commitment) {
                if (r.prepared_commitment !== commitment || r.prepared_json !== fields)
                    throw new RegistryError("PREPARED_ACTION_CONFLICT");
                return commitment;
            }
            if (r.suspended === 1)
                throw new RegistryError("DENY_SUSPENDED");
            if (!r.stake_hash || !["STAKE_VALIDATED", "RECONCILING"].includes(r.state))
                throw new RegistryError("STAKE_REQUIRED");
            if (Date.parse(approved.expires_at) <= now().getTime())
                throw new RegistryError("DENY_OFFER_EXPIRED");
            db.prepare("UPDATE credit_requests SET prepared_commitment=?,prepared_json=? WHERE request_id=?").run(commitment, fields, guard.requestId);
            return commitment;
        }).immediate();
    }
    function markAttemptState(guard: ExecutionGuard, attemptPhase: AttemptPhase, nextState: AttemptState): StoredAttempt {
        if (!phase(attemptPhase) || !Object.prototype.hasOwnProperty.call(transitions, nextState))
            throw new RegistryError("INVALID_ATTEMPT_STATE");
        return db.transaction(() => {
            checkGuard(guard);
            const old = attemptRow(guard.requestId, attemptPhase);
            if (!old)
                throw new RegistryError("ATTEMPT_NOT_FOUND");
            if (!transitions[old.state].has(nextState))
                throw new RegistryError("INVALID_ATTEMPT_TRANSITION");
            db.prepare("UPDATE credit_attempts SET state=? WHERE request_id=? AND phase=?")
                .run(nextState, guard.requestId, attemptPhase);
            return stored(attemptRow(guard.requestId, attemptPhase)!);
        }).immediate();
    }
    function getPreparedAction(requestId: string): { preparedFields: Record<string, unknown>; commitment: string } | null {
        const row = request(requestId);
        return row.prepared_json && row.prepared_commitment ? { preparedFields: JSON.parse(row.prepared_json), commitment: row.prepared_commitment } : null;
    }
    function getExecutionClaim(requestId: string) {
        request(requestId); const row = claimRow(requestId);
        return row ? { requestId, owner: row.owner, fence: row.fence, active: row.active === 1 } : null;
    }
    /** Explicit operator acknowledgement only. Never a timer or automatic takeover. */
    function acknowledgeExecutionRecovery(requestId: string, expectedOwner: string, expectedFence: number): boolean {
        request(requestId);
        if (!nonempty(expectedOwner) || !Number.isSafeInteger(expectedFence) || expectedFence < 1) throw new RegistryError("INVALID_RECOVERY_ACK");
        return db.prepare("UPDATE credit_execution_claims SET active=0,fence=fence+1 WHERE request_id=? AND owner=? AND fence=? AND active=1")
            .run(requestId, expectedOwner, expectedFence).changes === 1;
    }
    return { claimExecution, releaseExecution, getAttempt, persistAttempt, freezePreparedAction, markAttemptState,
        getPreparedAction, getExecutionClaim, acknowledgeExecutionRecovery };
}
