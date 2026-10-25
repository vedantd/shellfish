import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { AssetRef, canonicalJson, CreditStatus, CreditQuote, CreditQuoteRequest, ReputationState, ReservationFixture, ScenarioFixture, type AtomicReservationRequest, type NetworkMode, type RepAssetRef, } from "@shellfish/schemas";
import { contentHash } from "./commitments.js";
import { calculateRepGrowthFromAreaU, maximumPrincipalMinor, quoteRepBondU, REP_POLICY } from "./curve.js";
import { REGISTRY_SCHEMA } from "./schema.js";
import type { EventBinding, FacilitySnapshot, PortfolioBinding, PortfolioSnapshot, RegistryEvent, RegistryOptions, RequestState, ReservationRecord, ReturnCredit, NativePortfolioSeed } from "./types.js";
import { PortfolioSeedSchema } from "./types.js";
type Row = Record<string, string | number | null>;
const text = (r: Row, k: string): string => String(r[k]);
const amount = (r: Row, k: string): bigint => BigInt(text(r, k));
const atomic = (v: string): bigint => {
    if (!/^(0|[1-9][0-9]*)$/.test(v))
        throw new RegistryError("INVALID_AMOUNT");
    return BigInt(v);
};
const pending = new Set<RequestState>(["AWAITING_STAKE", "STAKE_VALIDATED", "RECONCILING"]);
export const APPROVED_REP_POLICY_HASH = "sha256:7145bfb7a2359fd64bcca981a56cfa776c4e95056641577b38c653ccf9b65773";
export class RegistryError extends Error {
    constructor(public readonly code: string, message = code) { super(message); this.name = "RegistryError"; }
}
export function normalizeAsset(raw: unknown) {
    const a = AssetRef.parse(raw);
    return "mpt_issuance_id" in a ? { mpt_issuance_id: a.mpt_issuance_id.toUpperCase() } : a;
}
export function portfolioKey(binding: PortfolioBinding): string {
    return contentHash({ principalId: binding.principalId, network: binding.network, asset: normalizeAsset(binding.asset) });
}
/** Supported Node 24 runtime with the reviewed native SQLite binding. */
export function assertSupportedSqliteRuntime(): void {
    const major=Number(process.versions.node.split(".")[0]);
    const binding=createRequire(import.meta.url)("better-sqlite3/package.json") as {version:string};
    if(major!==24||binding.version!=="12.10.1")throw new RegistryError("SQLITE_RUNTIME_UNSUPPORTED","Use pinned Node 24.21.0 and better-sqlite3 12.10.1. Node 20 is EOL and the old SQLite 11 binding crashed on Node 24.");
}
export function initializeRegistrySchema(db: Database.Database): void {
    assertSupportedSqliteRuntime();
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.exec(REGISTRY_SCHEMA);
}
/** Owns accounting only. Signature and chain authenticity enter through the trusted verifier. */
export class CreditRegistry {
    private readonly now: () => Date;
    constructor(private readonly db: Database.Database, private readonly options: RegistryOptions = {}) {
        this.now = options.now ?? (() => new Date());
        initializeRegistrySchema(db);
    }
    private time(): number {
        const instant = this.now().getTime();
        if (!Number.isFinite(instant) || instant < 0)
            throw new RegistryError("INVALID_CLOCK");
        return Math.floor(instant / 1000);
    }
    private one(sql: string, ...args: (string | number | null)[]): Row | undefined {
        return this.db.prepare(sql).get(...args) as Row | undefined;
    }
    private need(sql: string, ...args: (string | number | null)[]): Row {
        const row = this.one(sql, ...args);
        if (!row)
            throw new RegistryError("NOT_FOUND");
        return row;
    }
    private portfolio(key: string): Row { return this.need("SELECT * FROM credit_portfolios WHERE portfolio_key=?", key); }
    private request(id: string): Row { return this.need("SELECT * FROM credit_requests WHERE request_id=?", id); }
    private record(row: Row): ReservationRecord {
        return { requestId: text(row, "request_id"), reservationId: text(row, "reservation_id"), state: text(row, "state") as RequestState,
            payloadHash: text(row, "payload_hash"), request: JSON.parse(text(row, "request_json")) as AtomicReservationRequest,
            principalMinor: text(row, "principal_minor"), originalBondU: text(row, "original_bond_u"),
            exposureBeforeMinor: text(row, "exposure_before_minor"), exposureVersion: Number(row.exposure_version),
            stakeHash: row.stake_hash as string | null, loanId: row.loan_id as string | null };
    }
    private rep(row: Row) {
        return ReputationState.parse({ seed_u: text(row, "seed_u"), available_u: text(row, "available_u"), reserved_u: text(row, "reserved_u"),
            bonded_u: text(row, "bonded_u"), pending_return_u: text(row, "pending_return_u"), growth_u: text(row, "growth_u"),
            forfeited_u: text(row, "forfeited_u"), suspended: row.suspended === 1, version: Number(row.version) });
    }
    private changeRep(key: string, changes: Partial<Record<"available_u" | "reserved_u" | "bonded_u" | "pending_return_u" | "growth_u" | "forfeited_u", bigint>>, suspend = false): void {
        const row = this.portfolio(key);
        const next = this.rep(row);
        for (const [field, delta] of Object.entries(changes)) {
            const k = field as keyof typeof changes;
            const v = BigInt(next[k] as string) + delta;
            if (v < 0n)
                throw new RegistryError("ACCOUNTING_UNDERFLOW");
            (next as Record<string, unknown>)[field] = v.toString();
        }
        next.suspended = next.suspended || suspend;
        next.version += 1;
        ReputationState.parse(next);
        this.db.prepare(`UPDATE credit_portfolios SET available_u=?,reserved_u=?,bonded_u=?,pending_return_u=?,growth_u=?,forfeited_u=?,suspended=?,version=? WHERE portfolio_key=?`)
            .run(next.available_u, next.reserved_u, next.bonded_u, next.pending_return_u, next.growth_u, next.forfeited_u, Number(next.suspended), next.version, key);
    }
    private changeFacility(id: string, committed: bigint, reserved: bigint): void {
        const f = this.need("SELECT * FROM credit_facilities WHERE facility_id=?", id);
        const c = amount(f, "committed_minor") + committed, r = amount(f, "reserved_minor") + reserved;
        if (c < 0n || r < 0n || c + r > amount(f, "limit_minor"))
            throw new RegistryError("FACILITY_ACCOUNTING_ERROR");
        this.db.prepare("UPDATE credit_facilities SET committed_minor=?,reserved_minor=?,version=version+1 WHERE facility_id=?").run(c.toString(), r.toString(), id);
    }
    private exposure(key: string): {
        active: bigint;
        reserved: bigint;
        defaulted: bigint;
    } {
        const loans = this.db.prepare("SELECT outstanding_minor,defaulted_minor,state FROM credit_loans WHERE portfolio_key=?").all(key) as Row[];
        const requests = this.db.prepare("SELECT principal_minor,state FROM credit_requests WHERE portfolio_key=?").all(key) as Row[];
        return { active: loans.reduce((n, l) => n + (l.state === "ACTIVE" ? amount(l, "outstanding_minor") : 0n), 0n),
            reserved: requests.reduce((n, r) => n + (pending.has(text(r, "state") as RequestState) ? amount(r, "principal_minor") : 0n), 0n),
            defaulted: loans.reduce((n, l) => n + amount(l, "defaulted_minor"), 0n) };
    }
    getPortfolio(binding: PortfolioBinding): PortfolioSnapshot {
        const key = portfolioKey(binding), p = this.portfolio(key), e = this.exposure(key);
        const fs = this.db.prepare("SELECT committed_minor,reserved_minor FROM credit_facilities WHERE portfolio_key=?").all(key) as Row[];
        return { portfolioKey: key, active_principal_minor: e.active.toString(), reserved_principal_minor: e.reserved.toString(),
            defaulted_principal_minor: e.defaulted.toString(), facility_committed_minor: fs.reduce((n, f) => n + amount(f, "committed_minor"), 0n).toString(),
            facility_reserved_minor: fs.reduce((n, f) => n + amount(f, "reserved_minor"), 0n).toString(), reputation: this.rep(p) };
    }
    getFacility(id: string): FacilitySnapshot {
        const f = this.need("SELECT * FROM credit_facilities WHERE facility_id=?", id), p = this.portfolio(text(f, "portfolio_key"));
        return { facilityId: id, lenderId: text(f, "lender_id"), principalId: text(p, "principal_id"), network: text(p, "network"), asset: JSON.parse(text(p, "asset_json")),
            approvedLimitMinor: text(f, "limit_minor"), committedMinor: text(f, "committed_minor"), reservedMinor: text(f, "reserved_minor"),
            headroomMinor: (amount(f, "limit_minor") - amount(f, "committed_minor") - amount(f, "reserved_minor")).toString(), version: Number(f.version) };
    }
    /** One coherent read transaction. This is registry state, not a newly attested passport. */
    getCreditStatus(facilityId: string): CreditStatus {
        return this.db.transaction(() => {
            const facility = this.getFacility(facilityId);
            const key = portfolioKey({ principalId: facility.principalId, network: facility.network, asset: facility.asset });
            const p = this.portfolio(key), portfolio = this.getPortfolio(facility);
            const { portfolioKey: _key, ...snapshot } = portfolio;
            return CreditStatus.parse({ contract_version: "C0-REP-1", model_version: p.model_version,
                network: p.network, mode: p.mode, principal_id: p.principal_id, asset: facility.asset,
                rep_asset: JSON.parse(text(p, "rep_asset_json")), money_scale: p.money_scale, rep_scale: 1000000,
                policy_hash: p.policy_hash, observed_at: new Date(this.time() * 1000).toISOString(),
                coverage: "participating_sources_only", facility: {
                    facility_id: facility.facilityId, lender_id: facility.lenderId,
                    approved_limit_minor: facility.approvedLimitMinor, committed_minor: facility.committedMinor,
                    reserved_minor: facility.reservedMinor, headroom_minor: facility.headroomMinor, version: facility.version,
                }, portfolio: snapshot,
                exposure_for_curve_minor: (BigInt(snapshot.active_principal_minor) + BigInt(snapshot.reserved_principal_minor)).toString(),
            });
        })();
    }
    /** Read-only estimate. Final reserveRequest recomputes against its own atomic snapshot. */
    quoteCredit(facilityId: string, raw: unknown): CreditQuote {
        const input = CreditQuoteRequest.parse(raw), status = this.getCreditStatus(facilityId);
        const exposure = BigInt(status.exposure_for_curve_minor), principal = BigInt(input.principal_minor);
        const available = BigInt(status.portfolio.reputation.available_u), headroom = BigInt(status.facility.headroom_minor);
        const scale = BigInt(status.money_scale), bond = quoteRepBondU(exposure, principal, scale);
        const consent = input.max_stake_u === undefined ? available : BigInt(input.max_stake_u);
        const reasons: CreditQuote["reason_codes"] = [];
        if (status.portfolio.reputation.suspended) reasons.push("DENY_SUSPENDED");
        if (principal > headroom) reasons.push("DENY_CAPACITY");
        if (bond > available) reasons.push("DENY_REP_CAPACITY");
        if (input.max_stake_u !== undefined && bond > consent) reasons.push("DENY_REP_CONSENT");
        const maximum = status.portfolio.reputation.suspended ? 0n : maximumPrincipalMinor({
            exposureMinor: exposure, availableRepU: available < consent ? available : consent,
            monetaryUpperBoundMinor: headroom, moneyScale: scale,
        });
        const body = { contract_version: status.contract_version, model_version: status.model_version,
            network: status.network, mode: status.mode, principal_id: status.principal_id, facility_id: facilityId,
            asset: status.asset, policy_hash: status.policy_hash, observed_at: status.observed_at,
            exposure_version: status.portfolio.reputation.version, facility_version: status.facility.version,
            exposure_before_minor: status.exposure_for_curve_minor, principal_minor: input.principal_minor, bond_u: bond.toString(),
            available_rep_u: status.portfolio.reputation.available_u, facility_headroom_minor: status.facility.headroom_minor,
            max_stake_u: input.max_stake_u ?? null, maximum_additional_principal_minor: maximum.toString(),
            fits_registry_limits: reasons.length === 0, reason_codes: reasons, grants_permission: false, reservation_required: true,
        };
        return CreditQuote.parse({ ...body, quote_hash: contentHash(body) });
    }
    /** Trusted lender-adapter setup. Adds no debt and cannot reseed principal REP. */
    addFacility(binding: PortfolioBinding, input: {
        facilityId: string;
        lenderId: string;
        approvedLimitMinor: string;
    }): FacilitySnapshot {
        if (!input.facilityId || !input.lenderId || atomic(input.approvedLimitMinor) <= 0n)
            throw new RegistryError("INVALID_FACILITY");
        const key = portfolioKey(binding);
        this.portfolio(key);
        return this.db.transaction(() => {
            const old = this.one("SELECT * FROM credit_facilities WHERE facility_id=?", input.facilityId);
            if (old) {
                if (old.portfolio_key !== key || old.lender_id !== input.lenderId || old.limit_minor !== input.approvedLimitMinor)
                    throw new RegistryError("FACILITY_CONFLICT");
            }
            else
                this.db.prepare("INSERT INTO credit_facilities VALUES (?,?,?,?, '0','0',1)").run(input.facilityId, key, input.lenderId, input.approvedLimitMinor);
            return this.getFacility(input.facilityId);
        }).immediate();
    }
    getRequest(id: string): ReservationRecord { return this.record(this.request(id)); }
    getLoan(id: string): Record<string, string | number | null> { return { ...this.need("SELECT * FROM credit_loans WHERE loan_id=?", id) }; }
    getReturnCredits(binding: PortfolioBinding): ReturnCredit[] {
        return (this.db.prepare("SELECT * FROM rep_return_credits WHERE portfolio_key=? ORDER BY credit_id").all(portfolioKey(binding)) as Row[]).map(r => ({
            creditId: text(r, "credit_id"), requestId: r.request_id as string | null, loanId: r.loan_id as string | null, amountU: text(r, "amount_u"), growthU: text(r, "growth_u"),
            reason: text(r, "reason") as ReturnCredit["reason"], state: text(r, "state") as ReturnCredit["state"], returnHash: r.return_hash as string | null
        }));
    }
    /** Explicit, idempotent synthetic setup. Native enrollment requires a separately verified portfolio sync. */
    seedScenario(raw: unknown, borrowerAccount: string): void {
        const s = ScenarioFixture.parse(raw);
        if (s.mode !== "SIMULATED_LOAN")
            throw new RegistryError("NATIVE_SEED_REQUIRES_VERIFIED_SYNC");
        this.installSeed(s, borrowerAccount);
    }
    /** Trusted bootstrap verifies issuer, balances, linked identity and every opening obligation outside SQL. */
    async initializeNativePortfolio(raw: unknown, borrowerAccount: string, evidence: unknown): Promise<void> {
        const s = PortfolioSeedSchema.parse(raw);
        if (s.mode !== "LIVE_DEVNET" || !this.options.verifyNativePortfolio)
            throw new RegistryError("NATIVE_SEED_REQUIRES_VERIFIED_SYNC");
        if (s.opening_loans.length || atomic(s.opening.active_principal_minor) !== 0n || atomic(s.opening.reputation.bonded_u) !== 0n)
            throw new RegistryError("NATIVE_OPENING_HISTORY_REQUIRED", "Existing native obligations require a verified opening-history contract. Do not seed or omit that exposure.");
        const fingerprint = contentHash(s);
        await this.options.verifyNativePortfolio(Object.freeze(s), borrowerAccount, evidence);
        if (contentHash(s) !== fingerprint)
            throw new RegistryError("VERIFIER_MUTATED_SEED");
        this.installSeed(s, borrowerAccount);
    }
    private installSeed(s: NativePortfolioSeed, borrowerAccount: string): void {
        if (s.policy_hash !== APPROVED_REP_POLICY_HASH || atomic(s.opening.reputation.seed_u) !== REP_POLICY.seedRepU)
            throw new RegistryError("UNSUPPORTED_POLICY");
        if (!borrowerAccount)
            throw new RegistryError("DENY_IDENTITY");
        const key = portfolioKey({ principalId: s.principal_id, network: s.network, asset: s.loan_asset }), seedHash = contentHash({ scenario: s, borrowerAccount });
        this.db.transaction(() => {
            const old = this.one("SELECT seed_hash FROM credit_portfolios WHERE portfolio_key=?", key);
            if (old) {
                if (old.seed_hash !== seedHash)
                    throw new RegistryError("SEED_CONFLICT");
                return;
            }
            if (this.one("SELECT 1 FROM credit_portfolios WHERE network=? AND (principal_id=? OR borrower_account=?)", s.network, s.principal_id, borrowerAccount))
                throw new RegistryError("PRINCIPAL_ALREADY_ENROLLED");
            const rep = s.opening.reputation;
            if (atomic(s.opening.reserved_principal_minor) !== 0n || atomic(rep.reserved_u) !== 0n || atomic(rep.pending_return_u) !== 0n || atomic(rep.growth_u) !== 0n || atomic(rep.forfeited_u) !== 0n)
                throw new RegistryError("SEED_REQUIRES_OPENING_HISTORY");
            if (s.opening_loans.reduce((n, l) => n + atomic(l.principal_minor), 0n) !== atomic(s.opening.active_principal_minor) ||
                s.opening_loans.reduce((n, l) => n + atomic(l.original_bond_u), 0n) !== atomic(rep.bonded_u))
                throw new RegistryError("INVALID_OPENING_LOANS");
            const args = { key, principal: s.principal_id, network: s.network, mode: s.mode, asset: canonicalJson(normalizeAsset(s.loan_asset)), rep: canonicalJson(s.rep_asset), borrower: borrowerAccount,
                scale: String(s.money_scale), policy: s.policy_hash, model: s.model_version, ...rep, suspended: Number(rep.suspended), seedHash };
            this.db.prepare(`INSERT INTO credit_portfolios VALUES (@key,@principal,@network,@mode,@asset,@rep,@borrower,@scale,@policy,@model,@seed_u,@available_u,@reserved_u,@bonded_u,@pending_return_u,@growth_u,@forfeited_u,@suspended,@version,@seedHash)`).run(args);
            this.db.prepare("INSERT INTO credit_facilities VALUES (?,?,?,?,?,?,?)").run(s.facility.facility_id, key, s.facility.lender_id, s.facility.limit_minor, s.opening.facility_committed_minor, s.opening.facility_reserved_minor, s.facility.version);
            if (atomic(s.opening.facility_committed_minor) !== atomic(s.opening.active_principal_minor) || atomic(s.opening.facility_reserved_minor) !== 0n)
                throw new RegistryError("INVALID_OPENING_FACILITY");
            if (atomic(s.opening.facility_committed_minor) > atomic(s.facility.limit_minor))
                throw new RegistryError("INVALID_OPENING_FACILITY");
            for (const l of s.opening_loans) {
                const t = Math.floor(Date.parse(s.clock) / 1000), m = Math.floor(Date.parse(l.maturity) / 1000);
                if (m <= t)
                    throw new RegistryError("INVALID_MATURITY");
                this.db.prepare(`INSERT INTO credit_loans (loan_id,portfolio_key,facility_id,request_id,principal_minor,outstanding_minor,original_bond_u,state,origin_time,maturity_time,next_due_time,last_accrual_time,origin_hash) VALUES (?,?,?,NULL,?,?,?,'ACTIVE',?,?,?,?,?)`)
                    .run(l.loan_id, key, s.facility.facility_id, l.principal_minor, l.principal_minor, l.original_bond_u, t, m, m, t, l.loan_id);
            }
        }).immediate();
    }
    /** Internal authorization consumer. Caller authenticates mandate/offer before invoking this method. */
    reserveRequest(raw: unknown): ReservationRecord {
        const input = ReservationFixture.shape.request.parse(raw);
        const key = portfolioKey({ principalId: input.principal_id, network: input.network, asset: input.asset }), hash = contentHash(input);
        return this.db.transaction(() => {
            const existing = this.one("SELECT * FROM credit_requests WHERE portfolio_key=? AND idempotency_key=?", key, input.idempotency_key);
            if (existing) {
                if (existing.payload_hash !== hash)
                    throw new RegistryError("DENY_IDEMPOTENCY_CONFLICT");
                return this.record(existing);
            }
            if (this.one("SELECT 1 FROM credit_requests WHERE request_id=?", input.request_id))
                throw new RegistryError("DENY_IDEMPOTENCY_CONFLICT");
            const p = this.portfolio(key);
            if (p.suspended === 1)
                throw new RegistryError("DENY_SUSPENDED");
            if (text(p, "mode") !== input.mode || text(p, "model_version") !== input.model_version || text(p, "policy_hash") !== input.policy_hash ||
                canonicalJson(input.rep_asset) !== text(p, "rep_asset_json"))
                throw new RegistryError("DENY_REP_CONSENT");
            if (Date.parse(input.expires_at) <= this.time() * 1000)
                throw new RegistryError("DENY_OFFER_EXPIRED");
            if (this.one("SELECT 1 FROM credit_mandate_uses WHERE principal_id=? AND (mandate_id=? OR nonce=?)", input.principal_id, input.mandate_id, input.nonce))
                throw new RegistryError("DENY_REPLAY");
            const f = this.getFacility(input.facility_id);
            if (f.principalId !== input.principal_id || f.network !== input.network || canonicalJson(normalizeAsset(f.asset)) !== canonicalJson(normalizeAsset(input.asset)))
                throw new RegistryError("DENY_ASSET");
            const e = this.exposure(key), principal = atomic(input.principal_minor);
            if (principal <= 0n)
                throw new RegistryError("INVALID_AMOUNT");
            const b = quoteRepBondU(e.active + e.reserved, principal, amount(p, "money_scale"));
            if (principal > BigInt(f.headroomMinor))
                throw new RegistryError("DENY_CAPACITY");
            if (b > amount(p, "available_u"))
                throw new RegistryError("DENY_REP_CAPACITY");
            if (b > atomic(input.max_stake_u))
                throw new RegistryError("DENY_REP_CONSENT");
            const reservationId = `res:${randomUUID()}`;
            this.changeRep(key, { available_u: -b, reserved_u: b });
            this.changeFacility(input.facility_id, 0n, principal);
            this.db.prepare(`INSERT INTO credit_requests (request_id,portfolio_key,idempotency_key,payload_hash,request_json,facility_id,reservation_id,principal_minor,original_bond_u,exposure_before_minor,exposure_version,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'AWAITING_STAKE',?)`)
                .run(input.request_id, key, input.idempotency_key, hash, canonicalJson(input), input.facility_id, reservationId, input.principal_minor, b.toString(), (e.active + e.reserved).toString(), Number(p.version), this.time());
            this.db.prepare("INSERT INTO credit_mandate_uses VALUES (?,?,?,?)").run(input.principal_id, input.mandate_id, input.nonce, input.request_id);
            return this.getRequest(input.request_id);
        }).immediate();
    }
    private eventContext(e: RegistryEvent): {
        p: Row;
        r?: Row;
        l?: Row;
        c?: Row;
        binding: EventBinding;
    } {
        const r = e.requestId ? this.request(e.requestId) : undefined;
        const c = e.creditId ? this.need("SELECT * FROM rep_return_credits WHERE credit_id=?", e.creditId) : undefined;
        const loanId = e.loanId ?? (r?.loan_id as string | null) ?? (c?.loan_id as string | null);
        const l = loanId ? this.need("SELECT * FROM credit_loans WHERE loan_id=?", loanId) : undefined;
        const key = r?.portfolio_key ?? l?.portfolio_key ?? c?.portfolio_key;
        if (!key)
            throw new RegistryError("INVALID_EVENT_BINDING");
        if ([r, l, c].some(x => x && x.portfolio_key !== key))
            throw new RegistryError("INVALID_EVENT_BINDING");
        if (r && l && l.request_id !== r.request_id)
            throw new RegistryError("INVALID_EVENT_BINDING");
        if (c && r && c.request_id !== r.request_id)
            throw new RegistryError("INVALID_EVENT_BINDING");
        if (c && ((e.loanId !== undefined && e.loanId !== c.loan_id) || (l && l.loan_id !== c.loan_id)))
            throw new RegistryError("INVALID_EVENT_BINDING");
        if (c && l && c.request_id !== l.request_id)
            throw new RegistryError("INVALID_EVENT_BINDING");
        const p = this.portfolio(String(key));
        const attempt = c ? this.one("SELECT * FROM rep_return_attempts WHERE credit_id=? ORDER BY attempt_number DESC LIMIT 1", text(c, "credit_id")) : undefined;
        return { p, ...(r ? { r } : {}), ...(l ? { l } : {}), ...(c ? { c } : {}), binding: { principalId: text(p, "principal_id"), network: text(p, "network"),
                mode: text(p, "mode") as NetworkMode, asset: JSON.parse(text(p, "asset_json")), repAsset: JSON.parse(text(p, "rep_asset_json")) as RepAssetRef,
                borrowerAccount: text(p, "borrower_account"), policyHash: text(p, "policy_hash"), request: r ? this.record(r) : null,
                returnCredit: c ? { creditId: text(c, "credit_id"), requestId: c.request_id as string | null, loanId: c.loan_id as string | null,
                    amountU: text(c, "amount_u"), growthU: text(c, "growth_u"), reason: text(c, "reason") as ReturnCredit["reason"],
                    state: text(c, "state") as ReturnCredit["state"], returnHash: c.return_hash as string | null } : null,
                returnAttempt: attempt ? { attemptHash: text(attempt, "attempt_hash"), sequence: Number(attempt.sequence),
                    firstLedgerSequence: Number(attempt.first_ledger_sequence), lastLedgerSequence: Number(attempt.last_ledger_sequence),
                    commitment: text(attempt, "commitment"), preparedFields: JSON.parse(text(attempt, "prepared_json")) } : null } };
    }
    private history(loan: Row, e: RegistryEvent): void {
        if (e.history?.complete !== true || e.history.originHash !== loan.origin_hash || e.history.previousEventId !== (loan.event_cursor ?? null))
            throw new RegistryError("HISTORY_INCOMPLETE", "Backfill complete ordered history before applying this loan event");
        if (e.occurredAt < Number(loan.last_accrual_time))
            throw new RegistryError("EVENT_ORDER_ERROR");
    }
    private queueCredit(p: Row, r: Row | undefined, l: Row | undefined, amountU: bigint, growthU: bigint, reason: ReturnCredit["reason"], at: number): void {
        const requestId = r?.request_id ?? l?.request_id ?? null;
        const id = `credit:${contentHash({ requestId, loanId: l?.loan_id ?? null, reason })}`;
        this.db.prepare("INSERT INTO rep_return_credits (credit_id,portfolio_key,request_id,loan_id,amount_u,growth_u,reason,state,created_at) VALUES (?,?,?,?,?,?,?,'OWED',?)")
            .run(id, p.portfolio_key, requestId, l?.loan_id ?? null, amountU.toString(), growthU.toString(), reason, at);
    }
    /** Authenticated adapter only. The native verifier runs before acquiring the SQL write lock. */
    async applyEvent(raw: RegistryEvent): Promise<PortfolioSnapshot> {
        const e = JSON.parse(canonicalJson(raw)) as RegistryEvent;
        if (!e.eventId || !Number.isSafeInteger(e.occurredAt) || e.occurredAt < 0 || e.occurredAt > this.time())
            throw new RegistryError("INVALID_EVENT_TIME");
        const digest = contentHash(e), prior = this.one("SELECT event_hash FROM credit_events WHERE event_id=?", e.eventId);
        const initial = this.eventContext(e);
        if (prior) {
            if (prior.event_hash !== digest)
                throw new RegistryError("EVENT_CONFLICT");
            return this.getPortfolio(initial.binding);
        }
        if (initial.binding.mode === "LIVE_DEVNET" && e.kind !== "UNKNOWN") {
            if (!this.options.verifyNativeEvent || !e.native || !/^[A-Fa-f0-9]{64}$/.test(e.native.txHash) ||
                !Number.isSafeInteger(e.native.ledgerIndex) || e.native.ledgerIndex < 0 || !Number.isSafeInteger(e.native.transactionIndex) || e.native.transactionIndex < 0)
                throw new RegistryError("NATIVE_VERIFIER_REQUIRED");
            const success = !(["CANCEL_BEFORE_BURN", "FAIL_AFTER_BURN"] as string[]).includes(e.kind);
            if (success && (e.native.validated !== true || e.native.result !== "tesSUCCESS"))
                throw new RegistryError("NATIVE_SUCCESS_REQUIRED");
            const expectedType: Partial<Record<RegistryEvent["kind"], string>> = { STAKE_VALIDATED: "Payment", ORIGINATION_VALIDATED: "LoanSet", REPAYMENT: "LoanPay", DEFAULT: "LoanManage", IMPAIRMENT: "LoanManage", UNIMPAIRMENT: "LoanManage", RETURN_VALIDATED: "Payment" };
            if (expectedType[e.kind] && e.native.transactionType !== expectedType[e.kind])
                throw new RegistryError("INVALID_NATIVE_TRANSACTION_TYPE");
            await this.options.verifyNativeEvent(Object.freeze(e), Object.freeze(initial.binding));
            if (contentHash(e) !== digest)
                throw new RegistryError("VERIFIER_MUTATED_EVENT");
        }
        else if (initial.binding.mode === "SIMULATED_LOAN" && e.native)
            throw new RegistryError("SIMULATION_CANNOT_CLAIM_NATIVE_PROOF");
        return this.db.transaction(() => {
            const duplicate = this.one("SELECT event_hash FROM credit_events WHERE event_id=?", e.eventId);
            const { p, r, l, c, binding } = this.eventContext(e), key = text(p, "portfolio_key");
            if (duplicate) {
                if (duplicate.event_hash !== digest)
                    throw new RegistryError("EVENT_CONFLICT");
                return this.getPortfolio(binding);
            }
            const hash = e.native?.txHash.toUpperCase() ?? (e.kind === "RETURN_VALIDATED" ? e.returned?.attemptHash : undefined) ?? `sim:${e.eventId}`;
            const b = r ? amount(r, "original_bond_u") : l ? amount(l, "original_bond_u") : 0n;
            const requestId = r?.request_id ?? l?.request_id ?? c?.request_id ?? null;
            if (r && e.occurredAt < Number(r.created_at))
                throw new RegistryError("INVALID_EVENT_TIME");
            switch (e.kind) {
                case "STAKE_VALIDATED": {
                    if (!r || !pending.has(text(r, "state") as RequestState) || !e.stake)
                        throw new RegistryError("INVALID_STATE");
                    const proof = e.stake;
                    if (atomic(proof.amountU) !== b || canonicalJson(proof.repAsset) !== text(p, "rep_asset_json") ||
                        proof.sender !== binding.borrowerAccount || proof.destination !== binding.repAsset.issuer || proof.requestHash !== r.payload_hash || proof.partialPayment !== false)
                        throw new RegistryError("DENY_STAKE_PROOF");
                    if (r.stake_hash && r.stake_hash !== hash)
                        throw new RegistryError("STAKE_ALREADY_BOUND");
                    if (this.one("SELECT 1 FROM credit_requests WHERE stake_hash=? AND request_id<>?", hash, text(r, "request_id")))
                        throw new RegistryError("DENY_STAKE_PROOF");
                    this.db.prepare("UPDATE credit_requests SET stake_hash=?,state='STAKE_VALIDATED' WHERE request_id=?").run(hash, r.request_id);
                    break;
                }
                case "ORIGINATION_VALIDATED": {
                    if (!r || !r.stake_hash || !pending.has(text(r, "state") as RequestState) || !e.loan)
                        throw new RegistryError("STAKE_REQUIRED");
                    const loan = e.loan;
                    const nextDue = loan.nextPaymentDueAt ?? loan.maturityAt;
                    if (!loan.loanId || !Number.isSafeInteger(loan.maturityAt) || loan.maturityAt <= e.occurredAt || !Number.isSafeInteger(loan.graceSeconds) || loan.graceSeconds < 0)
                        throw new RegistryError("INVALID_SCHEDULE");
                    if (!Number.isSafeInteger(nextDue) || nextDue <= e.occurredAt || nextDue > loan.maturityAt ||
                        (binding.mode === "LIVE_DEVNET" && loan.nextPaymentDueAt === undefined))
                        throw new RegistryError("INVALID_SCHEDULE");
                    this.changeRep(key, { reserved_u: -b, bonded_u: b });
                    this.changeFacility(text(r, "facility_id"), amount(r, "principal_minor"), -amount(r, "principal_minor"));
                    this.db.prepare(`INSERT INTO credit_loans (loan_id,portfolio_key,facility_id,request_id,principal_minor,outstanding_minor,original_bond_u,state,origin_time,maturity_time,next_due_time,grace_seconds,last_accrual_time,event_cursor,origin_hash) VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?,?,?)`)
                        .run(loan.loanId, key, r.facility_id, r.request_id, r.principal_minor, r.principal_minor, r.original_bond_u, e.occurredAt, loan.maturityAt, nextDue, loan.graceSeconds, e.occurredAt, e.eventId, hash);
                    this.db.prepare("UPDATE credit_requests SET state='ACTIVE',loan_id=? WHERE request_id=?").run(loan.loanId, r.request_id);
                    break;
                }
                case "UNKNOWN": {
                    if (r && pending.has(text(r, "state") as RequestState))
                        this.db.prepare("UPDATE credit_requests SET state='RECONCILING' WHERE request_id=?").run(r.request_id);
                    // Unknown returns stay OWED. Existing active loans are never counted twice as reservations.
                    break;
                }
                case "CANCEL_BEFORE_BURN":
                case "FAIL_AFTER_BURN": {
                    if (!r || !pending.has(text(r, "state") as RequestState) || e.conclusive !== true)
                        throw new RegistryError("CONCLUSIVE_FAILURE_REQUIRED");
                    const burned = !!r.stake_hash;
                    if ((e.kind === "FAIL_AFTER_BURN") !== burned)
                        throw new RegistryError("INVALID_BURN_STATE");
                    this.changeFacility(text(r, "facility_id"), 0n, -amount(r, "principal_minor"));
                    if (burned) {
                        this.changeRep(key, { reserved_u: -b, pending_return_u: b });
                        this.queueCredit(p, r, undefined, b, 0n, "FAILED_ORIGINATION", e.occurredAt);
                    }
                    else
                        this.changeRep(key, { reserved_u: -b, available_u: b });
                    this.db.prepare("UPDATE credit_requests SET state=? WHERE request_id=?").run(burned ? "RETURN_PENDING" : "CANCELLED", r.request_id);
                    break;
                }
                case "REPAYMENT":
                case "DEFAULT":
                case "IMPAIRMENT":
                case "UNIMPAIRMENT": {
                    if (!l || l.state !== "ACTIVE")
                        throw new RegistryError("LOAN_NOT_ACTIVE");
                    this.history(l, e);
                    const clipped = Math.min(e.occurredAt, Number(l.maturity_time));
                    const elapsed = Math.max(0, clipped - Number(l.last_accrual_time));
                    const area = amount(l, "reward_area") + amount(l, "outstanding_minor") * BigInt(elapsed);
                    let outstanding = amount(l, "outstanding_minor"), clean = l.clean === 1, impaired = l.ever_impaired === 1, state = "ACTIVE", defaulted = 0n, nextDue = Number(l.next_due_time);
                    if (e.kind === "REPAYMENT") {
                        if (!e.repayment || typeof e.repayment.onTime !== "boolean" || typeof e.repayment.fullContractualRepayment !== "boolean")
                            throw new RegistryError("REPAYMENT_DETAILS_REQUIRED");
                        const reduction = atomic(e.repayment.principalReductionMinor);
                        if (reduction > outstanding)
                            throw new RegistryError("INVALID_PRINCIPAL_REDUCTION");
                        outstanding -= reduction;
                        clean = clean && e.repayment.onTime && e.occurredAt <= Number(l.maturity_time);
                        if (e.repayment.nextPaymentDueAt !== undefined) {
                            const next = e.repayment.nextPaymentDueAt;
                            if (!Number.isSafeInteger(next) || next < Number(l.origin_time) || next > Number(l.maturity_time))
                                throw new RegistryError("INVALID_SCHEDULE");
                            nextDue = next;
                        }
                        this.changeFacility(text(l, "facility_id"), -reduction, 0n);
                        if (e.repayment.fullContractualRepayment) {
                            if (outstanding !== 0n)
                                throw new RegistryError("OUTSTANDING_PRINCIPAL_REMAINS");
                            const awardedAt = this.time();
                            const used = (this.db.prepare("SELECT amount_u FROM rep_reward_awards WHERE portfolio_key=? AND awarded_at>?").all(key, awardedAt - Number(REP_POLICY.rewardPeriodSeconds)) as Row[])
                                .reduce((n, a) => n + amount(a, "amount_u"), 0n);
                            const budget = used < REP_POLICY.rollingRewardCapU ? REP_POLICY.rollingRewardCapU - used : 0n;
                            const growth = calculateRepGrowthFromAreaU({ principalTime: area, moneyScale: amount(p, "money_scale"), eligible: clean && !impaired,
                                remainingRollingBudgetU: budget, survivingRepU: amount(p, "seed_u") + amount(p, "growth_u") - amount(p, "forfeited_u") });
                            const original = amount(l, "original_bond_u");
                            this.changeRep(key, { bonded_u: -original, pending_return_u: original + growth, growth_u: growth });
                            this.queueCredit(p, r, l, original + growth, growth, "REPAYMENT", e.occurredAt);
                            this.db.prepare("INSERT INTO rep_reward_awards VALUES (?,?,?, ?,?)").run(`award:${l.loan_id}`, key, l.loan_id, growth.toString(), awardedAt);
                            state = "REPAID";
                            if (requestId)
                                this.db.prepare("UPDATE credit_requests SET state='RETURN_PENDING' WHERE request_id=?").run(requestId);
                        }
                    }
                    else if (e.kind === "IMPAIRMENT" || e.kind === "UNIMPAIRMENT") {
                        if ((binding.mode === "LIVE_DEVNET" || e.kind === "UNIMPAIRMENT") && !e.servicing)
                            throw new RegistryError("SERVICING_SCHEDULE_REQUIRED");
                        if (e.kind === "UNIMPAIRMENT" && !impaired)
                            throw new RegistryError("LOAN_NOT_PREVIOUSLY_IMPAIRED");
                        if (e.servicing) {
                            const next = e.servicing.nextPaymentDueAt;
                            if (!Number.isSafeInteger(next) || next < Number(l.origin_time) ||
                                !Number.isSafeInteger(next + Number(l.grace_seconds)))
                                throw new RegistryError("INVALID_SCHEDULE");
                            nextDue = next;
                        }
                        // Restoration can change the current due date, never the prior impairment fact.
                        impaired = true;
                    }
                    else {
                        if (e.occurredAt <= Number(l.next_due_time) + Number(l.grace_seconds))
                            throw new RegistryError("DEFAULT_TOO_SOON");
                        const original = amount(l, "original_bond_u");
                        defaulted = outstanding;
                        this.changeFacility(text(l, "facility_id"), -outstanding, 0n);
                        outstanding = 0n;
                        this.changeRep(key, { bonded_u: -original, forfeited_u: original }, true);
                        state = "DEFAULTED";
                        if (requestId)
                            this.db.prepare("UPDATE credit_requests SET state='DEFAULTED' WHERE request_id=?").run(requestId);
                    }
                    this.db.prepare("UPDATE credit_loans SET outstanding_minor=?,defaulted_minor=?,state=?,reward_area=?,last_accrual_time=?,clean=?,ever_impaired=?,event_cursor=?,next_due_time=? WHERE loan_id=?")
                        .run(outstanding.toString(), defaulted.toString(), state, area.toString(), Math.max(Number(l.last_accrual_time), clipped), Number(clean), Number(impaired), e.eventId, nextDue, l.loan_id);
                    break;
                }
                case "RETURN_VALIDATED": {
                    if (!c || c.state !== "OWED" || !e.returned)
                        throw new RegistryError("RETURN_CREDIT_REQUIRED");
                    if (e.occurredAt < Number(c.created_at))
                        throw new RegistryError("RETURN_PREDATES_CREDIT");
                    const attempt = this.one("SELECT * FROM rep_return_attempts WHERE credit_id=? ORDER BY attempt_number DESC LIMIT 1", text(c, "credit_id"));
                    if (!attempt && binding.mode === "LIVE_DEVNET")
                        throw new RegistryError("NATIVE_RETURN_ATTEMPT_REQUIRED");
                    if (attempt && (attempt.attempt_hash !== hash || !["PERSISTED", "SUBMITTED", "RECONCILING"].includes(text(attempt, "state")) ||
                        (e.native && (e.native.ledgerIndex < Number(attempt.first_ledger_sequence) || e.native.ledgerIndex > Number(attempt.last_ledger_sequence)))))
                        throw new RegistryError("RETURN_ATTEMPT_MISMATCH");
                    if (e.returned.attemptHash !== undefined && e.returned.attemptHash !== hash)
                        throw new RegistryError("RETURN_ATTEMPT_MISMATCH");
                    const proof = e.returned;
                    if (atomic(proof.amountU) !== amount(c, "amount_u") || canonicalJson(proof.repAsset) !== text(p, "rep_asset_json") ||
                        proof.sender !== binding.repAsset.issuer || proof.destination !== binding.borrowerAccount || proof.partialPayment !== false)
                        throw new RegistryError("INVALID_REP_RETURN");
                    this.changeRep(key, { pending_return_u: -amount(c, "amount_u"), available_u: amount(c, "amount_u") });
                    this.db.prepare("UPDATE rep_return_credits SET state='PAID',return_hash=? WHERE credit_id=?").run(hash, c.credit_id);
                    if (attempt) {
                        const lane = this.need("SELECT * FROM rep_issuer_lanes WHERE issuer_key=?", text(attempt, "issuer_key"));
                        if (lane.active_credit_id !== c.credit_id)
                            throw new RegistryError("RETURN_LANE_MISMATCH");
                        this.db.prepare("UPDATE rep_return_attempts SET state='VALIDATED' WHERE credit_id=? AND attempt_number=?").run(c.credit_id, attempt.attempt_number);
                        this.db.prepare("UPDATE rep_issuer_lanes SET active_credit_id=NULL,claimed=0,owner=NULL,next_sequence_floor=max(next_sequence_floor,?) WHERE issuer_key=?")
                            .run(Number(attempt.sequence) + 1, attempt.issuer_key);
                    }
                    if (requestId)
                        this.db.prepare("UPDATE credit_requests SET state=? WHERE request_id=?").run(c.reason === "REPAYMENT" ? "REPAID" : "CANCELLED", requestId);
                    break;
                }
                default: throw new RegistryError("UNKNOWN_EVENT_KIND");
            }
            this.db.prepare("INSERT INTO credit_events VALUES (?,?,?,?,?,?,?,?,?,?,?)")
                .run(e.eventId, digest, requestId, l?.loan_id ?? e.loan?.loanId ?? null, e.kind, binding.network, e.kind === "UNKNOWN" ? null : e.native?.txHash.toUpperCase() ?? null, e.native?.ledgerIndex ?? null, e.native?.transactionIndex ?? null, e.occurredAt, canonicalJson(e));
            return this.getPortfolio(binding);
        }).immediate();
    }
}
export function createRegistry(db: Database.Database, options: RegistryOptions = {}): CreditRegistry { return new CreditRegistry(db, options); }
