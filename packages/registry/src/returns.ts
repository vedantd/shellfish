import type Database from "better-sqlite3";
import { canonicalJson, type NetworkMode, type RepAssetRef } from "@shellfish/schemas";
import { contentHash } from "./commitments.js";
import { assertSupportedSqliteRuntime, RegistryError } from "./registry.js";

export const MAX_RETURN_ATTEMPTS = 3;
export type ReturnAttemptState = "PERSISTED" | "SUBMITTED" | "RECONCILING" | "NOT_APPLIED" | "VALIDATED";
export interface ReturnGuard {
    acquired: true;
    creditId: string;
    issuerKey: string;
    /** Unique worker instance, never a shared human/account name. */
    owner: string;
    fence: number;
}
export type ReturnClaim = ReturnGuard | {
    acquired: false; creditId: string; issuerKey: string; activeCreditId: string; owner: string | null; fence: number;
};
export interface ReturnInstruction {
    creditId: string; network: string; mode: NetworkMode; issuer: string; destination: string;
    repAsset: RepAssetRef; amountU: string; instructionHash: string;
}
export interface SignedReturnInput {
    attemptHash: string;
    /** Internal storage only. Never expose in HTTP responses, logs or public receipts. */
    signedBlob: string;
    /** Last validated ledger observed before signing. Persist before any submission. */
    firstLedgerSequence: number;
    preparedFields: Record<string, unknown>;
}
export interface StoredReturnAttempt extends SignedReturnInput {
    creditId: string; attemptNumber: number; sequence: number; lastLedgerSequence: number;
    commitment: string; state: ReturnAttemptState;
}
export type ReturnFailureEvidence =
    | { kind: "VALIDATED_FAILURE"; txHash: string; ledgerIndex: number; transactionIndex: number; result: string }
    | { kind: "EXPIRED_NOT_FOUND"; txHash: string; validatedLedgerIndex: number;
        historyFromLedger: number; historyToLedger: number; accountSequence: number }
    | { kind: "SIMULATED_NOT_APPLIED" };
export interface ReturnStoreOptions {
    /** Authenticate final failure or gap-free absence. A client Boolean is never evidence. */
    verifyReturnFailure?: (evidence: Readonly<ReturnFailureEvidence>, context: Readonly<{
        instruction: ReturnInstruction; attempt: StoredReturnAttempt;
    }>) => Promise<void>;
}
interface CreditRow {
    credit_id: string; amount_u: string; state: string; network: string; mode: NetworkMode;
    borrower_account: string; rep_asset_json: string;
}
interface LaneRow {
    issuer_key: string; active_credit_id: string | null; owner: string | null;
    fence: number; claimed: number; next_sequence_floor: number;
}
interface AttemptRow {
    credit_id: string; attempt_number: number; attempt_hash: string; signed_blob: string;
    first_ledger_sequence: number; sequence: number; last_ledger_sequence: number;
    prepared_json: string; commitment: string; state: ReturnAttemptState; failure_json: string | null;
}
const uint32 = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 0xffffffff;
const nonempty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const unresolved = (state: ReturnAttemptState) => state !== "NOT_APPLIED" && state !== "VALIDATED";
const memoType = Buffer.from("shellfish.rep.return.v1").toString("hex").toUpperCase();
function memo(instruction: ReturnInstruction) {
    return [{ Memo: { MemoType: memoType, MemoData: Buffer.from(instruction.instructionHash).toString("hex").toUpperCase() } }];
}
function stored(row: AttemptRow): StoredReturnAttempt {
    return { creditId: row.credit_id, attemptNumber: row.attempt_number, attemptHash: row.attempt_hash,
        signedBlob: row.signed_blob, firstLedgerSequence: row.first_ledger_sequence,
        sequence: row.sequence, lastLedgerSequence: row.last_ledger_sequence,
        preparedFields: JSON.parse(row.prepared_json) as Record<string, unknown>, commitment: row.commitment, state: row.state };
}

/**
 * Issuer-wide queue and append-only signed return history. Initialize the registry first.
 * The adapter must validate/decode the actual signed blob and its hash against every
 * prepared field before persistence. Submit only the persisted blob. No keys live here.
 */
export function createReturnStore(db: Database.Database, options: ReturnStoreOptions = {}) {
    assertSupportedSqliteRuntime();
    function credit(id: string): CreditRow {
        const row = db.prepare(`SELECT c.credit_id,c.amount_u,c.state,p.network,p.mode,p.borrower_account,p.rep_asset_json
            FROM rep_return_credits c JOIN credit_portfolios p USING(portfolio_key) WHERE c.credit_id=?`).get(id) as CreditRow | undefined;
        if (!row) throw new RegistryError("RETURN_CREDIT_REQUIRED");
        return row;
    }
    function instruction(c: CreditRow): ReturnInstruction {
        const repAsset = JSON.parse(c.rep_asset_json) as RepAssetRef;
        const body = { creditId: c.credit_id, network: c.network, mode: c.mode, issuer: repAsset.issuer,
            destination: c.borrower_account, repAsset, amountU: c.amount_u };
        return { ...body, instructionHash: contentHash({ domain: "SHELLFISH_REP_RETURN_V1", ...body }) };
    }
    function issuerKey(i: ReturnInstruction): string { return contentHash({ mode: i.mode, network: i.network, issuer: i.issuer }); }
    function lane(key: string): LaneRow | undefined {
        return db.prepare("SELECT * FROM rep_issuer_lanes WHERE issuer_key=?").get(key) as LaneRow | undefined;
    }
    function latest(id: string): AttemptRow | undefined {
        return db.prepare("SELECT * FROM rep_return_attempts WHERE credit_id=? ORDER BY attempt_number DESC LIMIT 1").get(id) as AttemptRow | undefined;
    }
    function checkGuard(g: ReturnGuard): { credit: CreditRow; lane: LaneRow; instruction: ReturnInstruction } {
        if (g.acquired !== true || !nonempty(g.owner) || !Number.isSafeInteger(g.fence) || g.fence < 1)
            throw new RegistryError("INVALID_RETURN_GUARD");
        const c = credit(g.creditId), i = instruction(c), l = lane(issuerKey(i));
        if (!l || g.issuerKey !== l.issuer_key || l.active_credit_id !== g.creditId ||
            l.claimed !== 1 || l.owner !== g.owner || l.fence !== g.fence)
            throw new RegistryError("STALE_RETURN_GUARD");
        if (c.state !== "OWED") throw new RegistryError("RETURN_ALREADY_PAID");
        return { credit: c, lane: l, instruction: i };
    }
    function claimReturn(creditId: string, owner: string): ReturnClaim {
        if (!nonempty(owner) || !nonempty(creditId)) throw new RegistryError("INVALID_RETURN_OWNER");
        return db.transaction((): ReturnClaim => {
            const c = credit(creditId), i = instruction(c), key = issuerKey(i);
            if (c.state !== "OWED") throw new RegistryError("RETURN_ALREADY_PAID");
            const old = lane(key);
            if (old && (old.claimed === 1 || (old.active_credit_id !== null && old.active_credit_id !== creditId))) {
                if (old.claimed === 1 && old.active_credit_id === creditId && old.owner === owner)
                    return { acquired: true, creditId, issuerKey: key, owner, fence: old.fence };
                return { acquired: false, creditId, issuerKey: key, activeCreditId: old.active_credit_id!, owner: old.owner, fence: old.fence };
            }
            const fence = (old?.fence ?? 0) + 1;
            if (!Number.isSafeInteger(fence)) throw new RegistryError("RETURN_FENCE_EXHAUSTED");
            db.prepare(`INSERT INTO rep_issuer_lanes(issuer_key,network,mode,issuer,active_credit_id,owner,fence,claimed,next_sequence_floor)
                VALUES(?,?,?,?,?,?,?,1,0) ON CONFLICT(issuer_key) DO UPDATE SET
                active_credit_id=excluded.active_credit_id,owner=excluded.owner,fence=excluded.fence,claimed=1`)
                .run(key, i.network, i.mode, i.issuer, creditId, owner, fence);
            return { acquired: true, creditId, issuerKey: key, owner, fence };
        }).immediate();
    }
    function releaseReturnWorker(g: ReturnGuard): boolean {
        return db.transaction(() => {
            if (g.acquired !== true || !nonempty(g.owner) || !Number.isSafeInteger(g.fence) || g.fence < 1)
                throw new RegistryError("INVALID_RETURN_GUARD");
            const c = credit(g.creditId), i = instruction(c), oldLane = lane(issuerKey(i));
            if (g.issuerKey !== issuerKey(i)) throw new RegistryError("STALE_RETURN_GUARD");
            // Finally-block cleanup after atomic settlement must never clear a newer claim.
            if (c.state === "PAID") return false;
            if (oldLane?.claimed === 0 && oldLane.fence === g.fence &&
                (oldLane.active_credit_id === null || oldLane.active_credit_id === g.creditId)) return false;
            checkGuard(g);
            const old = latest(g.creditId);
            // A released process is distinct from a reconciled issuer sequence.
            const activeCredit = old && unresolved(old.state) ? g.creditId : null;
            db.prepare("UPDATE rep_issuer_lanes SET claimed=0,owner=NULL,active_credit_id=? WHERE issuer_key=?").run(activeCredit, g.issuerKey);
            return true;
        }).immediate();
    }
    function getReturnInstruction(creditId: string): ReturnInstruction { return instruction(credit(creditId)); }
    function getReturnAttempt(creditId: string): StoredReturnAttempt | null {
        const row = latest(creditId); return row ? stored(row) : null;
    }
    function getReturnHistory(creditId: string): StoredReturnAttempt[] {
        return (db.prepare("SELECT * FROM rep_return_attempts WHERE credit_id=? ORDER BY attempt_number").all(creditId) as AttemptRow[]).map(stored);
    }
    function prepareReturnPayment(g: ReturnGuard, input: {
        sequence: number; lastLedgerSequence: number; feeDrops: string; signingPubKey?: string; networkId?: number;
    }): Record<string, unknown> {
        const { instruction: i } = checkGuard(g);
        const fields: Record<string, unknown> = { TransactionType: "Payment", Account: i.issuer, Destination: i.destination,
            Amount: { mpt_issuance_id: i.repAsset.mpt_issuance_id, value: i.amountU }, Flags: 0,
            Sequence: input.sequence, LastLedgerSequence: input.lastLedgerSequence, Fee: input.feeDrops, Memos: memo(i) };
        if (input.signingPubKey !== undefined) fields.SigningPubKey = input.signingPubKey;
        if (input.networkId !== undefined) {
            if (!Number.isSafeInteger(input.networkId) || input.networkId < 0 || input.networkId > 0xffffffff)
                throw new RegistryError("INVALID_RETURN_NETWORK");
            // Mainnet/Testnet/Devnet and all IDs <=1024 forbid this serialized field.
            if (input.networkId > 1024) fields.NetworkID = input.networkId;
        }
        validateFields(i, fields);
        return fields;
    }
    function validateFields(i: ReturnInstruction, f: Record<string, unknown>): void {
        const allowed = new Set(["TransactionType", "Account", "Destination", "Amount", "Flags", "Sequence", "LastLedgerSequence", "Fee", "Memos", "SigningPubKey", "NetworkID"]);
        if (Object.keys(f).some(k => !allowed.has(k)) || f.TransactionType !== "Payment" || f.Account !== i.issuer ||
            f.Destination !== i.destination || f.Flags !== 0 || !uint32(f.Sequence) || !uint32(f.LastLedgerSequence) ||
            typeof f.Fee !== "string" || !/^[1-9][0-9]*$/.test(f.Fee) ||
            canonicalJson(f.Amount) !== canonicalJson({ mpt_issuance_id: i.repAsset.mpt_issuance_id, value: i.amountU }) ||
            canonicalJson(f.Memos) !== canonicalJson(memo(i)) ||
            (f.SigningPubKey !== undefined && (typeof f.SigningPubKey !== "string" || !/^(?:[A-Fa-f0-9]{66})?$/.test(f.SigningPubKey))) ||
            (f.NetworkID !== undefined && (!uint32(f.NetworkID) || f.NetworkID <= 1024))) throw new RegistryError("INVALID_RETURN_PAYMENT");
    }
    function persistReturnAttempt(g: ReturnGuard, raw: SignedReturnInput): StoredReturnAttempt {
        const input = JSON.parse(canonicalJson(raw)) as SignedReturnInput;
        if (!uint32(input.firstLedgerSequence) || !nonempty(input.attemptHash) || !nonempty(input.signedBlob))
            throw new RegistryError("INVALID_RETURN_ATTEMPT");
        return db.transaction(() => {
            const { credit: c, lane: l, instruction: i } = checkGuard(g);
            validateFields(i, input.preparedFields);
            const native = c.mode === "LIVE_DEVNET";
            if (native && (!/^[A-Fa-f0-9]{64}$/.test(input.attemptHash) || !/^(?:[A-Fa-f0-9]{2})+$/.test(input.signedBlob)))
                throw new RegistryError("INVALID_NATIVE_ATTEMPT");
            if (!native && (!input.attemptHash.startsWith("sim:") || !input.signedBlob.startsWith("sim:")))
                throw new RegistryError("SIMULATION_CANNOT_CLAIM_NATIVE_ATTEMPT");
            const hash = native ? input.attemptHash.toUpperCase() : input.attemptHash;
            const sequence = input.preparedFields.Sequence as number, last = input.preparedFields.LastLedgerSequence as number;
            const fields = canonicalJson(input.preparedFields), old = latest(g.creditId);
            if (old?.attempt_hash === hash) {
                if (old.signed_blob !== input.signedBlob || old.prepared_json !== fields || old.first_ledger_sequence !== input.firstLedgerSequence)
                    throw new RegistryError("IMMUTABLE_RETURN_CONFLICT");
                return stored(old);
            }
            if (old && unresolved(old.state)) throw new RegistryError("RETURN_RECONCILIATION_REQUIRED");
            if (old?.state === "VALIDATED") throw new RegistryError("RETURN_ALREADY_PAID");
            if ((old?.attempt_number ?? 0) >= MAX_RETURN_ATTEMPTS) throw new RegistryError("RETURN_ATTEMPT_LIMIT");
            if (last <= input.firstLedgerSequence || sequence < l.next_sequence_floor)
                throw new RegistryError("INVALID_RETURN_SEQUENCE");
            if (old?.failure_json) {
                const failure = JSON.parse(old.failure_json) as ReturnFailureEvidence;
                const finalLedger = failure.kind === "VALIDATED_FAILURE" ? failure.ledgerIndex :
                    failure.kind === "EXPIRED_NOT_FOUND" ? failure.validatedLedgerIndex : input.firstLedgerSequence;
                // Other reconciled credits can consume sequences between attempts. The signer
                // reads the current validated account sequence, subject to the persistent floor.
                if (native && input.firstLedgerSequence < finalLedger) throw new RegistryError("INVALID_RETURN_SEQUENCE");
            }
            if (db.prepare("SELECT 1 FROM rep_return_attempts WHERE network=? AND mode=? AND attempt_hash=?").get(i.network, i.mode, hash))
                throw new RegistryError("ATTEMPT_HASH_ALREADY_BOUND");
            const commitment = contentHash({ instruction_hash: i.instructionHash, prepared_fields: input.preparedFields });
            db.prepare(`INSERT INTO rep_return_attempts(credit_id,attempt_number,network,mode,issuer_key,attempt_hash,signed_blob,
                first_ledger_sequence,sequence,last_ledger_sequence,prepared_json,commitment,state)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'PERSISTED')`).run(g.creditId, (old?.attempt_number ?? 0) + 1,
                    i.network, i.mode, g.issuerKey, hash, input.signedBlob, input.firstLedgerSequence, sequence, last, fields, commitment);
            return stored(latest(g.creditId)!);
        }).immediate();
    }
    function markReturnUncertain(g: ReturnGuard, attemptHash: string, state: "SUBMITTED" | "RECONCILING"): StoredReturnAttempt {
        if (state !== "SUBMITTED" && state !== "RECONCILING") throw new RegistryError("INVALID_RETURN_STATE");
        return db.transaction(() => {
            checkGuard(g); const row = latest(g.creditId);
            if (!row || row.attempt_hash !== attemptHash || !unresolved(row.state)) throw new RegistryError("RETURN_ATTEMPT_MISMATCH");
            if (row.state === "RECONCILING" && state === "SUBMITTED") throw new RegistryError("INVALID_RETURN_TRANSITION");
            db.prepare("UPDATE rep_return_attempts SET state=? WHERE credit_id=? AND attempt_number=?").run(state, g.creditId, row.attempt_number);
            return stored(latest(g.creditId)!);
        }).immediate();
    }
    async function resolveNotApplied(g: ReturnGuard, attemptHash: string, raw: ReturnFailureEvidence): Promise<StoredReturnAttempt> {
        const guard = { ...g }, evidence = JSON.parse(canonicalJson(raw)) as ReturnFailureEvidence;
        const { credit: c, instruction: i } = checkGuard(guard), old = latest(guard.creditId);
        if (!old || old.attempt_hash !== attemptHash) throw new RegistryError("RETURN_ATTEMPT_MISMATCH");
        const encoded = canonicalJson(evidence);
        if (old.state === "NOT_APPLIED" && old.failure_json === encoded) return stored(old);
        if (!unresolved(old.state)) throw new RegistryError("RETURN_ATTEMPT_MISMATCH");
        let floor = old.sequence;
        if (c.mode === "SIMULATED_LOAN") {
            if (evidence.kind !== "SIMULATED_NOT_APPLIED") throw new RegistryError("SIMULATION_CANNOT_CLAIM_NATIVE_PROOF");
        } else {
            if (evidence.kind === "SIMULATED_NOT_APPLIED" || evidence.txHash.toUpperCase() !== old.attempt_hash)
                throw new RegistryError("INVALID_RETURN_RECONCILIATION");
            if (evidence.kind === "VALIDATED_FAILURE") {
                if (!uint32(evidence.ledgerIndex) || evidence.ledgerIndex < old.first_ledger_sequence || evidence.ledgerIndex > old.last_ledger_sequence ||
                    !Number.isSafeInteger(evidence.transactionIndex) || evidence.transactionIndex < 0 || !/^tec[A-Z0-9_]+$/.test(evidence.result))
                    throw new RegistryError("INVALID_RETURN_RECONCILIATION");
                floor = old.sequence + 1;
            } else if (evidence.kind === "EXPIRED_NOT_FOUND") {
                if (!uint32(evidence.validatedLedgerIndex) || evidence.validatedLedgerIndex <= old.last_ledger_sequence ||
                    !uint32(evidence.historyFromLedger) || evidence.historyFromLedger > old.first_ledger_sequence ||
                    !uint32(evidence.historyToLedger) || evidence.historyToLedger < evidence.validatedLedgerIndex || !uint32(evidence.accountSequence))
                    throw new RegistryError("INVALID_RETURN_RECONCILIATION");
                // Unexpected sequence advancement needs investigation, never automatic replacement.
                if (evidence.accountSequence !== old.sequence) throw new RegistryError("ISSUER_SEQUENCE_DIVERGED");
                floor = evidence.accountSequence;
            } else throw new RegistryError("INVALID_RETURN_RECONCILIATION");
            if (!options.verifyReturnFailure) throw new RegistryError("RETURN_FAILURE_VERIFIER_REQUIRED");
            const context = { instruction: i, attempt: stored(old) }, contextDigest = contentHash(context), evidenceDigest = contentHash(evidence);
            await options.verifyReturnFailure(Object.freeze(evidence), Object.freeze(context));
            if (contentHash(context) !== contextDigest || contentHash(evidence) !== evidenceDigest)
                throw new RegistryError("VERIFIER_MUTATED_EVENT");
        }
        return db.transaction(() => {
            checkGuard(guard); const current = latest(guard.creditId);
            if (current?.attempt_hash !== attemptHash) throw new RegistryError("RETURN_ATTEMPT_MISMATCH");
            if (current.state === "NOT_APPLIED" && current.failure_json === encoded) return stored(current);
            if (!unresolved(current.state)) throw new RegistryError("RETURN_ATTEMPT_MISMATCH");
            db.prepare("UPDATE rep_return_attempts SET state='NOT_APPLIED',failure_json=? WHERE credit_id=? AND attempt_number=?")
                .run(encoded, guard.creditId, current.attempt_number);
            db.prepare("UPDATE rep_issuer_lanes SET next_sequence_floor=max(next_sequence_floor,?) WHERE issuer_key=?").run(floor, guard.issuerKey);
            return stored(latest(guard.creditId)!);
        }).immediate();
    }
    return { claimReturn, releaseReturnWorker, getReturnInstruction, getReturnAttempt, getReturnHistory,
        prepareReturnPayment, persistReturnAttempt, markReturnUncertain, resolveNotApplied };
}
