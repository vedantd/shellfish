import type Database from "better-sqlite3";
import { RegistryError, type CreditRegistry } from "@shellfish/registry";
import type { AuthorizationReceipt, LenderFacilityOffer, NetworkMode } from "@shellfish/schemas";

type UiStateReader = {
  getReceipt(id: string): AuthorizationReceipt | undefined;
  getApprovedOffer(hash: string): LenderFacilityOffer | undefined;
};
type RequestRow = { request_id: string; reservation_id: string; state: string; loan_id: string | null; facility_id: string; mode: NetworkMode; network: string };
type EventRow = { event_id: string; kind: string; tx_hash: string | null; ledger_index: number | null; transaction_index: number | null; occurred_at: number; native_validated: number | null; native_result: string | null };
type AttemptRow = { phase: string; attempt_hash: string; state: string; sequence: number; last_ledger_sequence: number; commitment: string };
const detached = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const nativeHash = (mode: NetworkMode, value: string | null): string | null => mode === "LIVE_DEVNET" && value !== null && /^[a-fA-F0-9]{64}$/.test(value) ? value.toUpperCase() : null;
const explorer = (network: string, hash: string | null): string | null => network === "devnet" && hash !== null ? `https://devnet.xrpl.org/transactions/${hash}` : null;

/** Public read projection. A recorded hash never creates an approval or re-verifies a ledger. */
export function createRequestView(db: Database.Database, registry: CreditRegistry, uiState: UiStateReader) {
  function getRequestView(requestId: string) {
    return db.transaction(() => {
      const row = db.prepare(`SELECT r.request_id,r.reservation_id,r.state,r.loan_id,r.facility_id,p.mode,p.network
        FROM credit_requests r JOIN credit_portfolios p USING(portfolio_key) WHERE r.request_id=?`).get(requestId) as RequestRow | undefined;
      if (!row) throw new RegistryError("NOT_FOUND");
      const request = registry.getRequest(requestId);
      const receipt = uiState.getReceipt(requestId) ?? null;
      const offer = uiState.getApprovedOffer(request.request.commercial_terms_hash) ?? null;
      if (receipt && (receipt.request_id !== requestId || receipt.reservation_id !== row.reservation_id
          || receipt.mode !== row.mode || receipt.network !== row.network || receipt.proposal_hash !== request.payloadHash
          || receipt.quote_bond_u !== request.originalBondU || receipt.policy_hash !== request.request.policy_hash
          || receipt.commercial_terms_hash !== request.request.commercial_terms_hash))
        throw new RegistryError("UI_STATE_CONTEXT_MISMATCH");
      if (offer && (offer.mode !== row.mode || offer.network !== row.network || offer.offer_id !== request.request.offer_id
          || offer.facility_id !== request.request.facility_id || offer.borrower_id !== request.request.principal_id
          || offer.commercial_terms_hash !== request.request.commercial_terms_hash))
        throw new RegistryError("UI_STATE_CONTEXT_MISMATCH");
      const events = db.prepare(`SELECT event_id,kind,tx_hash,ledger_index,transaction_index,occurred_at,
        json_extract(payload_json,'$.native.validated') AS native_validated,
        json_extract(payload_json,'$.native.result') AS native_result
        FROM credit_events WHERE request_id=? AND network=?
        ORDER BY occurred_at,ledger_index,transaction_index,rowid`).all(requestId, row.network) as EventRow[];
      const attempts = db.prepare(`SELECT phase,attempt_hash,state,sequence,last_ledger_sequence,commitment
        FROM credit_attempts WHERE request_id=? ORDER BY phase`).all(requestId) as AttemptRow[];
      const rawLoan = row.loan_id ? registry.getLoan(row.loan_id) : null;
      const loan = rawLoan ? Object.fromEntries([
        "loan_id", "state", "principal_minor", "outstanding_minor", "original_bond_u", "defaulted_minor",
        "origin_time", "maturity_time", "next_due_time", "grace_seconds",
      ].map(key => [key, rawLoan[key]])) : null;
      return detached({
        request_id: row.request_id,
        reservation_id: row.reservation_id,
        mode: row.mode,
        network: row.network,
        request_state: row.state,
        loan_id: row.loan_id,
        receipt,
        approved_offer: offer,
        lender_decision: offer ? {
          decision: "APPROVE" as const,
          lender_id: offer.lender_id,
          offer_id: offer.offer_id,
          approval_ref: offer.approval_ref,
          underwriting_policy: offer.underwriting_policy,
          evidence_origin: "APPROVED_OFFER_SNAPSHOT" as const,
        } : null,
        credit_status: registry.getCreditStatus(row.facility_id),
        loan,
        transactions: events.map(event => {
          const hash = nativeHash(row.mode, event.tx_hash);
          return {
            event_id: event.event_id, kind: event.kind, tx_hash: hash,
            ledger_index: hash ? event.ledger_index : null,
            transaction_index: hash ? event.transaction_index : null,
            occurred_at: event.occurred_at,
            evidence_origin: "REGISTRY_EVENT" as const,
            recorded_validated: hash !== null && event.native_validated === 1 && event.native_result === "tesSUCCESS"
              && Number.isSafeInteger(event.ledger_index) && Number.isSafeInteger(event.transaction_index),
            ledger_requeried: false,
            explorer: explorer(row.network, hash),
          };
        }),
        attempts: attempts.map(attempt => {
          const hash = nativeHash(row.mode, attempt.attempt_hash);
          return {
            phase: attempt.phase, tx_hash: hash, state: attempt.state,
            sequence: attempt.sequence, last_ledger_sequence: attempt.last_ledger_sequence,
            commitment: attempt.commitment, evidence_origin: "PERSISTED_ATTEMPT" as const,
            recorded_validated: false, ledger_requeried: false, explorer: explorer(row.network, hash),
          };
        }),
      });
    })();
  }
  return { getRequestView };
}
